import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
    let configRoot: string;

    beforeEach(() => {
        configRoot = mkdtempSync(path.join(os.tmpdir(), 'onvif-mqtt-config-'));
        writeFileSync(
            path.join(configRoot, '.onvif-mqttrc.json'),
            JSON.stringify({
                mqtt: {
                    broker_host: 'mqtt://localhost',
                    topic_root: 'base',
                    username: 'base-user',
                    password: '@@MQTT_PASSWORD',
                },
                cameras: {},
            }),
        );
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
});
