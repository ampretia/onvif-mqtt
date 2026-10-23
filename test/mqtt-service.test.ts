import MQTT from 'mqtt';
import { getConfig } from '../src/config';
import MQTTService from '../src/mqtt-service';

jest.mock('mqtt', () => ({
    __esModule: true,
    default: { connectAsync: jest.fn() },
}));
jest.mock('../src/config', () => ({ getConfig: jest.fn() }));

const mockConnectAsync = MQTT.connectAsync as jest.MockedFunction<typeof MQTT.connectAsync>;
const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;

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

    const client = {
        publishAsync: jest.fn().mockResolvedValue(undefined),
        endAsync: jest.fn().mockResolvedValue(undefined),
    } as unknown as MQTT.MqttClient;

    beforeEach(() => {
        jest.clearAllMocks();
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
});
