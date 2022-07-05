/*
 * SPDX-License-Identifier: Apache-2.0
 */

import MQTT from 'async-mqtt';

import { CamEvent } from './camera';
import { config } from './config';
import { logger } from './logger';

export default class MQTTService {
    public static async getMQTT(): Promise<MQTTService> {
        const client = await MQTT.connectAsync(config.MQTT_BROKER);
        return new MQTTService(client);
    }

    private _client: MQTT.AsyncMqttClient;

    private constructor(client: MQTT.AsyncMqttClient) {
        this._client = client;
        this.ping();
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    public async processEvent({
        eventTime,
        eventTopic,
        eventProperty,
        sourceName,
        sourceValue,
        dataName,
        dataValue,
    }: CamEvent): Promise<void> {
        const message = {
            eventTime: eventTime.toJSON(),
            eventProperty,
            sourceName,
            sourceValue,
            dataName,
            dataValue,
        };

        const topic = `${config.MQTT_TOPIC_ROOT}/${eventTopic}`;
        logger.info(topic);
        await this._client.publish(topic, JSON.stringify(message));
    }

    public async ping(): Promise<void> {
        const topic = config.MQTT_TOPIC_ROOT;
        await this._client.publish(topic, JSON.stringify('ping'));
    }
}
