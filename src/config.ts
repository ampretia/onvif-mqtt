/*
 * SPDX-License-Identifier: Apache-2.0
 */

import { cosmiconfigSync } from 'cosmiconfig';
import { z } from 'zod';

export interface CameraConfig {
    hostname: string;
    onvif_port: string;
    username: string;
    password: string;
    connect: {
        retries: number;
        delay: number;
    };
}

export interface AppConfig {
    mqtt: {
        broker_host: string;
        topic_root: string;
        username: string;
        password: string;
    };
    cameras: Record<string, CameraConfig>;
}

interface ConfigOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
}

type ConfigObject = Record<string, unknown>;

const explorer = cosmiconfigSync('onvif-mqtt');
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const numericPortSchema = z.string().regex(/^\d+$/);

function isObject(value: unknown): value is ConfigObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function substituteEnvironmentVariables(value: unknown, env: NodeJS.ProcessEnv): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => substituteEnvironmentVariables(item, env));
    }
    if (isObject(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, substituteEnvironmentVariables(item, env)]),
        );
    }
    if (typeof value === 'string' && value.startsWith('@@')) {
        return env[value.slice(2)];
    }
    return value;
}

function collectEnvironmentReferences(value: unknown, names = new Set<string>()): Set<string> {
    if (Array.isArray(value)) {
        for (const item of value) {
            collectEnvironmentReferences(item, names);
        }
    } else if (isObject(value)) {
        for (const item of Object.values(value)) {
            collectEnvironmentReferences(item, names);
        }
    } else if (typeof value === 'string' && value.startsWith('@@')) {
        names.add(value.slice(2));
    }
    return names;
}

function validateEnvironmentSecrets(value: unknown, env: NodeJS.ProcessEnv): Record<string, string> {
    const names = collectEnvironmentReferences(value);
    const schema = z.object(
        Object.fromEntries([...names].map((name) => [name, z.string().min(1, `${name} is required`)])),
    );
    const secretValues = Object.fromEntries([...names].map((name) => [name, env[name]]));
    const result = schema.safeParse(secretValues);

    if (!result.success) {
        console.error('Invalid configuration secrets:', result.error.format());
        throw new Error('Configuration secrets validation failed');
    }

    return result.data;
}

function requireObject(value: unknown, name: string): ConfigObject {
    if (!isObject(value)) {
        throw new Error(`Configuration field "${name}" must be an object`);
    }
    return value;
}

function requireString(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Configuration field "${name}" must be a non-empty string`);
    }
    return value;
}

function validateConfig(value: unknown): AppConfig {
    const root = requireObject(value, 'root');
    const mqtt = requireObject(root.mqtt, 'mqtt');
    const cameras = requireObject(root.cameras, 'cameras');

    for (const key of ['broker_host', 'topic_root', 'username', 'password']) {
        requireString(mqtt[key], `mqtt.${key}`);
    }

    for (const [name, cameraValue] of Object.entries(cameras)) {
        if (name.length === 0 || /[+#/]/.test(name)) {
            throw new Error(`Configuration field "cameras.${name}" must be a valid MQTT topic segment`);
        }
        const camera = requireObject(cameraValue, `cameras.${name}`);
        for (const key of ['hostname', 'onvif_port', 'username', 'password']) {
            requireString(camera[key], `cameras.${name}.${key}`);
        }
        if (!numericPortSchema.safeParse(camera.onvif_port).success) {
            throw new Error(`Configuration field "cameras.${name}.onvif_port" must be numeric`);
        }
        const connect = requireObject(camera.connect, `cameras.${name}.connect`);
        for (const key of ['retries', 'delay']) {
            if (!nonNegativeIntegerSchema.safeParse(connect[key]).success) {
                throw new Error(`Configuration field "cameras.${name}.connect.${key}" must be a non-negative integer`);
            }
        }
    }

    return value as AppConfig;
}

export function loadConfig(options: ConfigOptions = {}): AppConfig {
    const cwd = options.cwd || process.cwd();
    const env = options.env || process.env;
    const result = explorer.search(cwd);
    if (!result || !isObject(result.config)) {
        throw new Error(`No valid onvif-mqtt JSON configuration found from ${cwd}`);
    }

    const secrets = validateEnvironmentSecrets(result.config, env);
    return validateConfig(substituteEnvironmentVariables(result.config, secrets));
}

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
    if (!cachedConfig) {
        cachedConfig = loadConfig();
    }
    return cachedConfig;
}
