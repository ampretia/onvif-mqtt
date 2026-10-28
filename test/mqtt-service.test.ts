import { EventEmitter } from 'events';
import MQTT from 'mqtt';
import { getConfig } from '../src/config';
import { logger } from '../src/logger';
import MQTTService from '../src/mqtt-service';

jest.mock('mqtt', () => ({
    __esModule: true,
    default: { connectAsync: jest.fn() },
}));
jest.mock('../src/config', () => ({ getConfig: jest.fn() }));
jest.mock('../src/logger', () => ({ logger: { info: jest.fn(), error: jest.fn() } }));

const mockConnectAsync = MQTT.connectAsync as jest.MockedFunction<typeof MQTT.connectAsync>;
const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;

type TestMqttClient = MQTT.MqttClient & {
    publishAsync: jest.MockedFunction<MQTT.MqttClient['publishAsync']>;
    endAsync: jest.MockedFunction<MQTT.MqttClient['endAsync']>;
};

describe('MQTTService', () => {
    const config = {
        mqtt: {
            broker_host: 'mqtt://localhost',
            topic_root: 'camera',
            username: 'mqtt-user',
            password: 'mqtt-password',
        },
        cameras: {},
    };

    const createClient = (): TestMqttClient =>
        Object.assign(new EventEmitter(), {
            connected: true,
            publishAsync: jest.fn().mockResolvedValue(undefined),
            endAsync: jest.fn().mockResolvedValue(undefined),
        }) as unknown as TestMqttClient;
    let client = createClient();

    beforeEach(() => {
        jest.clearAllMocks();
        client = createClient();
        mockGetConfig.mockReturnValue(config);
        mockConnectAsync.mockResolvedValue(client);
    });

    it('uses MQTT.js async APIs and preserves published topics and payloads', async () => {
        const service = await MQTTService.getMQTT();

        await service.processEvent({
            name: 'front-door',
            eventTime: { toJSON: () => '2026-10-21T12:00:00.000Z' },
            eventTopic: 'Motion',
            eventProperty: 'Changed',
            sourceName: 'Source',
            sourceValue: 'front-door',
            dataName: 'State',
            dataValue: 'true',
        });
        await service.ping(1);
        await service.notify('ready');
        await service.close();

        expect(mockConnectAsync).toHaveBeenCalledWith('mqtt://localhost', {
            username: 'mqtt-user',
            password: 'mqtt-password',
            clientId: `onvif-mqtt-${process.pid}`,
            reconnectPeriod: 1000,
            queueQoSZero: false,
            will: {
                topic: 'camera/status',
                payload: '{"name":"onvif-mqtt","action":"offline"}',
                qos: 1,
                retain: true,
            },
        });
        expect(client.publishAsync).toHaveBeenNthCalledWith(
            1,
            'camera/front-door/Motion',
            JSON.stringify({
                eventTime: '2026-10-21T12:00:00.000Z',
                eventProperty: 'Changed',
                sourceName: 'Source',
                sourceValue: 'front-door',
                dataName: 'State',
                dataValue: 'true',
            }),
        );
        expect(client.publishAsync).toHaveBeenNthCalledWith(
            2,
            'camera',
            JSON.stringify({ name: 'onvif-mqtt', action: 'started', version: 1 }),
        );
        expect(client.publishAsync).toHaveBeenNthCalledWith(
            3,
            'camera',
            JSON.stringify({ name: 'onvif-mqtt', action: 'notifiy', text: 'ready' }),
        );
        expect(client.endAsync).toHaveBeenCalledTimes(1);
    });

    it('uses configured client ID and Last Will settings', async () => {
        mockGetConfig.mockReturnValue({
            ...config,
            mqtt: {
                ...config.mqtt,
                client_id: 'bridge-office',
                will: { topic: 'bridge/availability', payload: 'offline', qos: 2, retain: false },
            },
        });

        await MQTTService.getMQTT();

        expect(mockConnectAsync).toHaveBeenCalledWith(
            'mqtt://localhost',
            expect.objectContaining({
                clientId: 'bridge-office',
                will: { topic: 'bridge/availability', payload: 'offline', qos: 2, retain: false },
            }),
        );
    });

    it('bounds offline publishes, drops the oldest when full, and flushes after reconnect', async () => {
        client.connected = false;
        const service = await MQTTService.getMQTT();

        for (let index = 0; index < 101; index += 1) {
            await service.notify(`message-${index}`);
        }
        expect(client.publishAsync).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith(
            { topic: 'camera' },
            'Dropping oldest queued MQTT publish; queue is full',
        );

        client.connected = true;
        client.emit('connect', {});
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(client.publishAsync).toHaveBeenCalledTimes(100);
        expect(client.publishAsync).toHaveBeenNthCalledWith(
            1,
            'camera',
            JSON.stringify({ name: 'onvif-mqtt', action: 'notifiy', text: 'message-1' }),
        );
    });

    it('queues a failed publish for retry on the next connection', async () => {
        const service = await MQTTService.getMQTT();
        client.publishAsync.mockRejectedValueOnce(new Error('socket closed'));

        await expect(service.ping(1)).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalledWith(
            { err: expect.any(Error), topic: 'camera' },
            'MQTT publish failed; queued for retry',
        );

        client.emit('error', new Error('socket closed'));
        expect(logger.error).toHaveBeenCalledWith({ err: expect.any(Error) }, 'MQTT client error');
        client.emit('connect', {});
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(client.publishAsync).toHaveBeenCalledTimes(2);
    });

    it('sanitizes event topic segments while preserving the topic hierarchy', async () => {
        const service = await MQTTService.getMQTT();

        await service.processEvent({
            name: 'front-door',
            eventTime: { toJSON: () => '2026-10-21T12:00:00.000Z' },
            eventTopic: 'Rule//Motion+/People#',
            eventProperty: 'Changed',
            sourceName: 'Source',
            sourceValue: 'front-door',
            dataName: 'State',
            dataValue: 'true',
        });

        expect(client.publishAsync).toHaveBeenCalledWith(
            'camera/front-door/Rule/Motion%2B/People%23',
            expect.any(String),
        );
    });

    it('skips events without any non-empty topic segments', async () => {
        const service = await MQTTService.getMQTT();

        await service.processEvent({
            name: 'front-door',
            eventTime: { toJSON: () => '2026-10-21T12:00:00.000Z' },
            eventTopic: '//',
            eventProperty: 'Changed',
            sourceName: 'Source',
            sourceValue: 'front-door',
            dataName: 'State',
            dataValue: 'true',
        });

        expect(client.publishAsync).not.toHaveBeenCalled();
    });
});
