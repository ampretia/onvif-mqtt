/*
 * SPDX-License-Identifier: Apache-2.0
 */

import { logger } from './logger';
import { CameraConfig, getConfig } from './config';
import { Cam, CamCallback, CamOptions, DeviceInformation, SystemDateAndTime, Capabilities } from 'onvif';
import * as util from 'util';
import { isAuthenticationError, isTimeoutError, withRetry } from './retry';

const DISPOSE_TIMEOUT_MS = 10_000;
/** Messages produced by the onvif library that we need to recognise */
const NO_PULL_POINT_MESSAGE = 'You should create pull-point subscription first!';

type CamWithUnsubscribe = Cam & { unsubscribe(callback: (error: Error | null) => void): void };

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

/** Create an error carrying `cause`, whose stack points at the (project) call site rather than inside onvif */
function wrapError(message: string, cause: Error, callSite: Error): Error {
    const wrapped = new Error(message, { cause });
    wrapped.stack = `Error: ${message}\n${(callSite.stack ?? '').split('\n').slice(1).join('\n')}`;
    return wrapped;
}

/** Wrapper around the onvif Cam class
 *  Aim is to provide typed/async exposed functions
 */
export default class Camera {
    private _cam: Cam;
    private _name: string;
    private _connect: CameraConfig['connect'];
    private _lastEventTime: number = Date.now();
    private _eventsErrorCount = 0;

    private constructor(cam: Cam, name: string, connect: CameraConfig['connect']) {
        this._cam = cam;
        this._name = name;
        this._connect = connect;
    }

    public getLastEventTime(): number {
        return this._lastEventTime;
    }

    /** list the name of the configured cameras */
    public static listCameras(): string[] {
        return Object.keys(getConfig().cameras);
    }

    /**
     * Connect to a configured camera, retrying (with exponential backoff) using the camera's
     * `connect.retries` / `connect.delay`. Authentication failures are never retried here.
     * Aborting `signal` cancels any pending backoff wait.
     */
    public static async getCamera(name: string, signal?: AbortSignal): Promise<Camera> {
        const camCfg = getConfig().cameras[name];
        if (!camCfg) {
            throw new Error(`Unknown camera "${name}"`);
        }
        let retriesLeft = camCfg.connect.retries;
        return withRetry(
            () => {
                logger.info(`[${name}] Creating new Cam - retry left:${retriesLeft}`);
                return Camera.connect(name, camCfg);
            },
            {
                ...camCfg.connect,
                signal,
                shouldRetry: (error) => !isAuthenticationError(error),
                onRetry: () => {
                    retriesLeft--;
                },
            },
        );
    }

    private static connect(name: string, camCfg: CameraConfig): Promise<Camera> {
        // Errors raised inside the onvif library have no frames from this project; keep the call site
        const callSite = new Error();
        return new Promise<Camera>((resolve, reject) => {
            const options: CamOptions = {
                hostname: camCfg.hostname,
                username: camCfg.username,
                password: camCfg.password,
                port: camCfg.onvif_port,
                timeout: 10000,
                autoconnect: true,
                preserveAddress: true, // Enables NAT support and re-writes for PullPointSubscription URL
            };
            const cam = new Cam(options, (err: Error | null) => {
                if (err) {
                    reject(wrapError(`[${name}] connect failed: ${err.message}`, err, callSite));
                    return;
                }
                resolve(new Camera(cam, name, camCfg.connect));
            });
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
        const { retries, delay } = this._connect;
        try {
            return await withRetry(
                () =>
                    new Promise<{ info: T | undefined; xml: string | undefined }>((resolve, reject) => {
                        fn((err: Error | null, info?: T, xml?: string) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            resolve({ info, xml });
                        });
                    }),
                {
                    retries,
                    delay,
                    shouldRetry: (e) => isTimeoutError(e),
                    onRetry: (_e, attempt) =>
                        logger.warn(`[${this._name}] ${operation} timed out - retry ${attempt} of ${retries}`),
                },
            );
        } catch (e: unknown) {
            if (isAuthenticationError(e)) {
                throw e;
            }
            const err = e as Error;
            throw wrapError(`[${this._name}] ${operation} failed: ${err.message}`, err, callSite);
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
            this._lastEventTime = Date.now();
            this._eventsErrorCount = 0;
            const camMessage = args[0];
            const xml = args[1] as string | undefined;
            for (const camEvent of this.processCamMessage({ camMessage, xml })) {
                handler(camEvent)
                    .then(() => logger.debug(`[${this._name}] Event handled`))
                    .catch((err: unknown) => logger.error({ err }, `[${this._name}] Event handler failed`));
            }
        });
    }

