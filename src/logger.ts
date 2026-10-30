/*
 * SPDX-License-Identifier: Apache-2.0
 */

import pino from 'pino';

/**
 * Logging is configured purely through the environment:
 *  - PINO_LOG_LEVEL: pino level, default 'info'
 *  - LOG_FORMAT: 'pretty' (default, human readable, uses a worker thread) or 'json' (plain pino output, no worker)
 */
const usePretty = (process.env.LOG_FORMAT ?? 'pretty') !== 'json';
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
