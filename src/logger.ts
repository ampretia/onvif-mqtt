/*
 * SPDX-License-Identifier: Apache-2.0
 */

import pino from 'pino';
const transport = pino.transport({
    target: 'pino-pretty',
    options: { destination: 1 }, // use 2 for stderr
});
export const logger = pino(transport);
