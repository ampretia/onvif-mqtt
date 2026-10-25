/*
SPDX-License-Identifier: Apache-2.0
*/

// import * as env from 'env-var';
import { logger } from './logger';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import * as path from 'path';
import Camera, { CamEvent } from './camera';

import MQTTService from './mqtt-service';

const pjson = readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8');
const version = (JSON.parse(pjson) as { version: string }).version;

console.log(
    chalk.blue.bold(`
                    _ ____                            __  __ 
  ____  ____ _   __(_) __/           ____ ___  ____ _/ /_/ /_
 / __ \\/ __ \\ | / / / /_   ______   / __ \`__ \\/ __ \`/ __/ __/
/ /_/ / / / / |/ / / __/  /_____/  / / / / / / /_/ / /_/ /_  
\\____/_/ /_/|___/_/_/             /_/ /_/ /_/\\__, /\\__/\\__/  
                                               /_/           
`),
);

const PING_INTERVAL_MS = 3600 * 1000;
const RECONNECT_DELAY_MS = 60 * 1000;

let mqtt: MQTTService | undefined;
const allCameras: { [camName: string]: Camera } = {};
const reconnectTimers = new Map<string, NodeJS.Timeout>();
const connecting = new Set<string>();
const activeTasks = new Set<Promise<void>>();
let pingInterval: NodeJS.Timeout | undefined;
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

const shutdown = (exitCode = 0): Promise<void> => {
    if (exitCode !== 0 || process.exitCode === undefined) process.exitCode = exitCode;
    if (shutdownPromise) return shutdownPromise;

    shuttingDown = true;
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = undefined;
    }
    for (const timer of reconnectTimers.values()) clearTimeout(timer);
    reconnectTimers.clear();

    shutdownPromise = (async () => {
        await Promise.allSettled([...activeTasks]);
        await Promise.all(
            Object.entries(allCameras).map(async ([name, cam]) => {
                delete allCameras[name];
                await disposeCamera(name, cam);
            }),
        );
        await closeMqtt();
    })();
    return shutdownPromise;
};

process.once('SIGINT', () => {
    logger.info('Received SIGINT, shutting down');
    void shutdown();
});
process.once('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down');
    void shutdown();
});
process.once('unhandledRejection', (reason: unknown) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
    void shutdown(1);
});
process.once('uncaughtException', (error: Error) => {
    logger.error({ err: error }, 'Uncaught exception');
    void shutdown(1);
});

/** Retry connecting to a camera after a delay, unless a retry is already pending */
const scheduleReconnect = (name: string) => {
    if (shuttingDown || reconnectTimers.has(name)) return;
    logger.info(`[${name}] Will attempt to reconnect in ${RECONNECT_DELAY_MS / 1000}s`);
    const timer = setTimeout(() => {
        reconnectTimers.delete(name);
        void connectCamera(name);
    }, RECONNECT_DELAY_MS);
    reconnectTimers.set(name, timer);
};

/** Connect to a camera and attach the handlers. On failure publish an error and schedule a reconnect. */
const setupCamera = async (name: string): Promise<void> => {
    if (shuttingDown || connecting.has(name) || allCameras[name]) return;
    const service = mqtt;
    if (!service) return;
    connecting.add(name);
    let cam: Camera | undefined;
    try {
        logger.info(`[${name}] Attempting to connect`);
        cam = await Camera.getCamera(name);

        logger.info(`[${name}] Connected`);
        const info = await cam.getDeviceInformation();
        logger.info(info.info);

        const cameraDataTime = await cam.getSystemDateAndTime();
        logger.info(`[${name}] Camera Time is ${JSON.stringify(cameraDataTime.info)}`);

        // to do mark difference from current time

        const cameraCapabilities = await cam.getCapabilities();
        logger.info(`[${name}] Capabilities::`);
        logger.info(`${JSON.stringify(cameraCapabilities.info)}`);

        cam.setEventHandler(async (camEvent: CamEvent) => {
            await service.processEvent(camEvent);
        });

        cam.setErrorEventHandler((event: unknown) => {
            logger.error(event);
        });

        allCameras[name] = cam;
        logger.info(`[${name}] Event handler added`);
        await service.notify(`[${name}] Event handler added`);
    } catch (e: unknown) {
        if (cam) await disposeCamera(name, cam);
        if (shuttingDown) {
            return;
        }
        logger.error(e);
        await reportError(`[${name}] connection failed: ${e instanceof Error ? e.message : String(e)}`);
        scheduleReconnect(name);
    } finally {
        connecting.delete(name);
    }
};

/** Hourly check of every configured camera: ping connected ones, (re)connect the others */
const pingAll = async () => {
    for (const name of Camera.listCameras()) {
        if (shuttingDown) return;
        const cam = allCameras[name];
        if (!cam) {
            // not connected (initial connect failed or earlier ping failed) - try again now
            const timer = reconnectTimers.get(name);
            if (timer) {
                clearTimeout(timer);
                reconnectTimers.delete(name);
            }
            await setupCamera(name);
            continue;
        }

        try {
            await cam.ping();
        } catch (e: unknown) {
            if (shuttingDown) return;
            logger.error({ err: e }, `[${name}] Ping failed`);
            await reportError(`[${name}] ping failed: ${e instanceof Error ? e.message : String(e)}`);
            if (shuttingDown) return;
            delete allCameras[name];
            await disposeCamera(name, cam);
            scheduleReconnect(name);
        }
    }
};

const connectCamera = (name: string): Promise<void> => trackTask(setupCamera(name));

/** Main function */
const main = async () => {
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

    for (const name of Camera.listCameras()) {
        if (shuttingDown) return;
        await connectCamera(name);
    }
};

void trackTask(
    main()
        .then(() => {
            if (!shuttingDown) logger.info('System configured and running');
        })
        .catch((e: unknown) => {
            logger.error({ err: e }, 'Fatal error in main');
            void shutdown(1);
        }),
);
