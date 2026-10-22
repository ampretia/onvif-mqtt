/*
 * SPDX-License-Identifier: Apache-2.0
 */

import MQTT, { MqttClient } from 'mqtt';

import { CamEvent } from './camera';
import { getConfig } from './config';
import { logger } from './logger';

export default class MQTTService {
    public static async getMQTT(): Promise<MQTTService> {
        const config = getConfig();
        const options = { username: config.mqtt.username, password: config.mqtt.password };
        const client = await MQTT.connectAsync(config.mqtt.broker_host, options);
        return new MQTTService(client);
    }

    private _client: MqttClient;

    private constructor(client: MqttClient) {
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

        const topic = `${getConfig().mqtt.topic_root}/${name}/${eventTopic}`;
        logger.info(`Publishing on ${topic}`);
        await this._client.publishAsync(topic, JSON.stringify(message));
    }

    public async ping(version: number): Promise<void> {
        const topic = getConfig().mqtt.topic_root;

        const data = { name: 'onvif-mqtt', action: 'started', version };
        await this._client.publishAsync(topic, JSON.stringify(data));
    }

    public async notify(text: string): Promise<void> {
        const topic = getConfig().mqtt.topic_root;

        const data = { name: 'onvif-mqtt', action: 'notifiy', text };
        await this._client.publishAsync(topic, JSON.stringify(data));
    }

    public async close(): Promise<void> {
        await this._client.endAsync();
    }
}
