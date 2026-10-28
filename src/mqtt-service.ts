/*
 * SPDX-License-Identifier: Apache-2.0
 */

import MQTT, { MqttClient } from 'mqtt';

import { CamEvent } from './camera';
import { getConfig } from './config';
import { logger } from './logger';

const MAX_PENDING_PUBLISHES = 100;

interface PendingPublish {
    topic: string;
    payload: string;
}

export default class MQTTService {
    public static async getMQTT(): Promise<MQTTService> {
        const config = getConfig();
        const configuredWill = config.mqtt.will;
        const options = {
            username: config.mqtt.username,
            password: config.mqtt.password,
            clientId: config.mqtt.client_id ?? `onvif-mqtt-${process.pid}`,
            reconnectPeriod: 1000,
            queueQoSZero: false,
            will: {
                topic: configuredWill?.topic ?? `${config.mqtt.topic_root}/status`,
                payload: configuredWill?.payload ?? JSON.stringify({ name: 'onvif-mqtt', action: 'offline' }),
                qos: configuredWill?.qos ?? 1,
                retain: configuredWill?.retain ?? true,
            },
        };
        const client = await MQTT.connectAsync(config.mqtt.broker_host, options);
        return new MQTTService(client);
    }

    private _client: MqttClient;
    private _pendingPublishes: PendingPublish[] = [];
    private _flushing = false;

    private constructor(client: MqttClient) {
        this._client = client;
        client.on('connect', () => {
            logger.info('Connected to MQTT broker');
            void this.flushPendingPublishes();
        });
        client.on('reconnect', () => logger.info('Reconnecting to MQTT broker'));
        client.on('offline', () => logger.info('MQTT broker is offline'));
        client.on('close', () => logger.info('MQTT connection closed'));
        client.on('error', (error: Error) => logger.error({ err: error }, 'MQTT client error'));
    }

    private queuePublish(topic: string, payload: string): void {
        if (this._pendingPublishes.length >= MAX_PENDING_PUBLISHES) {
            const dropped = this._pendingPublishes.shift();
            logger.error({ topic: dropped?.topic }, 'Dropping oldest queued MQTT publish; queue is full');
        }
        this._pendingPublishes.push({ topic, payload });
    }

    private async publish(topic: string, payload: string): Promise<void> {
        if (!this._client.connected) {
            this.queuePublish(topic, payload);
            return;
        }

        try {
            await this._client.publishAsync(topic, payload);
        } catch (error: unknown) {
            logger.error({ err: error, topic }, 'MQTT publish failed; queued for retry');
            this.queuePublish(topic, payload);
            void this.flushPendingPublishes();
        }
    }

    private async flushPendingPublishes(): Promise<void> {
        if (this._flushing || !this._client.connected) return;
        this._flushing = true;
        try {
            while (this._client.connected && this._pendingPublishes.length > 0) {
                const next = this._pendingPublishes[0];
                if (!next) return;
                try {
                    await this._client.publishAsync(next.topic, next.payload);
                    this._pendingPublishes.shift();
                } catch (error: unknown) {
                    logger.error({ err: error, topic: next.topic }, 'Queued MQTT publish failed; waiting to reconnect');
                    return;
                }
            }
        } finally {
            this._flushing = false;
        }
    }

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
            eventTime,
            eventProperty,
            sourceName,
            sourceValue,
            dataName,
            dataValue,
        };

        const safeEventTopic = eventTopic
            .split('/')
            .filter((segment) => segment.length > 0)
            .map((segment) => encodeURIComponent(segment))
            .join('/');
        if (safeEventTopic.length === 0) return;
        const topic = `${getConfig().mqtt.topic_root}/${name}/${safeEventTopic}`;
        logger.info(`Publishing on ${topic}`);
        await this.publish(topic, JSON.stringify(message));
    }

    public async ping(version: string | number): Promise<void> {
        const topic = getConfig().mqtt.topic_root;

        const data = { name: 'onvif-mqtt', action: 'started', version };
        await this.publish(topic, JSON.stringify(data));
    }

    public async notify(text: string): Promise<void> {
        const topic = getConfig().mqtt.topic_root;

        const data = { name: 'onvif-mqtt', action: 'notifiy', text };
        await this.publish(topic, JSON.stringify(data));
    }

    public async error(text: string): Promise<void> {
        const topic = getConfig().mqtt.topic_root;

        const data = { name: 'onvif-mqtt', action: 'error', text };
        await this.publish(topic, JSON.stringify(data));
    }

    public async close(): Promise<void> {
        await this._client.endAsync();
    }
}
