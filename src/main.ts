/*
SPDX-License-Identifier: Apache-2.0
*/

import * as sourceMapSupport from 'source-map-support';
sourceMapSupport.install();

// import * as env from 'env-var';
import { logger } from './logger';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import * as path from 'path';
import Camera, { CamEvent } from './camera';

import MQTTService from './mqtt-service';

const pjson = readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8');
const version = JSON.parse(pjson).version;

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

let mqtt: MQTTService;
let allCameras: { [camName: string]: Camera };

/** Main function */
const main = async () => {
    logger.info(`onvif-mqtt  v${version}`);

    allCameras = {};
    mqtt = await MQTTService.getMQTT();
    await mqtt.ping(version);
    logger.info(`Connected to MQTT`);

    const cameraNames = Camera.listCameras();
    for (const name of cameraNames) {
        let cam;
        try {
            logger.info(`[${name}] Attempting to connect`);
            cam = await Camera.getCamera(name);
        } catch (e: unknown) {
            logger.error(e);
            logger.info('moving on to next camera');
            continue;
        }

        logger.info(`[${name}] Connected`);
        const info = await cam.getDeviceInformation();
        logger.info(info.info);

        const cameraDataTime = await cam.getSystemDateAndTime();
        logger.info(`[${name}] Camera Time is ${cameraDataTime.info}`);

        // to do mark difference from current time

        const cameraCapabilities = await cam.getCapabilities();
        logger.info(`[${name}] Capabilities::`);
        logger.info(`${JSON.stringify(cameraCapabilities.info)}`);

        cam.setEventHandler(async (camEvent: CamEvent) => {
            await mqtt.processEvent(camEvent);
        });

        cam.setErrorEventHandler((event: any) => {
            logger.error(event);
        });

        cam.enablePing();

        logger.info(`[${name}] Event handler added`);
        await mqtt.notify(`[${name}] Event handler added`);
        allCameras[name] = cam;
    }
};

main()
    .then(() => {
        logger.info('System configured and running');
    })
    .catch((e: unknown) => {
        logger.error(e);
        logger.error((e as Error).stack);
    });
