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
    default: { listCameras: jest.fn(() => []) },
}));
jest.mock('chalk', () => ({
    __esModule: true,
    default: { blue: { bold: (text: string) => text } },
}));

const mockGetMQTT = jest.mocked(MQTTService.getMQTT);

describe('main startup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetMQTT.mockRejectedValue(new Error('MQTT unavailable'));
    });

    it('logs the fatal startup error and exits with code 1', async () => {
        const processExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

        try {
            jest.isolateModules(() => {
                jest.requireActual('../src/main');
            });
            await new Promise<void>((resolve) => setImmediate(resolve));

            expect(logger.error).toHaveBeenCalledWith({ err: expect.any(Error) }, 'Fatal error in main');
            expect(processExit).toHaveBeenCalledWith(1);
        } finally {
            processExit.mockRestore();
        }
    });
});
