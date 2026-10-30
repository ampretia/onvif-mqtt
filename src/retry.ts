/*
 * SPDX-License-Identifier: Apache-2.0
 */

const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
const AUTH_ERROR_PATTERN =
    /\b401\b|unauthori[sz]ed|not[\s_-]?authorized|authentication failed|invalid (?:credentials|username|password)/i;
const TIMEOUT_ERROR_PATTERN =
    /\btimeout\b|etimedout|esockettimedout|econnreset|econnrefused|ehostunreach|network timeout|socket hang up/i;

export function isTimeoutError(error: unknown): boolean {
    const visited = new Set<unknown>();
    let current = error;

    while (current !== null && current !== undefined && !visited.has(current)) {
        visited.add(current);

        if (typeof current === 'string') {
            return TIMEOUT_ERROR_PATTERN.test(current);
        }
        if (typeof current !== 'object') {
            return false;
        }

        const candidate = current as { cause?: unknown; message?: unknown; code?: unknown };
        if (typeof candidate.code === 'string' && TIMEOUT_ERROR_PATTERN.test(candidate.code)) {
            return true;
        }
        if (typeof candidate.message === 'string' && TIMEOUT_ERROR_PATTERN.test(candidate.message)) {
            return true;
        }
        current = candidate.cause;
    }

    return false;
}

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

/** Resolve after `ms`, or reject immediately if `signal` aborts (so shutdown is not held up by a backoff wait) */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('Aborted'));
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(new Error('Aborted'));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

export interface RetryOptions {
    /** Number of retries after the first attempt */
    retries: number;
    /** Initial delay in ms; doubled (up to a cap) after every retry */
    delay: number;
    /** Return false for errors that must not be retried. Default: retry everything */
    shouldRetry?: (error: unknown) => boolean;
    onRetry?: (error: unknown, attempt: number, delay: number) => void;
    signal?: AbortSignal;
}

/** Run `operation`, retrying with exponential backoff. The last error is rethrown unchanged. */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
    let delay = options.delay;
    for (let attempt = 0; ; attempt++) {
        try {
            return await operation();
        } catch (error: unknown) {
            if (attempt >= options.retries || options.signal?.aborted || options.shouldRetry?.(error) === false) {
                throw error;
            }
            options.onRetry?.(error, attempt + 1, delay);
            await sleep(delay, options.signal);
            delay = nextRetryDelay(delay);
        }
    }
}
