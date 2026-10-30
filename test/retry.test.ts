import { isAuthenticationError, isTimeoutError, nextRetryDelay, sleep, withRetry } from '../src/retry';

describe('retry policy', () => {
    it.each([
        [
            'Digest authentication failed 401',
            new Error('connection failed', { cause: new Error('Digest authentication failed 401') }),
        ],
        ['NotAuthorized SOAP fault', new Error('ONVIF SOAP Fault: ter:NotAuthorized')],
        ['HTTP status code', Object.assign(new Error('request failed'), { statusCode: 401 })],
    ])('recognizes %s as an authentication failure', (_description, error) => {
        expect(isAuthenticationError(error)).toBe(true);
    });

    it('does not classify unrelated connection errors as authentication failures', () => {
        expect(isAuthenticationError(new Error('Network timeout'))).toBe(false);
    });

    it.each([
        ['Network timeout message', new Error('Network timeout')],
        ['Nested network timeout cause', new Error('call failed', { cause: new Error('Network timeout') })],
        ['ETIMEDOUT code', Object.assign(new Error('connect failed'), { code: 'ETIMEDOUT' })],
        ['ECONNRESET message', new Error('read ECONNRESET')],
        ['socket hang up', new Error('socket hang up')],
    ])('recognizes %s as a timeout/network error', (_description, error) => {
        expect(isTimeoutError(error)).toBe(true);
    });

    it('does not classify other errors as timeout errors', () => {
        expect(isTimeoutError(new Error('Digest authentication failed 401'))).toBe(false);
        expect(isTimeoutError(new Error('Invalid XML response'))).toBe(false);
    });

    it('doubles retry delays up to one hour', () => {
        expect(nextRetryDelay(1000)).toBe(2000);
        expect(nextRetryDelay(30 * 60 * 1000)).toBe(60 * 60 * 1000);
        expect(nextRetryDelay(60 * 60 * 1000)).toBe(60 * 60 * 1000);
    });
});

describe('sleep', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it('resolves after the delay', async () => {
        jest.useFakeTimers();
        let done = false;
        void sleep(1000).then(() => {
            done = true;
        });
        await jest.advanceTimersByTimeAsync(999);
        expect(done).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        expect(done).toBe(true);
    });

    it('rejects immediately when the signal aborts', async () => {
        jest.useFakeTimers();
        const controller = new AbortController();
        const result = sleep(60_000, controller.signal);
        controller.abort();
        await expect(result).rejects.toThrow('Aborted');
        await expect(sleep(1, controller.signal)).rejects.toThrow('Aborted');
    });
});

/** An operation that fails with the given errors in order, then succeeds with 'ok' */
const flaky = (...failures: Error[]) => {
    const state = { calls: 0 };
    const operation = (): Promise<string> => {
        const failure = failures[state.calls++];
        return failure ? Promise.reject(failure) : Promise.resolve('ok');
    };
    return { state, operation };
};

describe('withRetry', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it('retries with doubling delays and returns the first success', async () => {
        jest.useFakeTimers();
        const { state, operation } = flaky(new Error('one'), new Error('two'));
        const retries: Array<[number, number]> = [];

        const result = withRetry(operation, {
            retries: 3,
            delay: 100,
            onRetry: (_error, attempt, delay) => retries.push([attempt, delay]),
        });
        await jest.advanceTimersByTimeAsync(100);
        expect(state.calls).toBe(2);
        await jest.advanceTimersByTimeAsync(200);

        await expect(result).resolves.toBe('ok');
        expect(retries).toEqual([
            [1, 100],
            [2, 200],
        ]);
    });

    it('rethrows the last error once retries are exhausted', async () => {
        const error = new Error('always');
        const { state, operation } = flaky(error, error);

        await expect(withRetry(operation, { retries: 0, delay: 1 })).rejects.toBe(error);
        expect(state.calls).toBe(1);
    });

    it('does not retry when shouldRetry returns false', async () => {
        const { state, operation } = flaky(new Error('fatal'), new Error('fatal'));

        await expect(withRetry(operation, { retries: 5, delay: 1, shouldRetry: () => false })).rejects.toThrow('fatal');
        expect(state.calls).toBe(1);
    });

    it('stops waiting when aborted', async () => {
        jest.useFakeTimers();
        const controller = new AbortController();
        const { state, operation } = flaky(new Error('down'), new Error('down'));

        const result = withRetry(operation, { retries: 5, delay: 60_000, signal: controller.signal });
        const assertion = expect(result).rejects.toThrow();
        await jest.advanceTimersByTimeAsync(0);
        controller.abort();
        await assertion;
        expect(state.calls).toBe(1);
    });
});
