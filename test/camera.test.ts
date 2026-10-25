import { EventEmitter } from 'events';
import Camera from '../src/camera';

describe('Camera.dispose', () => {
    it('unsubscribes and removes all listeners', async () => {
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
        expect(cam.eventNames()).toEqual([]);
    });
});
