/* tslint:disable */
/* eslint-disable */
declare module "node-config-ts" {
  interface IConfig {
    mqtt: Mqtt
    cameras: Cameras
  }
  interface Cameras {
    door: Door
    garage: Door
  }
  interface Door {
    hostname: string
    onvif_port: string
    username: string
    password: string
    connect: Connect
  }
  interface Connect {
    retries: number
    delay: number
  }
  interface Mqtt {
    broker_host: string
    topic_root: string
    username: string
    password: string
  }
  export const config: Config
  export type Config = IConfig
}
