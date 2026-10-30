/*
 * SPDX-License-Identifier: Apache-2.0
 */

import pino from 'pino';

/**
 * Logging is configured purely through the environment:
 *  - PINO_LOG_LEVEL: pino level, default 'info'
 *  - LOG_FORMAT: 'pretty' (human readable, uses a worker thread) or 'json' (plain pino output, no worker)
 *    Defaults to 'json' in production (NODE_ENV=production) and 'pretty' in development.
 */
const isProduction = process.env.NODE_ENV === 'production';
const usePretty = (process.env.LOG_FORMAT ?? (isProduction ? 'json' : 'pretty')) !== 'json';
const transport = usePretty
    ? pino.transport({
          target: 'pino-pretty',
          options: {
              destination: 1,
              translateTime: 'SYS:standard',
          }, // use 2 for stderr
      })
    : undefined;

export const logger = pino(
    {
        level: process.env.PINO_LOG_LEVEL || 'info',
    },
    transport,
);
