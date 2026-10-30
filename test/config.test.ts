import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
    let configRoot: string;

    const writeConfig = (cameras: Record<string, unknown> = {}, mqttSettings: Record<string, unknown> = {}) => {
        writeFileSync(
            path.join(configRoot, '.onvif-mqttrc.json'),
            JSON.stringify({
                mqtt: {
                    broker_host: 'mqtt://localhost',
                    topic_root: 'base',
                    username: 'base-user',
                    password: '@@MQTT_PASSWORD',
                    ...mqttSettings,
                },
                cameras,
            }),
        );
    };

    const validCamera = () => ({
        hostname: 'localhost',
        onvif_port: '8000',
        username: 'camera-user',
        password: 'camera-password',
        connect: { retries: 5, delay: 1000 },
    });

    beforeEach(() => {
        configRoot = mkdtempSync(path.join(os.tmpdir(), 'onvif-mqtt-config-'));
        writeConfig();
    });

    afterEach(() => {
        rmSync(configRoot, { recursive: true, force: true });
    });

    it('loads the standard JSON config file and substitutes environment variables', () => {
        const config = loadConfig({
            cwd: configRoot,
            env: { MQTT_PASSWORD: 'secret' },
        });

        expect(config.mqtt).toEqual({
            broker_host: 'mqtt://localhost',
            topic_root: 'base',
            username: 'base-user',
            password: 'secret',
        });
        expect(config.cameras).toEqual({});
    });

    it('accepts a configurable MQTT client ID and Last Will', () => {
        writeConfig(
            {},
            {
                client_id: 'bridge-office',
                will: {
                    topic: 'base/status',
                    payload: '{"name":"onvif-mqtt","action":"offline"}',
                    qos: 2,
                    retain: true,
                },
            },
        );

        const config = loadConfig({ cwd: configRoot, env: { MQTT_PASSWORD: 'secret' } });

        expect(config.mqtt.client_id).toBe('bridge-office');
        expect(config.mqtt.will).toEqual({
            topic: 'base/status',
            payload: '{"name":"onvif-mqtt","action":"offline"}',
            qos: 2,
            retain: true,
        });
    });

    it('rejects invalid Last Will topics and QoS values', () => {
        for (const will of [
            { topic: 'base/+', payload: 'offline' },
            { topic: 'base/status', payload: 'offline', qos: 3 },
        ]) {
            writeConfig({}, { will });
            expect(() => loadConfig({ cwd: configRoot, env: { MQTT_PASSWORD: 'secret' } })).toThrow('mqtt.will');
        }
    });

    it('rejects missing environment variables referenced by configuration', () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            expect(() =>
                loadConfig({
                    cwd: configRoot,
                    env: {},
                }),
            ).toThrow('Configuration secrets validation failed');
        } finally {
            consoleError.mockRestore();
        }
    });

    it.each([
        ['retries', -1],
        ['retries', 1.5],
        ['delay', -1],
        ['delay', 1.5],
    ] as const)('rejects invalid camera connect.%s value %s', (key, value) => {
        const camera = validCamera();
        camera.connect[key] = value;
        writeConfig({ door: camera });

        expect(() => loadConfig({ cwd: configRoot, env: { MQTT_PASSWORD: 'secret' } })).toThrow(
            `cameras.door.connect.${key}`,
        );
    });

    it('accepts a numeric ONVIF port string', () => {
        writeConfig({ door: validCamera() });

        const config = loadConfig({ cwd: configRoot, env: { MQTT_PASSWORD: 'secret' } });

        expect(config.cameras.door.onvif_port).toBe('8000');
    });

    it.each(['', 'front/door', 'front+door', 'front#door'])(
        'rejects camera name %j as an invalid MQTT topic segment',
        (name) => {
            writeConfig({ [name]: validCamera() });

            expect(() => loadConfig({ cwd: configRoot, env: { MQTT_PASSWORD: 'secret' } })).toThrow(
                'valid MQTT topic segment',
            );
        },
    );

    it('rejects a non-numeric ONVIF port', () => {
        writeConfig({ door: { ...validCamera(), onvif_port: 'not-a-port' } });

        expect(() => loadConfig({ cwd: configRoot, env: { MQTT_PASSWORD: 'secret' } })).toThrow(
            'cameras.door.onvif_port',
        );
    });

    it('requires standard JSON syntax', () => {
        writeFileSync(
            path.join(configRoot, '.onvif-mqttrc.json'),
            "{ mqtt: { broker_host: 'mqtt://localhost', topic_root: 'camera', username: 'user', password: 'pw', }, cameras: {}, }",
        );

        expect(() => loadConfig({ cwd: configRoot, env: {} })).toThrow();
    });

    it('does not require runtime config just to import the library entry point', () => {
        const importEntryPoint = () => {
            jest.isolateModules(() => {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                require('../src/index');
            });
        };
        expect(importEntryPoint).not.toThrow();
    });

    it('rejects wildcards in topic_root', () => {
        writeConfig({}, { topic_root: 'camera/#' });

        expect(() => loadConfig({ cwd: configRoot, env: { MQTT_PASSWORD: 'secret' } })).toThrow('mqtt.topic_root');
    });

    it('reports every problem in one error', () => {
        writeConfig({ door: { ...validCamera(), hostname: '', onvif_port: 'x' } });

        expect(() => loadConfig({ cwd: configRoot, env: { MQTT_PASSWORD: 'secret' } })).toThrow(
            /cameras\.door\.hostname.*cameras\.door\.onvif_port/,
        );
    });

    it('accepts an optional Last Will online_payload', () => {
        writeConfig(
            {},
            { will: { topic: 'base/status', payload: 'offline', online_payload: 'online', qos: 1, retain: true } },
        );

        const config = loadConfig({ cwd: configRoot, env: { MQTT_PASSWORD: 'secret' } });

        expect(config.mqtt.will?.online_payload).toBe('online');
    });
});
