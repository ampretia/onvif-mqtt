import Camera from '../src/camera';
import MQTTService from '../src/mqtt-service';
import { logger } from '../src/logger';

jest.mock('../src/mqtt-service', () => ({
    __esModule: true,
    default: { getMQTT: jest.fn() },
}));
jest.mock('../src/logger', () => ({
    logger: { info: jest.fn(), error: jest.fn() },
}));
jest.mock('../src/camera', () => ({
    __esModule: true,
    default: { listCameras: jest.fn(() => []), getCamera: jest.fn() },
}));
jest.mock('chalk', () => ({
    __esModule: true,
    default: { blue: { bold: (text: string) => text } },
}));

const mockGetMQTT = jest.mocked(MQTTService.getMQTT);
const mockListCameras = jest.mocked(Camera.listCameras);
const mockGetCamera = jest.mocked(Camera.getCamera);
const processEvents = ['SIGINT', 'SIGTERM', 'unhandledRejection', 'uncaughtException'] as const;
let listenersBefore: Map<(typeof processEvents)[number], unknown[]>;
let exitCodeBefore: number | undefined;

describe('main startup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetMQTT.mockRejectedValue(new Error('MQTT unavailable'));
        mockListCameras.mockReturnValue([]);
        listenersBefore = new Map();
        for (const event of processEvents) listenersBefore.set(event, process.listeners(event));
        exitCodeBefore = process.exitCode;
    });

    afterEach(() => {
        for (const event of processEvents) {
            const initialListeners = listenersBefore.get(event) ?? [];
            for (const listener of process.listeners(event)) {
                if (!initialListeners.includes(listener)) {
                    process.removeListener(event, listener);
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
        mockGetMQTT.mockResolvedValue(service);
        mockListCameras.mockReturnValue(['door', 'offline']);
        mockGetCamera.mockResolvedValueOnce(camera).mockRejectedValueOnce(new Error('offline'));

        jest.isolateModules(() => {
            jest.requireActual('../src/main');
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        process.emit('SIGTERM');
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(camera.dispose).toHaveBeenCalledTimes(1);
        expect(clearInterval).toHaveBeenCalledTimes(1);
        expect(clearTimeout).toHaveBeenCalledTimes(1);
        expect(service.close).toHaveBeenCalledTimes(1);
        expect(process.exitCode).toBe(0);
    });

    it.each([
        ['unhandledRejection', 'Unhandled promise rejection'],
        ['uncaughtException', 'Uncaught exception'],
    ] as const)('shuts down on %s', async (event, message) => {
        const error = new Error('process failure');
        const service = { ping: jest.fn().mockResolvedValue(undefined), close: jest.fn().mockResolvedValue(undefined) };
        mockGetMQTT.mockResolvedValue(service);

        jest.isolateModules(() => {
            jest.requireActual('../src/main');
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (event === 'unhandledRejection') {
            process.emit('unhandledRejection', error);
        } else {
            process.emit('uncaughtException', error, 'uncaughtException');
        }
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(logger.error).toHaveBeenCalledWith({ err: error }, message);
        expect(service.close).toHaveBeenCalledTimes(1);
        expect(process.exitCode).toBe(1);
    });
});
