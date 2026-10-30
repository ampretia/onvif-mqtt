/*
 * SPDX-License-Identifier: Apache-2.0
 */

import MQTT, { MqttClient } from 'mqtt';
import { hostname } from 'os';

import { CamEvent } from './camera';
import { getConfig } from './config';
import { logger } from './logger';

const MAX_PENDING_PUBLISHES = 100;
const MAX_PUBLISH_ATTEMPTS = 3;

interface PendingPublish {
    topic: string;
    payload: string;
    attempts: number;
}

interface StatusMessages {
    topic: string;
    offlinePayload: string;
    onlinePayload?: string;
    qos: 0 | 1 | 2;
    retain: boolean;
}

export default class MQTTService {
    public static async getMQTT(): Promise<MQTTService> {
        const config = getConfig();
        const configuredWill = config.mqtt.will;
        const status: StatusMessages = {
            topic: configuredWill?.topic ?? `${config.mqtt.topic_root}/status`,
            offlinePayload: configuredWill?.payload ?? JSON.stringify({ name: 'onvif-mqtt', action: 'offline' }),
            // The default status topic is retained, so it must be cleared again once the bridge is back online.
            onlinePayload: configuredWill
                ? configuredWill.online_payload
                : JSON.stringify({ name: 'onvif-mqtt', action: 'online' }),
            qos: configuredWill?.qos ?? 1,
            retain: configuredWill?.retain ?? true,
        };
        const options = {
            username: config.mqtt.username,
            password: config.mqtt.password,
            // The PID alone is not unique (it is usually the same in every container); the hostname is.
            clientId: config.mqtt.client_id ?? `onvif-mqtt-${hostname()}-${process.pid}`,
            reconnectPeriod: 1000,
            queueQoSZero: false,
            will: {
                topic: status.topic,
                payload: status.offlinePayload,
                qos: status.qos,
                retain: status.retain,
            },
        };
        const client = await MQTT.connectAsync(config.mqtt.broker_host, options);
        const service = new MQTTService(client, status, config.mqtt.topic_root);
        // connectAsync resolves after the first CONNACK, so the 'connect' event has already been missed
        void service.publishStatus(status.onlinePayload);
        return service;
    }

    private _client: MqttClient;
    private _status: StatusMessages;
    private _topicRoot: string;
    private _pendingPublishes: PendingPublish[] = [];
    private _flushing = false;

    private constructor(client: MqttClient, status: StatusMessages, topicRoot: string) {
        this._client = client;
        this._topicRoot = topicRoot;
        this._status = status;
        client.on('connect', () => {
            logger.info('Connected to MQTT broker');
            void this.publishStatus(this._status.onlinePayload);
            void this.flushPendingPublishes();
        });
        client.on('reconnect', () => logger.info('Reconnecting to MQTT broker'));
        client.on('offline', () => logger.info('MQTT broker is offline'));
        client.on('close', () => logger.info('MQTT connection closed'));
        client.on('error', (error: Error) => logger.error({ err: error }, 'MQTT client error'));
    }

    /** Publish the (retained) availability message; never throws */
    private async publishStatus(payload: string | undefined): Promise<void> {
        if (payload === undefined || !this._client.connected) return;
        try {
            await this._client.publishAsync(this._status.topic, payload, {
                qos: this._status.qos,
                retain: this._status.retain,
            });
        } catch (error: unknown) {
            logger.error({ err: error, topic: this._status.topic }, 'Failed to publish MQTT status');
        }
    }

    private queuePublish(topic: string, payload: string): void {
        if (this._pendingPublishes.length >= MAX_PENDING_PUBLISHES) {
            const dropped = this._pendingPublishes.shift();
            logger.error({ topic: dropped?.topic }, 'Dropping oldest queued MQTT publish; queue is full');
        }
        this._pendingPublishes.push({ topic, payload, attempts: 0 });
    }

    /** All publishes go through the queue so that ordering is preserved */
    private async publish(topic: string, payload: string): Promise<void> {
        this.queuePublish(topic, payload);
        await this.flushPendingPublishes();
    }

    private async flushPendingPublishes(): Promise<void> {
        if (this._flushing || !this._client.connected) return;
        this._flushing = true;
        try {
            while (this._client.connected) {
                const next = this._pendingPublishes[0];
                if (!next) return;
                let sent = false;
                try {
                    await this._client.publishAsync(next.topic, next.payload);
                    sent = true;
                } catch (error: unknown) {
                    next.attempts += 1;
                    logger.error({ err: error, topic: next.topic }, 'MQTT publish failed; will retry on reconnect');
                    if (next.attempts >= MAX_PUBLISH_ATTEMPTS) {
                        logger.error({ topic: next.topic }, 'Dropping MQTT publish after repeated failures');
                        sent = true; // remove it so that it cannot block the queue
                    }
                }
                // The queue may have dropped its head while we were awaiting; only remove what we handled
                const index = this._pendingPublishes.indexOf(next);
                if (sent && index >= 0) this._pendingPublishes.splice(index, 1);
                if (!sent) return;
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
        const topic = `${this._topicRoot}/${name}/${safeEventTopic}`;
        logger.info(`Publishing on ${topic}`);
        await this.publish(topic, JSON.stringify(message));
    }

    public async ping(version: string | number): Promise<void> {
        const topic = this._topicRoot;

        const data = { name: 'onvif-mqtt', action: 'started', version };
        await this.publish(topic, JSON.stringify(data));
    }

    public async notify(text: string): Promise<void> {
        const topic = this._topicRoot;

        const data = { name: 'onvif-mqtt', action: 'notify', text };
        await this.publish(topic, JSON.stringify(data));
    }

    public async error(text: string): Promise<void> {
        const topic = this._topicRoot;

        const data = { name: 'onvif-mqtt', action: 'error', text };
        await this.publish(topic, JSON.stringify(data));
    }

    public async close(): Promise<void> {
        // A clean disconnect does not trigger the Last Will, so announce it explicitly
        await this.publishStatus(this._status.offlinePayload);
        await this._client.endAsync();
    }
}
