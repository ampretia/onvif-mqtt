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

/** Main function */
const main = async () => {
    logger.info(`onvif-mqtt  v${version}`);

    mqtt = await MQTTService.getMQTT();

    const cam = await Camera.getCam();
    const info = await cam.getDeviceInformation();
    logger.info(info.info);

    const cameraDataTime = await cam.getSystemDateAndTime();
    logger.info(`Camera Time is ${cameraDataTime.info}`);

    const cameraCapabilities = await cam.getCapabilities();
    logger.info(`${JSON.stringify(cameraCapabilities.info)}`);

    cam.setEventHandler(async (camEvent: CamEvent) => {
        await mqtt.processEvent(camEvent);
    });
    logger.info(`Event handler added`);
};

main()
    .then(() => {
        logger.info('System configured and running');
    })
    .catch((e: any) => {
        logger.error(e);
    });