    public setErrorEventHandler(handler: (event: unknown) => void): void {
        // Errors raised inside the onvif library have no frames from this project in their stack.
        // Wrap them here so the stack references our (source-mapped) code and the camera name.
        const wrap = (source: string) => (err: unknown) => {
            if (source === 'eventsError') {
                this._eventsErrorCount++;
            }
            handler(
                new Error(`[${this._name}] ${source}: ${err instanceof Error ? err.message : String(err)}`, {
                    cause: err,
                }),
            );
        };
        this._cam.on('eventsError', wrap('eventsError'));
        this._cam.on('error', wrap('error'));
    }

    /** Check the camera is responding and event pull-point is healthy; throws if stalled or unreachable */
    public async ping(): Promise<void> {
        const cameraDataTime = await this.getSystemDateAndTime();
        logger.info(`[${this._name}] Camera Time is ${JSON.stringify(cameraDataTime.info)}`);
        if (this._eventsErrorCount > 0) {
            this._eventsErrorCount = 0;
            throw new Error(`Pull-point subscription error detected; reconnecting camera`);
        }
    }

    /** Stop event delivery so this instance can be discarded and replaced by a new connection */
    public async dispose(): Promise<void> {
        this._cam.removeAllListeners();
        // An EventEmitter throws on an 'error' with no listener; keep a sink so late errors cannot crash the process
        this._cam.on('error', (err: unknown) => logger.debug({ err }, `[${this._name}] Ignoring error after dispose`));
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error(`[${this._name}] unsubscribe timed out after ${DISPOSE_TIMEOUT_MS}ms`)),
                DISPOSE_TIMEOUT_MS,
            );
            (this._cam as CamWithUnsubscribe).unsubscribe((error: Error | null) => {
                clearTimeout(timer);
                if (error && error.message !== NO_PULL_POINT_MESSAGE) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }

    /** Convert a raw ONVIF message into one CamEvent per data item (empty if the message cannot be parsed) */
    private processCamMessage({ camMessage, xml }: { camMessage: unknown; xml: unknown }): CamEvent[] {
        const msg = camMessage as OnvifMessage;
        try {
            if (logger.isLevelEnabled('debug')) {
                logger.debug(`CamMessage:::${util.inspect(camMessage, true, 6, false)}`);
                logger.debug(`CamMessage:::${util.inspect(xml, true, 6, false)}`);
            }
            // Events have a Topic
            // Events have (optionally) a Source, a Key and Data fields
            // The Source,Key and Data fields can be single items or an array of items
            // Only simpleItem is handled for Source (first item only); Key is ignored
            // (nothing I own produces it); every Data item produces its own event.

            const eventTopic = this.stripNamespaces(msg.topic._);
            const { $: attributes, source, key, data } = msg.message.message;
            const eventTime = attributes.UtcTime;
            // Supposed to be Initialized, Deleted or Changed but missing/undefined on the Avigilon 4 channel encoder
            const eventProperty = attributes.PropertyOperation;

            let sourceName: string | null = null;
            let sourceValue: string | null = null;
            if (source?.simpleItem) {
                const sourceItems = ([] as SimpleItem[]).concat(source.simpleItem);
                if (sourceItems.length > 1) {
                    logger.debug('WARNING: Only processing first Event Source item');
                }
                sourceName = sourceItems[0].$.Name;
                sourceValue = sourceItems[0].$.Value;
            } else {
                logger.debug('WARNING: Source does not contain a simpleItem');
            }

            if (key) {
                logger.debug('NOTE: Event has a Key');
            }

            const base = { name: this._name, eventTime, eventTopic, eventProperty, sourceName, sourceValue };

            if (data?.simpleItem) {
                return ([] as SimpleItem[])
                    .concat(data.simpleItem)
                    .map((item) => ({ ...base, dataName: item.$.Name, dataValue: item.$.Value }));
            }
            if (data?.elementItem) {
                logger.debug('WARNING: Data contain an elementItem');
                return [{ ...base, dataName: 'elementItem', dataValue: JSON.stringify(data.elementItem) }];
            }
            logger.debug('WARNING: Data does not contain a simpleItem or elementItem');
            return [{ ...base, dataName: null, dataValue: null }];
        } catch (err: unknown) {
            logger.error({ err }, 'Failed to parse camera event message');
            logger.info(`Event::::  ${JSON.stringify(camMessage)}`);
            return [];
        }
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
