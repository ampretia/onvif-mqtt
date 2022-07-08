/*
 * SPDX-License-Identifier: Apache-2.0
 */

import { logger } from './logger';
import { config } from './config';
import { Cam } from 'onvif';
import * as util from 'util';

/** Wrapper around the onvif Cam class
 *  Aim is to provide typed/async exposed functions
 */
export default class Camera {
    private _cam: Cam;

    private constructor(cam: Cam) {
        this._cam = cam;
    }

    public static async getCam(): Promise<any> {
        let cam;
        let retries = config.CAMERA_CONNECT_RETRIES;
        const retryDelay = config.CAMERA_RETRY_DELAY;
        while (!cam) {
            try {
                logger.info(`Creating new Cam - retry left:${retries}`);
                cam = await new Promise((resolve, reject) => {
                    const cam = new Cam(
                        {
                            hostname: config.CAMERA_HOSTNAME,
                            username: config.CAMERA_USER,
                            password: config.CAMERA_PASSWORD,
                            port: config.CAMERA_PORT,
                            timeout: 10000,
                            autoconnect: true,
                            preserveAddress: true, // Enables NAT support and re-writes for PullPointSubscription URL
                        },
                        (err: any) => {
                            if (err) {
                                logger.error('Callback error');
                                reject(err);
                            }

                            resolve(new Camera(cam));
                        },
                    );
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

    public async getDeviceInformation(): Promise<any> {
        return new Promise((resolve, reject) => {
            this._cam.getDeviceInformation(function (err: any, info: any, xml: any) {
                if (err) {
                    reject(err);
                }

                resolve({ info, xml });
            });
        });
    }

    public async getSystemDateAndTime(): Promise<any> {
        return new Promise((resolve, reject) => {
            this._cam.getSystemDateAndTime(function (err: any, info: any, xml: any) {
                if (err) {
                    reject(err);
                }
                resolve({ info, xml });
            });
        });
    }

    public async getCapabilities(): Promise<any> {
        return new Promise((resolve, reject) => {
            this._cam.getCapabilities(function (err: any, info: any, xml: any) {
                if (err) {
                    reject(err);
                }
                resolve({ info, xml });
            });
        });
    }

    public setEventHandler(handler: any): any {
        return this._cam.on('event', async (camMessage: any, xml: any) => {
            const camEvent = await this.processCamMessage({ camMessage, xml });
            if (camEvent) await handler(camEvent);
            logger.info('Event handled');
        });
    }

    private async processCamMessage({ camMessage, xml }: { camMessage: any; xml: any }): Promise<CamEvent | undefined> {
        try {
            logger.info(`CamMessage:::${util.inspect(camMessage, true, 6, true)}`);
            logger.info(`CamMessage:::${util.inspect(xml, true, 6, true)}`);
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

            let eventTopic = camMessage.topic._;
            eventTopic = this.stripNamespaces(eventTopic);

            const eventTime = camMessage.message.message.$.UtcTime;

            const eventProperty = camMessage.message.message.$.PropertyOperation;
            // Supposed to be Initialized, Deleted or Changed but missing/undefined on the Avigilon 4 channel encoder

            // Only handle simpleItem
            // Only handle one 'source' item
            // Ignore the 'key' item  (nothing I own produces it)
            // Handle all the 'Data' items

            // SOURCE (Name:Value)
            let sourceName = null;
            let sourceValue = null;
            if (camMessage.message.message.source && camMessage.message.message.source.simpleItem) {
                if (Array.isArray(camMessage.message.message.source.simpleItem)) {
                    sourceName = camMessage.message.message.source.simpleItem[0].$.Name;
                    sourceValue = camMessage.message.message.source.simpleItem[0].$.Value;
                    logger.warn('WARNING: Only processing first Event Source item');
                } else {
                    sourceName = camMessage.message.message.source.simpleItem.$.Name;
                    sourceValue = camMessage.message.message.source.simpleItem.$.Value;
                }
            } else {
                sourceName = null;
                sourceValue = null;
                logger.warn('WARNING: Source does not contain a simpleItem');
            }

            //KEY
            if (camMessage.message.message.key) {
                logger.warn('NOTE: Event has a Key');
            }

            // DATA (Name:Value)
            if (camMessage.message.message.data && camMessage.message.message.data.simpleItem) {
                if (Array.isArray(camMessage.message.message.data.simpleItem)) {
                    for (let x = 0; x < camMessage.message.message.data.simpleItem.length; x++) {
                        const dataName = camMessage.message.message.data.simpleItem[x].$.Name;
                        const dataValue = camMessage.message.message.data.simpleItem[x].$.Value;
                        return {
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
                    const dataName = camMessage.message.message.data.simpleItem.$.Name;
                    const dataValue = camMessage.message.message.data.simpleItem.$.Value;
                    return {
                        eventTime,
                        eventTopic,
                        eventProperty,
                        sourceName,
                        sourceValue,
                        dataName,
                        dataValue,
                    };
                }
            } else if (camMessage.message.message.data && camMessage.message.message.data.elementItem) {
                logger.warn('WARNING: Data contain an elementItem');
                const dataName = 'elementItem';
                const dataValue = JSON.stringify(camMessage.message.message.data.elementItem);
                return { eventTime, eventTopic, eventProperty, sourceName, sourceValue, dataName, dataValue };
            } else {
                logger.warn('WARNING: Data does not contain a simpleItem or elementItem');
                const dataName = null;
                const dataValue = null;
                return { eventTime, eventTopic, eventProperty, sourceName, sourceValue, dataName, dataValue };
            }
        } catch (err: any) {
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
    eventTime: { toJSON: () => any };
    eventTopic: any;
    eventProperty: any;
    sourceName: any;
    sourceValue: any;
    dataName: any;
    dataValue: any;
}

export interface CamEventListener {
    handle(camEvent: CamEvent): void;
}
