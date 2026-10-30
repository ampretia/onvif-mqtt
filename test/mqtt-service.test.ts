import { EventEmitter } from 'events';
import { hostname } from 'os';
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
            eventTime: '2026-10-21T12:00:00.000Z',
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
            clientId: `onvif-mqtt-${hostname()}-${process.pid}`,
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
            'camera/status',
            JSON.stringify({ name: 'onvif-mqtt', action: 'online' }),
            { qos: 1, retain: true },
        );
        expect(client.publishAsync).toHaveBeenNthCalledWith(
            2,
            'camera/front-door/Motion',
            JSON.stringify({
                eventTime: '2026-10-21T12:00:00.000Z',
                eventProperty: 'Changed',
                sourceName: 'Source',
                sourceValue: 'front-door',
                dataName: 'State',
                dataValue: 'true',
            }),
            { qos: 0, retain: false },
        );
        expect(client.publishAsync).toHaveBeenNthCalledWith(
            3,
            'camera',
            JSON.stringify({ name: 'onvif-mqtt', action: 'started', version: 1 }),
            { qos: 0, retain: false },
        );
        expect(client.publishAsync).toHaveBeenNthCalledWith(
            4,
            'camera',
            JSON.stringify({ name: 'onvif-mqtt', action: 'notify', text: 'ready' }),
            { qos: 0, retain: false },
        );
        expect(client.publishAsync).toHaveBeenNthCalledWith(
            5,
            'camera/status',
            JSON.stringify({ name: 'onvif-mqtt', action: 'offline' }),
            { qos: 1, retain: true },
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

    it('passes TLS options and rejects unauthorized setting when configured', async () => {
        mockGetConfig.mockReturnValue({
            ...config,
            mqtt: {
                ...config.mqtt,
                broker_host: 'mqtts://localhost:8883',
                reject_unauthorized: false,
            },
        });

        await MQTTService.getMQTT();

        expect(mockConnectAsync).toHaveBeenCalledWith(
            'mqtts://localhost:8883',
            expect.objectContaining({
                rejectUnauthorized: false,
            }),
        );
    });

    it('applies configured QoS and retain settings to camera events', async () => {
        mockGetConfig.mockReturnValue({
            ...config,
            mqtt: {
                ...config.mqtt,
                qos: 1,
                retain: true,
            },
            cameras: {
                ...config.cameras,
                'front-door': {
                    hostname: '192.168.1.10',
                    onvif_port: '80',
                    username: 'user',
                    password: 'password',
                    connect: { retries: 1, delay: 100 },
                    qos: 2,
                    retain: true,
                },
            },
        });

        const service = await MQTTService.getMQTT();
        client.publishAsync.mockClear();

        await service.processEvent({
            name: 'front-door',
            eventTime: '2026-10-21T12:00:00.000Z',
            eventTopic: 'Motion',
            eventProperty: 'Changed',
            sourceName: 'Source',
            sourceValue: 'front-door',
            dataName: 'State',
            dataValue: 'true',
        });

        expect(client.publishAsync).toHaveBeenCalledWith('camera/front-door/Motion', expect.any(String), {
            qos: 2,
            retain: true,
        });
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
        client.emit('connect', { cmd: 'connack', sessionPresent: false } as unknown as import('mqtt').IConnackPacket);
        await new Promise<void>((resolve) => setImmediate(resolve));

        // the online status message plus the 100 retained queue entries
        expect(client.publishAsync).toHaveBeenCalledTimes(101);
        expect(client.publishAsync).toHaveBeenNthCalledWith(
            2,
            'camera',
            JSON.stringify({ name: 'onvif-mqtt', action: 'notify', text: 'message-1' }),
            { qos: 0, retain: false },
        );
    });

    it('queues a failed publish for retry on the next connection', async () => {
        const service = await MQTTService.getMQTT();
        client.publishAsync.mockRejectedValueOnce(new Error('socket closed'));

        await expect(service.ping(1)).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalledWith(
            { err: expect.any(Error), topic: 'camera' },
            'MQTT publish failed; will retry on reconnect',
        );

        client.emit('error', new Error('socket closed'));
        expect(logger.error).toHaveBeenCalledWith({ err: expect.any(Error) }, 'MQTT client error');
        client.emit('connect', { cmd: 'connack', sessionPresent: false } as unknown as import('mqtt').IConnackPacket);
        await new Promise<void>((resolve) => setImmediate(resolve));

        // online status, failed ping, online status again on reconnect, then the retried ping
        expect(client.publishAsync).toHaveBeenCalledTimes(4);
    });

    it('sanitizes event topic segments while preserving the topic hierarchy', async () => {
        const service = await MQTTService.getMQTT();

        await service.processEvent({
            name: 'front-door',
            eventTime: '2026-10-21T12:00:00.000Z',
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
            { qos: 0, retain: false },
        );
    });

    it('skips events without any non-empty topic segments', async () => {
        const service = await MQTTService.getMQTT();
        client.publishAsync.mockClear();

        await service.processEvent({
            name: 'front-door',
            eventTime: '2026-10-21T12:00:00.000Z',
            eventTopic: '//',
            eventProperty: 'Changed',
            sourceName: 'Source',
            sourceValue: 'front-door',
            dataName: 'State',
            dataValue: 'true',
        });

        expect(client.publishAsync).not.toHaveBeenCalled();
    });

    it('keeps publish order when messages are published while a flush is in flight', async () => {
        const service = await MQTTService.getMQTT();
        client.publishAsync.mockClear();
        let release: () => void = () => {};
        client.publishAsync.mockImplementationOnce(
            () => new Promise<never>((resolve) => (release = () => resolve(undefined as never))),
        );

        const first = service.notify('first');
        const second = service.notify('second');
        release();
        await Promise.all([first, second]);
        await new Promise<void>((resolve) => setImmediate(resolve));

        const texts: string[] = client.publishAsync.mock.calls.map(
            ([, payload]) => (JSON.parse(payload as string) as { text: string }).text,
        );
        expect(texts).toEqual(['first', 'second']);
    });

    it('does not lose or duplicate messages when the queue overflows during a flush', async () => {
        const service = await MQTTService.getMQTT();
        client.publishAsync.mockClear();
        let release: () => void = () => {};
        client.publishAsync.mockImplementationOnce(
            () => new Promise<never>((resolve) => (release = () => resolve(undefined as never))),
        );

        const pending = service.notify('m-0');
        for (let index = 1; index <= 100; index += 1) {
            void service.notify(`m-${index}`);
        }
        release();
        await pending;
        await new Promise<void>((resolve) => setImmediate(resolve));

        const texts: string[] = client.publishAsync.mock.calls.map(
            ([, payload]) => (JSON.parse(payload as string) as { text: string }).text,
        );
        expect(new Set(texts).size).toBe(texts.length);
        expect(texts).toEqual(Array.from({ length: texts.length }, (_, index) => `m-${index}`));
        expect(texts[texts.length - 1]).toBe('m-100');
    });

    it('drops a message that repeatedly fails so it cannot block the queue', async () => {
        const service = await MQTTService.getMQTT();
        client.publishAsync.mockClear();
        client.publishAsync.mockRejectedValue(new Error('payload rejected'));

        await service.notify('poison');
        await service.ping(1); // drives another flush attempt
        await service.ping(1);
        client.publishAsync.mockResolvedValue(undefined);
        await service.notify('good');

        expect(logger.error).toHaveBeenCalledWith({ topic: 'camera' }, 'Dropping MQTT publish after repeated failures');
        const lastPayload = client.publishAsync.mock.calls[client.publishAsync.mock.calls.length - 1]?.[1] as string;
        expect(JSON.parse(lastPayload)).toMatchObject({ text: 'good' });
    });
});
