import Camera from '../src/camera';
import MQTTService from '../src/mqtt-service';
import { logger } from '../src/logger';

jest.mock('../src/mqtt-service', () => ({
    __esModule: true,
    default: { getMQTT: jest.fn() },
}));
jest.mock('../src/logger', () => ({
    logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
jest.mock('../src/camera', () => ({
    __esModule: true,
    default: { listCameras: jest.fn(() => []), getCamera: jest.fn() },
}));

const mockGetMQTT = jest.mocked(MQTTService.getMQTT);
const mockListCameras = jest.mocked(Camera.listCameras);
const mockGetCamera = jest.mocked(Camera.getCamera);
type ProcessListener = (...args: unknown[]) => void;
const processEvents = ['SIGINT', 'SIGTERM', 'unhandledRejection', 'uncaughtException'] as const;
let listenersBefore: Map<(typeof processEvents)[number], ProcessListener[]>;
let exitCodeBefore: string | number | null | undefined;

describe('main startup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetMQTT.mockRejectedValue(new Error('MQTT unavailable'));
        mockListCameras.mockReturnValue([]);
        listenersBefore = new Map();
        for (const event of processEvents) {
            listenersBefore.set(event, (process.listeners as (e: string) => ProcessListener[])(event));
        }
        exitCodeBefore = process.exitCode;
    });

    afterEach(() => {
        for (const event of processEvents) {
            const initialListeners = listenersBefore.get(event) ?? [];
            for (const listener of (process.listeners as (e: string) => ProcessListener[])(event)) {
                if (!initialListeners.includes(listener)) {
                    (process.removeListener as (e: string, fn: ProcessListener) => void)(event, listener);
                }
            }
        }
        process.exitCode = exitCodeBefore;
        jest.restoreAllMocks();
    });

    it('logs the fatal startup error and sets a failing exit code', async () => {
        jest.isolateModules(() => {
            jest.requireActual('../src/main');
        });
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(logger.error).toHaveBeenCalledWith({ err: expect.any(Error) }, 'Fatal error in main');
        expect(process.exitCode).toBe(1);
    });

    it('disposes cameras, clears timers, and closes MQTT on SIGTERM', async () => {
        const camera = {
            getDeviceInformation: jest.fn().mockResolvedValue({ info: {}, xml: '' }),
            getSystemDateAndTime: jest.fn().mockResolvedValue({ info: {}, xml: '' }),
            getCapabilities: jest.fn().mockResolvedValue({ info: {}, xml: '' }),
            setEventHandler: jest.fn(),
            setErrorEventHandler: jest.fn(),
            dispose: jest.fn().mockResolvedValue(undefined),
        };
        const service = {
            ping: jest.fn().mockResolvedValue(undefined),
            notify: jest.fn().mockResolvedValue(undefined),
            error: jest.fn().mockResolvedValue(undefined),
            close: jest.fn().mockResolvedValue(undefined),
        };
        const clearInterval = jest.spyOn(global, 'clearInterval');
        const clearTimeout = jest.spyOn(global, 'clearTimeout');
        mockGetMQTT.mockResolvedValue(service as unknown as MQTTService);
        mockListCameras.mockReturnValue(['door', 'offline']);
        mockGetCamera.mockResolvedValueOnce(camera as unknown as Camera).mockRejectedValueOnce(new Error('offline'));

        jest.isolateModules(() => {
            jest.requireActual('../src/main');
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        process.emit('SIGTERM');
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(camera.dispose).toHaveBeenCalledTimes(1);
        expect(clearInterval).toHaveBeenCalledTimes(1);
        // one pending reconnect timer plus the shutdown deadline
        expect(clearTimeout).toHaveBeenCalledTimes(2);
        expect(service.close).toHaveBeenCalledTimes(1);
        expect(process.exitCode).toBe(0);
    });

    it('does not back off after an authentication failure but retries it on the next ping cycle', async () => {
        const service = {
            ping: jest.fn().mockResolvedValue(undefined),
            notify: jest.fn().mockResolvedValue(undefined),
            error: jest.fn().mockResolvedValue(undefined),
            close: jest.fn().mockResolvedValue(undefined),
        };
        const setTimeout = jest.spyOn(global, 'setTimeout');
        const setInterval = jest.spyOn(global, 'setInterval');
        mockGetMQTT.mockResolvedValue(service as unknown as MQTTService);
        mockListCameras.mockReturnValue(['door']);
        mockGetCamera.mockRejectedValue(new Error('Digest authentication failed 401'));

        jest.isolateModules(() => {
            jest.requireActual('../src/main');
        });
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(mockGetCamera).toHaveBeenCalledTimes(1);
        const pingCycle = setInterval.mock.calls[0]?.[0] as (() => void) | undefined;
        pingCycle?.();
        await new Promise<void>((resolve) => setImmediate(resolve));
        // no backoff timer was scheduled, but the ping cycle made one more attempt
        expect(setTimeout).not.toHaveBeenCalled();
        expect(mockGetCamera).toHaveBeenCalledTimes(2);
        expect(service.error).toHaveBeenCalledTimes(2);
        expect(service.error).toHaveBeenCalledWith('[door] connection failed: authentication failed');
        process.emit('SIGTERM');
        await new Promise<void>((resolve) => setImmediate(resolve));
    });

    it('doubles reconnect delays after consecutive connection failures', async () => {
        const service = {
            ping: jest.fn().mockResolvedValue(undefined),
            notify: jest.fn().mockResolvedValue(undefined),
            error: jest.fn().mockResolvedValue(undefined),
            close: jest.fn().mockResolvedValue(undefined),
        };
        const setTimeout = jest.spyOn(global, 'setTimeout');
        mockGetMQTT.mockResolvedValue(service as unknown as MQTTService);
        mockListCameras.mockReturnValue(['door']);
        mockGetCamera.mockRejectedValue(new Error('offline'));

        jest.isolateModules(() => {
            jest.requireActual('../src/main');
        });
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 60_000);
        const reconnect = setTimeout.mock.calls[0]?.[0] as (() => void) | undefined;
        const reconnectTimer = setTimeout.mock.results[0]?.value as ReturnType<typeof global.setTimeout> | undefined;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnect?.();
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(mockGetCamera).toHaveBeenCalledTimes(2);
        expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 120_000);
        process.emit('SIGTERM');
        await new Promise<void>((resolve) => setImmediate(resolve));
    });

    it('treats notify failure as non-fatal and keeps camera connected', async () => {
        const camera = {
            getDeviceInformation: jest.fn().mockResolvedValue({ info: {}, xml: '' }),
            getSystemDateAndTime: jest.fn().mockResolvedValue({ info: {}, xml: '' }),
            getCapabilities: jest.fn().mockResolvedValue({ info: {}, xml: '' }),
            setEventHandler: jest.fn(),
            setErrorEventHandler: jest.fn(),
            dispose: jest.fn().mockResolvedValue(undefined),
        };
        const service = {
            ping: jest.fn().mockResolvedValue(undefined),
            notify: jest.fn().mockRejectedValue(new Error('MQTT notify failed')),
            error: jest.fn().mockResolvedValue(undefined),
            close: jest.fn().mockResolvedValue(undefined),
        };
        mockGetMQTT.mockResolvedValue(service as unknown as MQTTService);
        mockListCameras.mockReturnValue(['door']);
        mockGetCamera.mockResolvedValue(camera as unknown as Camera);

        jest.isolateModules(() => {
            jest.requireActual('../src/main');
        });
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(service.notify).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledWith({ err: expect.any(Error) }, 'Failed to publish notification to MQTT');
        process.emit('SIGTERM');
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(camera.dispose).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['unhandledRejection', 'Unhandled promise rejection'],
        ['uncaughtException', 'Uncaught exception'],
    ] as const)('shuts down on %s', async (event, message) => {
        const error = new Error('process failure');
        const service = { ping: jest.fn().mockResolvedValue(undefined), close: jest.fn().mockResolvedValue(undefined) };
        mockGetMQTT.mockResolvedValue(service as unknown as MQTTService);

        jest.isolateModules(() => {
            jest.requireActual('../src/main');
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        (process.emit as (event: string, ...args: unknown[]) => boolean)(event, error, 'uncaughtException');
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(logger.error).toHaveBeenCalledWith({ err: error }, message);
        expect(service.close).toHaveBeenCalledTimes(1);
        expect(process.exitCode).toBe(1);
    });
});
