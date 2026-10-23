/*
 * SPDX-License-Identifier: Apache-2.0
 */

import { logger } from './logger';
import { getConfig } from './config';
import { Cam, CamCallback, CamOptions, DeviceInformation, SystemDateAndTime, Capabilities } from 'onvif';
import * as util from 'util';

/** Shape of a parsed ONVIF event message as received from the onvif library */
interface SimpleItem {
    $: { Name: string; Value: string };
}

interface OnvifMessage {
    topic: { _: string };
    message: {
        message: {
            $: { UtcTime: string; PropertyOperation?: string };
            source?: { simpleItem?: SimpleItem | SimpleItem[] };
            key?: unknown;
            data?: {
                simpleItem?: SimpleItem | SimpleItem[];
                elementItem?: unknown;
            };
        };
    };
}

/** Wrapper around the onvif Cam class
 *  Aim is to provide typed/async exposed functions
 */
export default class Camera {
    private _cam: Cam;
    private _name: string;

    private constructor(cam: Cam, name: string) {
        this._cam = cam;
        this._name = name;
    }

    /** list the name of the configured cameras */
    public static listCameras(): string[] {
        return Object.keys(getConfig().cameras);
    }

    public static async getCamera(name: string): Promise<Camera> {
        let cam: Camera | undefined;

        const camCfg = getConfig().cameras[name];
        let retries = camCfg.connect.retries;
        const retryDelay = camCfg.connect.delay;
        while (!cam) {
            try {
                logger.info(`[${name}] Creating new Cam - retry left:${retries}`);
                cam = await new Promise<Camera>((resolve, reject) => {
                    const options: CamOptions = {
                        hostname: camCfg.hostname,
                        username: camCfg.username,
                        password: camCfg.password,
                        port: camCfg.onvif_port,
                        timeout: 10000,
                        autoconnect: true,
                        preserveAddress: true, // Enables NAT support and re-writes for PullPointSubscription URL
                    };
                    const callSite = new Error();
                    const cam = new Cam(options, (err: Error | null) => {
                        if (err) {
                            const wrapped = new Error(`[${name}] connect failed: ${err.message}`, { cause: err });
                            wrapped.stack = `Error: ${wrapped.message}\n${(callSite.stack ?? '')
                                .split('\n')
                                .slice(1)
                                .join('\n')}`;
                            reject(wrapped);
                            return;
                        }

                        resolve(new Camera(cam, name));
                    });
                });
            } catch (error) {
                if (retries < 1) {
                    throw error;
                }
                retries--;
                await this.wait(retryDelay);
            }
        }

        return cam;
    }

