/*
 * SPDX-License-Identifier: Apache-2.0
 */

import * as env from 'env-var';

// Use the envar module to load environment variables as properties

const CAMERA_PORT: number = env.get('CAMERA_PORT').required().asIntPositive();
const CAMERA_HOSTNAME: string = env.get('CAMERA_HOSTNAME').required().asString();

const CAMERA_USER: string = env.get('CAMERA_USER').required().asString();
const CAMERA_PASSWORD: string = env.get('CAMERA_PASSWORD').required().asString();

const CAMERA_CONNECT_RETRIES: number = env.get('CAMERA_CONNECT_RETRIES').default(5).asInt();
const CAMERA_RETRY_DELAY: number = env.get('CAMERA_CONNECT_RETRIES').default(1000).asInt();

const MQTT_BROKER: string = env.get('MQTT_BROKER').required().asString();
const MQTT_TOPIC_ROOT: string = env.get('MQTT_TOPIC_ROOT').default('camera').asString();

export interface Config {
    CAMERA_HOSTNAME: string;
    CAMERA_PASSWORD: string;
    CAMERA_PORT: number;
    CAMERA_USER: string;

    CAMERA_CONNECT_RETRIES: number;
    CAMERA_RETRY_DELAY: number;

    MQTT_BROKER: string;
    MQTT_TOPIC_ROOT: string;
}

export const config: Config = {
    CAMERA_HOSTNAME,
    CAMERA_PASSWORD,
    CAMERA_PORT,
    CAMERA_USER,
    CAMERA_CONNECT_RETRIES,
    CAMERA_RETRY_DELAY,
    MQTT_BROKER,
    MQTT_TOPIC_ROOT,
};
