import { isAuthenticationError, nextRetryDelay } from '../src/retry';

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

    it('doubles retry delays up to one hour', () => {
        expect(nextRetryDelay(1000)).toBe(2000);
        expect(nextRetryDelay(30 * 60 * 1000)).toBe(60 * 60 * 1000);
        expect(nextRetryDelay(60 * 60 * 1000)).toBe(60 * 60 * 1000);
    });
});
