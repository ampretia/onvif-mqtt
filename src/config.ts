/*
 * SPDX-License-Identifier: Apache-2.0
 */

import { cosmiconfigSync } from 'cosmiconfig';
import { z } from 'zod';

const nonEmptyString = z.string().min(1, 'must be a non-empty string');
const noWildcards = (value: string) => !/[+#]/.test(value);
const nonNegativeInteger = z
    .number()
    .int('must be a non-negative integer')
    .nonnegative('must be a non-negative integer');

const qosSchema = z.union([z.literal(0), z.literal(1), z.literal(2)], { error: 'must be 0, 1, or 2' });

const cameraSchema = z.object({
    hostname: nonEmptyString,
    onvif_port: nonEmptyString.regex(/^\d+$/, 'must be numeric'),
    username: nonEmptyString,
    password: nonEmptyString,
    connect: z.object({ retries: nonNegativeInteger, delay: nonNegativeInteger }),
    qos: qosSchema.optional(),
    retain: z.boolean({ error: 'must be a boolean' }).optional(),
});

const willSchema = z.object({
    topic: nonEmptyString.refine(noWildcards, 'must not contain MQTT wildcards'),
    payload: nonEmptyString,
    online_payload: nonEmptyString.optional(),
    qos: qosSchema.optional(),
    retain: z.boolean({ error: 'must be a boolean' }).optional(),
});

const appConfigSchema = z.object({
    mqtt: z.object({
        broker_host: nonEmptyString,
        topic_root: nonEmptyString.refine(noWildcards, 'must not contain MQTT wildcards'),
        username: nonEmptyString,
        password: nonEmptyString,
        client_id: nonEmptyString.optional(),
        qos: qosSchema.optional(),
        retain: z.boolean({ error: 'must be a boolean' }).optional(),
        reject_unauthorized: z.boolean({ error: 'must be a boolean' }).optional(),
        ca_cert: nonEmptyString.optional(),
        client_cert: nonEmptyString.optional(),
        client_key: nonEmptyString.optional(),
        will: willSchema.optional(),
    }),
    cameras: z.record(z.string(), cameraSchema).superRefine((cameras, ctx) => {
        for (const name of Object.keys(cameras)) {
            if (name.length === 0 || /[+#/]/.test(name)) {
                ctx.addIssue({ code: 'custom', path: [name], message: 'must be a valid MQTT topic segment' });
            }
        }
    }),
});

export type CameraConfig = z.infer<typeof cameraSchema>;
export type AppConfig = z.infer<typeof appConfigSchema>;

interface ConfigOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
}

type ConfigObject = Record<string, unknown>;

const explorer = cosmiconfigSync('onvif-mqtt');

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

function validateConfig(value: unknown): AppConfig {
    const result = appConfigSchema.safeParse(value);
    if (!result.success) {
        const problems = result.error.issues.map((issue) => {
            const field = issue.path.length > 0 ? issue.path.join('.') : 'root';
            return `Configuration field "${field}" ${issue.message}`;
        });
        throw new Error(problems.join('; '));
    }
    return result.data;
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
