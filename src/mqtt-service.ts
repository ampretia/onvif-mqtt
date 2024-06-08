/*
 * SPDX-License-Identifier: Apache-2.0
 */

import MQTT from 'async-mqtt';

import { CamEvent } from './camera';
import { config } from 'node-config-ts';
import { logger } from './logger';

export default class MQTTService {
    public static async getMQTT(): Promise<MQTTService> {
        const options = { username: config.mqtt.username, password: config.mqtt.password };
        const client = await MQTT.connectAsync(config.mqtt.broker_host, options);
        return new MQTTService(client);
    }

    private _client: MQTT.AsyncMqttClient;

    private constructor(client: MQTT.AsyncMqttClient) {
        this._client = client;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    public async processEvent({
        name,
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

        const topic = `${config.mqtt.topic_root}/${name}/${eventTopic}`;
        logger.info(`Publishing on ${topic}`);
        await this._client.publish(topic, JSON.stringify(message));
    }

    public async ping(version: number): Promise<void> {
        const topic = config.mqtt.topic_root;

        const data = { name: 'onvif-mqtt', action: 'started', version };
        await this._client.publish(topic, JSON.stringify(data));
    }

    public async notify(text: string): Promise<void> {
        const topic = config.mqtt.topic_root;

        const data = { name: 'onvif-mqtt', action: 'notifiy', text};
        await this._client.publish(topic, JSON.stringify(data));
    }
}
