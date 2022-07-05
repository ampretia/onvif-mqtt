/*
 * SPDX-License-Identifier: Apache-2.0
 */

import * as env from 'env-var';

// Use the envar module to load environment variables as properties
const CAMERA_PORT: number = env.get('CAMERA_PORT').required().asIntPositive();
const CAMERA_HOSTNAME: string = env.get('CAMERA_HOSTNAME').required().asString();

const CAMERA_USER: string = env.get('CAMERA_USER').required().asString();
const CAMERA_PASSWORD: string = env.get('CAMERA_PASSWORD').required().asString();

const MQTT_BROKER: string = env.get('MQTT_BROKER').required().asString();
const MQTT_TOPIC_ROOT: string = env.get('MQTT_TOPIC_ROOT').default('camera').asString();

export interface Config {
    CAMERA_HOSTNAME: string;
    CAMERA_PASSWORD: string;
    CAMERA_PORT: number;
    CAMERA_USER: string;

    MQTT_BROKER: string;
    MQTT_TOPIC_ROOT: string;
}

export const config: Config = {
    CAMERA_HOSTNAME,
    CAMERA_PASSWORD,
    CAMERA_PORT,
    CAMERA_USER,
    MQTT_BROKER,
    MQTT_TOPIC_ROOT,
};
