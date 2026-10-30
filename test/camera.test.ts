import { EventEmitter } from 'events';
import Camera, { CamEvent } from '../src/camera';

describe('Camera.dispose', () => {
    it('unsubscribes, removes listeners and keeps an error sink', async () => {
        type TestCam = EventEmitter & {
            unsubscribe: (callback: (error: Error | null) => void) => void;
        };
        const cam = new EventEmitter() as TestCam;
        cam.unsubscribe = (callback: (error: Error | null) => void) => callback(null);
        const unsubscribe = jest.spyOn(cam, 'unsubscribe');
        const camera = Object.create(Camera.prototype) as Camera;
        (camera as unknown as { _cam: TestCam })._cam = cam;
        cam.on('event', () => {});
        cam.on('eventsError', () => {});
        cam.on('error', () => {});

        await camera.dispose();

        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(cam.eventNames()).toEqual(['error']);
        expect(() => cam.emit('error', new Error('late'))).not.toThrow();
    });
});

describe('Camera.dispose timeout', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it('rejects when unsubscribe never calls back', async () => {
        jest.useFakeTimers();
        const cam = Object.assign(new EventEmitter(), { unsubscribe: () => {} });
        const camera = Object.create(Camera.prototype) as Camera;
        (camera as unknown as { _cam: unknown; _name: string })._cam = cam;
        (camera as unknown as { _name: string })._name = 'door';

        const result = camera.dispose();
        const assertion = expect(result).rejects.toThrow('unsubscribe timed out');
        await jest.advanceTimersByTimeAsync(10_000);
        await assertion;
    });
});

describe('Camera event handling', () => {
    const createCamera = () => {
        const cam = new EventEmitter();
        const camera = Object.create(Camera.prototype) as Camera;
        Object.assign(camera, { _cam: cam, _name: 'door' });
        return { cam, camera };
    };
    const message = (data: unknown) => ({
        topic: { _: 'tns1:RuleEngine/tnsavg:Motion' },
        message: {
            message: {
                $: { UtcTime: '2026-10-21T12:00:00Z', PropertyOperation: 'Changed' },
                source: { simpleItem: { $: { Name: 'Source', Value: 'cam1' } } },
                data,
            },
        },
    });
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

    it('emits one event per data item', async () => {
        const { cam, camera } = createCamera();
        const events: CamEvent[] = [];
        camera.setEventHandler((event) => {
            events.push(event);
            return Promise.resolve();
        });

        cam.emit(
            'event',
            message({
                simpleItem: [{ $: { Name: 'A', Value: '1' } }, { $: { Name: 'B', Value: '2' } }],
            }),
            '<xml/>',
        );
        await flush();

        expect(events).toHaveLength(2);
        expect(events[0]).toEqual(
            expect.objectContaining({
                name: 'door',
                eventTopic: 'RuleEngine/Motion',
                sourceName: 'Source',
                sourceValue: 'cam1',
                dataName: 'A',
                dataValue: '1',
            }),
        );
        expect(events[1]).toEqual(expect.objectContaining({ dataName: 'B', dataValue: '2' }));
    });

    it('handles a single data item, elementItem, and missing data', async () => {
        const { cam, camera } = createCamera();
        const events: CamEvent[] = [];
        camera.setEventHandler((event) => {
            events.push(event);
            return Promise.resolve();
        });

        cam.emit('event', message({ simpleItem: { $: { Name: 'State', Value: 'true' } } }));
        cam.emit('event', message({ elementItem: { a: 1 } }));
        cam.emit('event', message(undefined));
        await flush();

        expect(events[0]).toEqual(expect.objectContaining({ dataName: 'State', dataValue: 'true' }));
        expect(events[1]).toEqual(expect.objectContaining({ dataName: 'elementItem', dataValue: '{"a":1}' }));
        expect(events[2]).toEqual(expect.objectContaining({ dataName: null, dataValue: null }));
    });

    it('ignores malformed messages', async () => {
        const { cam, camera } = createCamera();
        const events: CamEvent[] = [];
        camera.setEventHandler((event) => {
            events.push(event);
            return Promise.resolve();
        });

        cam.emit('event', { nonsense: true });
        await flush();

        expect(events).toHaveLength(0);
    });
});