    private static async wait(time: number): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(() => resolve(), time);
        });
    }

    /**
     * Promisify an onvif callback style call.
     * The call-site stack is captured up front, because errors raised inside the onvif library
     * (eg timeouts) have no frames from this project. On failure a new error is produced that
     * carries the camera name, the operation and the call-site stack; the original is the `cause`.
     *
     * Some cameras intermittently never answer a request, which the onvif library reports as
     * 'Network timeout'. Those are retried using the camera's `connect.retries` / `connect.delay`.
     */
    private async call<T>(
        operation: string,
        fn: (cb: CamCallback<T>) => void,
    ): Promise<{ info: T | undefined; xml: string | undefined }> {
        const callSite = new Error();
        const { retries, delay } = getConfig().cameras[this._name].connect;
        for (let attempt = 0; ; attempt++) {
            try {
                return await new Promise((resolve, reject) => {
                    fn((err: Error | null, info?: T, xml?: string) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve({ info, xml });
                    });
                });
            } catch (e: unknown) {
                const err = e as Error;
                if (err.message === 'Network timeout' && attempt < retries) {
                    logger.warn(`[${this._name}] ${operation} timed out - retry ${attempt + 1} of ${retries}`);
                    await Camera.wait(delay);
                    continue;
                }
                const wrapped = new Error(`[${this._name}] ${operation} failed: ${err.message}`, { cause: err });
                wrapped.stack = `Error: ${wrapped.message}\n${(callSite.stack ?? '').split('\n').slice(1).join('\n')}`;
                throw wrapped;
            }
        }
    }

    public async getDeviceInformation(): Promise<{ info: DeviceInformation | undefined; xml: string | undefined }> {
        return this.call<DeviceInformation>('getDeviceInformation', (cb) => this._cam.getDeviceInformation(cb));
    }

    public async getSystemDateAndTime(): Promise<{ info: SystemDateAndTime | undefined; xml: string | undefined }> {
        return this.call<SystemDateAndTime>('getSystemDateAndTime', (cb) => this._cam.getSystemDateAndTime(cb));
    }

    public async getCapabilities(): Promise<{ info: Capabilities | undefined; xml: string | undefined }> {
        return this.call<Capabilities>('getCapabilities', (cb) => this._cam.getCapabilities(cb));
    }

    public setEventHandler(handler: (event: CamEvent) => Promise<void>): void {
        this._cam.on('event', (...args: unknown[]) => {
            const camMessage = args[0];
            const xml = args[1] as string | undefined;
            const camEvent = this.processCamMessage({ camMessage, xml });
            const handled = camEvent ? handler(camEvent) : Promise.resolve();
            handled
                .then(() => logger.debug(`[${this._name}] Event handled`))
                .catch((err: unknown) => logger.error({ err }, `[${this._name}] Event handler failed`));
        });
    }

    public setErrorEventHandler(handler: (event: unknown) => void): void {
        // Errors raised inside the onvif library have no frames from this project in their stack.
        // Wrap them here so the stack references our (source-mapped) code and the camera name.
        const wrap = (source: string) => (err: unknown) => {
            handler(
                new Error(`[${this._name}] ${source}: ${err instanceof Error ? err.message : String(err)}`, {
                    cause: err,
                }),
            );
        };
        this._cam.on('eventsError', wrap('eventsError'));
        this._cam.on('error', wrap('error'));
    }

    /** Check the camera is responding; throws if it is not */
    public async ping(): Promise<void> {
        const cameraDataTime = await this.getSystemDateAndTime();
        logger.info(`[${this._name}] Camera Time is ${JSON.stringify(cameraDataTime.info)}`);
    }

    /** Stop event delivery so this instance can be discarded and replaced by a new connection */
    public dispose(): void {
        // the onvif event loop stops pulling once there are no 'event' listeners
        this._cam.removeAllListeners('event');
    }

    private processCamMessage({ camMessage, xml }: { camMessage: unknown; xml: unknown }): CamEvent | undefined {
        const msg = camMessage as OnvifMessage;
        try {
            logger.debug(`CamMessage:::${util.inspect(camMessage, true, 6, true)}`);
            logger.debug(`CamMessage:::${util.inspect(xml, true, 6, true)}`);
            // Extract Event Details
            // Events have a Topic
            // Events have (optionally) a Source, a Key and Data fields
            // The Source,Key and Data fields can be single items or an array of items
            // The Source,Key and Data fields can be of type SimpleItem or a Complex Item

            //    - Topic
            //    - Message/Message/$
            //    - Message/Message/Source...
            //    - Message/Message/Key...
            //    - Message/Message/Data/SimpleItem/[index]/$/name   (array of items)
            // OR - Message/Message/Data/SimpleItem/$/name   (single item)
            //    - Message/Message/Data/SimpleItem/[index]/$/value   (array of items)
            // OR - Message/Message/Data/SimpleItem/$/value   (single item)

            let eventTopic = msg.topic._;
            eventTopic = this.stripNamespaces(eventTopic);

            const eventTime = msg.message.message.$.UtcTime;

            const eventProperty = msg.message.message.$.PropertyOperation;
            // Supposed to be Initialized, Deleted or Changed but missing/undefined on the Avigilon 4 channel encoder

            // Only handle simpleItem
            // Only handle one 'source' item
            // Ignore the 'key' item  (nothing I own produces it)
            // Handle all the 'Data' items

            // SOURCE (Name:Value)
            let sourceName = null;
            let sourceValue = null;
            if (msg.message.message.source && msg.message.message.source.simpleItem) {
                if (Array.isArray(msg.message.message.source.simpleItem)) {
                    sourceName = msg.message.message.source.simpleItem[0].$.Name;
                    sourceValue = msg.message.message.source.simpleItem[0].$.Value;
                    logger.warn('WARNING: Only processing first Event Source item');
                } else {
                    sourceName = msg.message.message.source.simpleItem.$.Name;
                    sourceValue = msg.message.message.source.simpleItem.$.Value;
                }
            } else {
                sourceName = null;
                sourceValue = null;
                logger.warn('WARNING: Source does not contain a simpleItem');
            }

            //KEY
            if (msg.message.message.key) {
                logger.warn('NOTE: Event has a Key');
            }

            // DATA (Name:Value)
            if (msg.message.message.data && msg.message.message.data.simpleItem) {
                if (Array.isArray(msg.message.message.data.simpleItem)) {
                    for (let x = 0; x < msg.message.message.data.simpleItem.length; x++) {
                        const dataName = msg.message.message.data.simpleItem[x].$.Name;
                        const dataValue = msg.message.message.data.simpleItem[x].$.Value;
                        return {
                            name: this._name,
                            eventTime,
                            eventTopic,
                            eventProperty,
                            sourceName,
                            sourceValue,
                            dataName,
                            dataValue,
                        };
                    }
                } else {
                    const dataName = msg.message.message.data.simpleItem.$.Name;
                    const dataValue = msg.message.message.data.simpleItem.$.Value;
                    return {
                        name: this._name,
                        eventTime,
                        eventTopic,
                        eventProperty,
                        sourceName,
                        sourceValue,
                        dataName,
                        dataValue,
                    };
                }
            } else if (msg.message.message.data && msg.message.message.data.elementItem) {
                logger.warn('WARNING: Data contain an elementItem');
                const dataName = 'elementItem';
                const dataValue = JSON.stringify(msg.message.message.data.elementItem);
                return {
                    name: this._name,
                    eventTime,
                    eventTopic,
                    eventProperty,
                    sourceName,
                    sourceValue,
                    dataName,
                    dataValue,
                };
            } else {
                logger.warn('WARNING: Data does not contain a simpleItem or elementItem');
                const dataName = null;
                const dataValue = null;
                return {
                    name: this._name,
                    eventTime,
                    eventTopic,
                    eventProperty,
                    sourceName,
                    sourceValue,
                    dataName,
                    dataValue,
                };
            }
        } catch (err: unknown) {
            logger.error(err);
            logger.info(`Event::::  ${JSON.stringify(camMessage)}`);
            return undefined;
        }
        return undefined;
    }

    stripNamespaces(topic: string): string {
        // example input :-   tns1:MediaControl/tnsavg:ConfigurationUpdateAudioEncCfg
        // Split on '/'
        // For each part, remove any namespace
        // Recombine parts that were split with '/'
        let output = '';
        const parts = topic.split('/');
        for (let index = 0; index < parts.length; index++) {
            const stringNoNamespace = parts[index].split(':').pop(); // split on :, then return the last item in the array
            if (output.length == 0) {
                output += stringNoNamespace;
            } else {
                output += '/' + stringNoNamespace;
            }
        }
        return output;
    }
}

export interface CamEvent {
    name: string;
    eventTime: string;
    eventTopic: string;
    eventProperty: string | undefined;
    sourceName: string | null;
    sourceValue: string | null;
    dataName: string | null;
    dataValue: string | null;
}

export interface CamEventListener {
    handle(camEvent: CamEvent): void;
}
