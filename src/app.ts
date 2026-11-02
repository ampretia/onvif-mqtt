/*
SPDX-License-Identifier: Apache-2.0
*/

import { logger } from './logger';
import Camera, { CamEvent } from './camera';
import MQTTService from './mqtt-service';
import { isAuthenticationError, nextRetryDelay } from './retry';

const PING_INTERVAL_MS = 3600 * 1000;
const RECONNECT_DELAY_MS = 60 * 1000;

export interface App {
    /** Connect to MQTT and every configured camera. Resolves once the initial connection attempts are done. */
    start(): Promise<void>;
    /** Stop all timers, wait for in-flight work, then release cameras and the MQTT connection. Idempotent. */
    shutdown(): Promise<void>;
}

/**
 * Text published to MQTT for a failure. Library errors can contain hostnames, URLs and credentials-adjacent
 * detail and anyone subscribed to the topic root can read them, so only a category is published;
 * the full error is written to the log.
 */
const publicReason = (e: unknown): string => (isAuthenticationError(e) ? 'authentication failed' : 'see logs');

export function createApp(version: string): App {
    let mqtt: MQTTService | undefined;
    const allCameras = new Map<string, Camera>();
    const reconnectTimers = new Map<string, NodeJS.Timeout>();
    const reconnectDelays = new Map<string, number>();
    // Cameras whose credentials were rejected. They are not retried with backoff (to avoid account lockouts)
    // but are retried once per ping cycle, so a corrected password or a false positive recovers by itself.
    const authenticationFailures = new Set<string>();
    const connecting = new Set<string>();
    const activeTasks = new Set<Promise<void>>();
    const abort = new AbortController();
    let pingInterval: NodeJS.Timeout | undefined;
    let pingRunning = false;
    let shuttingDown = false;
    let shutdownPromise: Promise<void> | undefined;

    /** Publish an error to MQTT; never throws */
    const reportError = async (text: string) => {
        const service = mqtt;
        if (!service) return;
        try {
            await service.error(text);
        } catch (e: unknown) {
            logger.error({ err: e }, 'Failed to publish error to MQTT');
        }
    };

    /** Publish a notification to MQTT; never throws */
    const notify = async (text: string) => {
        const service = mqtt;
        if (!service) return;
        try {
            await service.notify(text);
        } catch (e: unknown) {
            logger.error({ err: e }, 'Failed to publish notification to MQTT');
        }
    };

    const trackTask = (task: Promise<void>): Promise<void> => {
        activeTasks.add(task);
        void task.then(
            () => activeTasks.delete(task),
            () => activeTasks.delete(task),
        );
        return task;
    };

    const disposeCamera = async (name: string, cam: Camera): Promise<void> => {
        try {
            await cam.dispose();
        } catch (e: unknown) {
            logger.error({ err: e }, `[${name}] Failed to unsubscribe from events`);
        }
    };

    const closeMqtt = async (): Promise<void> => {
        const service = mqtt;
        if (!service) return;
        mqtt = undefined;
        try {
            await service.close();
        } catch (e: unknown) {
            logger.error({ err: e }, 'Failed to close MQTT connection');
        }
    };

    /** Record a failed camera and decide how it is retried */
    const handleCameraFailure = (name: string, e: unknown) => {
        if (isAuthenticationError(e)) {
            authenticationFailures.add(name);
        } else {
            scheduleReconnect(name);
        }
    };

    /** Retry connecting to a camera after a delay, unless a retry is already pending */
    const scheduleReconnect = (name: string) => {
        if (shuttingDown || authenticationFailures.has(name) || reconnectTimers.has(name)) return;
        const delay = reconnectDelays.get(name) ?? RECONNECT_DELAY_MS;
        reconnectDelays.set(name, nextRetryDelay(delay));
        logger.info(`[${name}] Will attempt to reconnect in ${delay / 1000}s`);
        const timer = setTimeout(() => {
            reconnectTimers.delete(name);
            void connectCamera(name);
        }, delay);
        reconnectTimers.set(name, timer);
    };

    /** Connect to a camera and attach the handlers. On failure publish an error and schedule a reconnect. */
    const setupCamera = async (name: string): Promise<void> => {
        if (shuttingDown || connecting.has(name) || allCameras.has(name)) return;
        const service = mqtt;
        if (!service) return;
        connecting.add(name);
        let cam: Camera | undefined;
        try {
            logger.info(`[${name}] Attempting to connect`);
            cam = await Camera.getCamera(name, abort.signal);

            logger.info(`[${name}] Connected`);
            const info = await cam.getDeviceInformation();
            logger.debug({ info: info.info }, `[${name}] Device information`);

            const cameraDataTime = await cam.getSystemDateAndTime();
            logger.info(`[${name}] Camera Time is ${JSON.stringify(cameraDataTime.info)}`);

            const cameraCapabilities = await cam.getCapabilities();
            logger.debug({ capabilities: cameraCapabilities.info }, `[${name}] Capabilities`);

            cam.setEventHandler(async (camEvent: CamEvent) => {
                await service.processEvent(camEvent);
            });

            cam.setErrorEventHandler((event: unknown) => {
                logger.error({ err: event }, `[${name}] Camera error event`);
            });

            logger.info(`[${name}] Event handler added`);
            await notify(`[${name}] Event handler added`);
            allCameras.set(name, cam);
            reconnectDelays.delete(name);
            authenticationFailures.delete(name);
        } catch (e: unknown) {
            allCameras.delete(name);
            if (cam) await disposeCamera(name, cam);
            if (shuttingDown) {
                return;
            }
            logger.error({ err: e }, `[${name}] Connection failed`);
            await reportError(`[${name}] connection failed: ${publicReason(e)}`);
            handleCameraFailure(name, e);
        } finally {
            connecting.delete(name);
        }
    };

    const connectCamera = (name: string): Promise<void> => trackTask(setupCamera(name));

    /** Ping one connected camera; on failure drop it and schedule recovery */
    const pingCamera = async (name: string, cam: Camera): Promise<void> => {
        try {
            await cam.ping();
        } catch (e: unknown) {
            if (shuttingDown) return;
            logger.error({ err: e }, `[${name}] Ping failed`);
            await reportError(`[${name}] ping failed: ${publicReason(e)}`);
            if (shuttingDown) return;
            allCameras.delete(name);
            await disposeCamera(name, cam);
            handleCameraFailure(name, e);
        }
    };

    /** Hourly check of every configured camera: ping connected ones, (re)connect the others. Cameras run in parallel. */
    const pingAll = async (): Promise<void> => {
        if (pingRunning) {
            logger.warn('Previous ping cycle is still running; skipping this one');
            return;
        }
        pingRunning = true;
        try {
            await Promise.all(
                Camera.listCameras().map(async (name) => {
                    if (shuttingDown) return;
                    const cam = allCameras.get(name);
                    if (cam) {
                        await pingCamera(name, cam);
                    } else if (authenticationFailures.has(name)) {
                        await connectCamera(name);
                    } else {
                        // Keep the scheduled backoff
                        scheduleReconnect(name);
                    }
                }),
            );
        } finally {
            pingRunning = false;
        }
    };

    const run = async (): Promise<void> => {
        logger.info(`onvif-mqtt  v${version}`);

        mqtt = await MQTTService.getMQTT();
        if (shuttingDown) {
            await closeMqtt();
            return;
        }
        await mqtt.ping(version);
        if (shuttingDown) return;
        logger.info(`Connected to MQTT`);

        // runs regardless of whether the initial connections succeeded
        pingInterval = setInterval(() => {
            void trackTask(pingAll().catch((e: unknown) => logger.error({ err: e }, 'Ping cycle failed')));
        }, PING_INTERVAL_MS);

        if (!shuttingDown) {
            await Promise.allSettled(Camera.listCameras().map((name) => connectCamera(name)));
        }
        if (!shuttingDown) logger.info('System configured and running');
    };

    const shutdown = (): Promise<void> => {
        if (shutdownPromise) return shutdownPromise;

        shuttingDown = true;
        // cancel pending backoff waits inside Camera.getCamera so in-flight tasks finish promptly
        abort.abort();
        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = undefined;
        }
        for (const timer of reconnectTimers.values()) clearTimeout(timer);
        reconnectTimers.clear();
        reconnectDelays.clear();

        shutdownPromise = (async () => {
            await Promise.allSettled([...activeTasks]);
            const cameras = [...allCameras.entries()];
            allCameras.clear();
            await Promise.all(cameras.map(([name, cam]) => disposeCamera(name, cam)));
            await closeMqtt();
        })();
        return shutdownPromise;
    };

    return {
        start: () => trackTask(run()),
        shutdown,
    };
}
