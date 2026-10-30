/*
SPDX-License-Identifier: Apache-2.0
*/

import { logger } from './logger';
import { readFileSync } from 'fs';
import * as path from 'path';
import { createApp } from './app';

const SHUTDOWN_TIMEOUT_MS = 15 * 1000;

const pjson = readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8');
const version = (JSON.parse(pjson) as { version: string }).version;

console.log(
    `
                    _ ____                            __  __
  ____  ____ _   __(_) __/           ____ ___  ____ _/ /_/ /_
 / __ \\/ __ \\ | / / / /_   ______   / __ \`__ \\/ __ \`/ __/ __/
/ /_/ / / / / |/ / / __/  /_____/  / / / / / / /_/ / /_/ /_
\\____/_/ /_/|___/_/_/             /_/ /_/ /_/\\__, /\\__/\\__/
                                               /_/
`,
);

const app = createApp(version);

/** Shut the app down and make sure the process cannot be held open indefinitely by work that cannot be cancelled */
const shutdown = (exitCode = 0): Promise<void> => {
    if (exitCode !== 0 || process.exitCode === undefined) process.exitCode = exitCode;

    const deadline = setTimeout(() => {
        logger.error(`Shutdown did not complete within ${SHUTDOWN_TIMEOUT_MS / 1000}s; forcing exit`);
        process.exit(process.exitCode ?? 1);
    }, SHUTDOWN_TIMEOUT_MS);
    deadline.unref();
    return app.shutdown().finally(() => clearTimeout(deadline));
};

process.once('SIGINT', () => {
    logger.info('Received SIGINT, shutting down');
    void shutdown();
});
process.once('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down');
    void shutdown();
});
process.once('unhandledRejection', (reason: unknown) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
    void shutdown(1);
});
process.once('uncaughtException', (error: Error) => {
    logger.error({ err: error }, 'Uncaught exception');
    void shutdown(1);
});

app.start().catch((e: unknown) => {
    logger.error({ err: e }, 'Fatal error in main');
    void shutdown(1);
});
