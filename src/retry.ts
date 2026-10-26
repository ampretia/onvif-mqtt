/*
 * SPDX-License-Identifier: Apache-2.0
 */

const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
const AUTH_ERROR_PATTERN =
    /\b401\b|unauthori[sz]ed|not[\s_-]?authorized|authentication failed|invalid (?:credentials|username|password)/i;

export function isAuthenticationError(error: unknown): boolean {
    const visited = new Set<unknown>();
    let current = error;

    while (current !== null && current !== undefined && !visited.has(current)) {
        visited.add(current);

        if (typeof current === 'string') {
            return AUTH_ERROR_PATTERN.test(current);
        }
        if (typeof current !== 'object') {
            return false;
        }

        const candidate = current as { cause?: unknown; message?: unknown; status?: unknown; statusCode?: unknown };
        if (candidate.status === 401 || candidate.statusCode === 401) {
            return true;
        }
        if (typeof candidate.message === 'string' && AUTH_ERROR_PATTERN.test(candidate.message)) {
            return true;
        }
        current = candidate.cause;
    }

    return false;
}

export function nextRetryDelay(delay: number): number {
    return Math.min(delay * 2, MAX_RETRY_DELAY_MS);
}
