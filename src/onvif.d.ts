/*
 * SPDX-License-Identifier: Apache-2.0
 */

declare module 'onvif' {
    export interface CamOptions {
        hostname: string;
        username?: string;
        password?: string;
        port?: number | string;
        timeout?: number;
        autoconnect?: boolean;
        preserveAddress?: boolean;
    }

    export interface DeviceInformation {
        manufacturer?: string;
        model?: string;
        firmwareVersion?: string;
        serialNumber?: string;
        hardwareId?: string;
        [key: string]: unknown;
    }

    export interface SystemDateAndTime {
        UTCDateTime?: unknown;
        [key: string]: unknown;
    }

    export interface Capabilities {
        [key: string]: unknown;
    }

    export type CamCallback<T = unknown> = (err: Error | null, result?: T, xml?: string) => void;

    export class Cam {
        constructor(options: CamOptions, callback: (err: Error | null) => void);

        getDeviceInformation(callback: CamCallback<DeviceInformation>): void;
        getSystemDateAndTime(callback: CamCallback<SystemDateAndTime>): void;
        getCapabilities(callback: CamCallback<Capabilities>): void;

        setEventHandler(callback: CamCallback): void;
        on(evt: string, callback: (...args: unknown[]) => void): this;
        removeAllListeners(evt?: string): this;
    }
}
