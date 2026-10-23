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

let mqtt: MQTTService;
const allCameras: { [camName: string]: Camera } = {};
const reconnectTimers = new Map<string, NodeJS.Timeout>();
const connecting = new Set<string>();

/** Publish an error to MQTT; never throws */
const reportError = async (text: string) => {
    try {
        await mqtt.error(text);
    } catch (e: unknown) {
        logger.error({ err: e }, 'Failed to publish error to MQTT');
    }
};

/** Retry connecting to a camera after a delay, unless a retry is already pending */
const scheduleReconnect = (name: string) => {
    if (reconnectTimers.has(name)) return;
    logger.info(`[${name}] Will attempt to reconnect in ${RECONNECT_DELAY_MS / 1000}s`);
    const timer = setTimeout(() => {
        reconnectTimers.delete(name);
        void setupCamera(name);
    }, RECONNECT_DELAY_MS);
    reconnectTimers.set(name, timer);
};

/** Connect to a camera and attach the handlers. On failure publish an error and schedule a reconnect. */
const setupCamera = async (name: string): Promise<void> => {
    if (connecting.has(name) || allCameras[name]) return;
    connecting.add(name);
    try {
        logger.info(`[${name}] Attempting to connect`);
        const cam = await Camera.getCamera(name);

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
            await mqtt.processEvent(camEvent);
        });

        cam.setErrorEventHandler((event: unknown) => {
            logger.error(event);
        });

        allCameras[name] = cam;
        logger.info(`[${name}] Event handler added`);
        await mqtt.notify(`[${name}] Event handler added`);
    } catch (e: unknown) {
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
            logger.error({ err: e }, `[${name}] Ping failed`);
            await reportError(`[${name}] ping failed: ${e instanceof Error ? e.message : String(e)}`);
            cam.dispose();
            delete allCameras[name];
            scheduleReconnect(name);
        }
    }
};

/** Main function */
const main = async () => {
    logger.info(`onvif-mqtt  v${version}`);

    mqtt = await MQTTService.getMQTT();
    await mqtt.ping(version);
    logger.info(`Connected to MQTT`);

    // runs regardless of whether the initial connections succeeded
    setInterval(() => {
        pingAll().catch((e: unknown) => logger.error({ err: e }, 'Ping cycle failed'));
    }, PING_INTERVAL_MS);

    for (const name of Camera.listCameras()) {
        await setupCamera(name);
    }
};

main()
    .then(() => {
        logger.info('System configured and running');
    })
    .catch((e: unknown) => {
        logger.error({ err: e }, 'Fatal error in main');
    });
