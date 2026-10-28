/*
 * SPDX-License-Identifier: Apache-2.0
 */

import pino from 'pino';
const isTest = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
const transport = isTest
    ? undefined
    : pino.transport({
          target: 'pino-pretty',
          options: {
              destination: 1,
              translateTime: 'SYS:standard',
          }, // use 2 for stderr
      });

export const logger = pino(
    {
        level: process.env.PINO_LOG_LEVEL || (isTest ? 'silent' : 'info'),
    },
    transport,
);
