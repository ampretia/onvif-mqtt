/*
 * SPDX-License-Identifier: Apache-2.0
 */

declare module 'onvif' {
    export class Cam {
        constructor(options: any, callback: any);

        getDeviceInformation(callback: any): any;
        getSystemDateAndTime(callback: any): any;
        getCapabilities(callback: any): any;

        setEventHandler(callback: any): any;
        on(evt: string, callback: any): any;
    }
}
