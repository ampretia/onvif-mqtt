# onvif-mqtt

_Bridges ONVIF events to MQTT topics_

[![License](https://img.shields.io/badge/License-Apache--2-blue)](#license)

## Background

Unable to get my camera's object detection to trigger recording, I looked into the ONVIF protocol. Part of this is well defined events for things such as motion detection. In my case, I knew that the camera's 'person' detection was pretty good.

Once I knew there were events, _obviously_ the next thing was to bridge these to MQTT/Node-Red _etc._ 

**Note, this is running on my own systems and doing what it needs to. There are a few rough edges - so PRs are most welcome**

## Credits

This would have been impossible with the [onvif repo](https://github.com/agsh/onvif)

## Setup

1. Need a camera that supports the ONVIF protocol
    - all the heavy lifting for the camera is done by the ONVIF module
2. MQTT server setup accessible
3. Server to run this bridge on - preferably as a Docker container. Portainer is recommended.

### Camera

For this you need the IP address and username/password. These are passed to the ONVIF module. I have included a retry loop; quite often what the camera sends back isn't parsed correctly. 

### MQTT Server

Hostname/port along with any credentials you need.

## Running - Docker

Create a `production.json` file with this structure, adding or removing cameras as you wish. For example my (redacted) configuration is 


```
{
  "mqtt": {
    "broker_host": "tcp://192.x.x.x:1885",
    "topic_root": "camera",
    "username": "cam",
    "password": "xxxxr"
  },
  "cameras": {
    "door": {
      "hostname": "192.xx.x.x",
      "onvif_port": "8000",
      "username": "xxx",
      "password": "xxx",
      "connect": {
        "retries": 5,
        "delay": 5000
      }
    },
    "garage": {
      "hostname": "192.x.x.x",
      "onvif_port": "x",
      "username": "xxxx",
      "password": "xxxx",
      "connect": {
        "retries": 5,
        "delay": 5000
      }
    }
  }
}

```

Run the docker image, mounting the volume with the json file above in

```
docker run -it -v /directory/with/the/productio/json/file/:/config/env onvif    
```

This will run in the foreground, and produce output like this (with some data removed!)

```

                    _ ____                            __  __
  ____  ____ _   __(_) __/           ____ ___  ____ _/ /_/ /_
 / __ \/ __ \ | / / / /_   ______   / __ `__ \/ __ `/ __/ __/
/ /_/ / / / / |/ / / __/  /_____/  / / / / / / /_/ / /_/ /_
\____/_/ /_/|___/_/_/             /_/ /_/ /_/\__, /\__/\__/
                                               /_/

[16:48:40.794] INFO (7): onvif-mqtt  v0.0.12
[16:48:40.838] INFO (7): Connected to MQTT
[16:48:40.838] INFO (7): [door] Attempting to connect
[16:48:40.838] INFO (7): [door] Creating new Cam - retry left:5
[16:48:42.383] INFO (7): [door] Connected
[16:48:42.508] INFO (7):
    manufacturer: "Manufacturer"
    model: "Reolink Video Doorbell WiFi"
    firmwareVersion: "v3.0."
    serialNumber: 190
    hardwareId: "C"
[16:48:42.538] INFO (7): [door] Camera Time is Sat Jun 08 2024 16:48:42 GMT+0000 (Coordinated Universal Time)
[16:48:42.591] INFO (7): [door] Capabilities::
[16:48:42.591] INFO (7): {"device":{........}}}
[16:48:42.591] INFO (7): [door] Event handler added
[16:48:42.591] INFO (7): [garage] Attempting to connect
[16:48:42.591] INFO (7): [garage] Creating new Cam - retry left:5
[16:48:42.725] INFO (7): [garage] Connected
[16:48:42.737] INFO (7): Publishing on camera/door/RuleEngine/CellMotionDetector/Motion
[16:48:42.738] INFO (7): Publishing on camera/door/RuleEngine/MyRuleDetector/FaceDetect
[16:48:42.738] INFO (7): Publishing on camera/door/RuleEngine/MyRuleDetector/PeopleDetect
[16:48:42.738] INFO (7): Publishing on camera/door/RuleEngine/MyRuleDetector/VehicleDetect
[16:48:42.738] INFO (7): Publishing on camera/door/RuleEngine/MyRuleDetector/DogCatDetect
[16:48:42.738] INFO (7): Publishing on camera/door/VideoSource/MotionAlarm
[16:48:42.740] INFO (7):
    manufacturer: "A_ONVIF_CAMERA"
    model: "YMF"
    firmwareVersion: "V3."
    serialNumber: "EF00"
    hardwareId: "83D56"
[16:48:42.752] INFO (7): [garage] Camera Time is Sat Jun 08 2024 17:48:40 GMT+0000 (Coordinated Universal Time)
[16:48:42.773] INFO (7): [garage] Capabilities::
[16:48:42.773] INFO (7): {"analytics":{........}}}
[16:48:42.773] INFO (7): [garage] Event handler added
[16:48:42.773] INFO (7): System configured and running
[16:48:42.808] INFO (7): Publishing on camera/door/RuleEngine/MyRuleDetector/Visitor
```


## Running as Docker container

The docker container is built for amd64 armv7 and arm64 (so should cover the RaspberryPI, Odroid C4, and other ARM based SBCs etc. )
Create a local `.env` file with the settings for your camera, and mqtt broker

```
docker run -rm -t --env-file .env ghcr.io/ampretia/onviffmqtt:sha-9e19f28
```

And that's it

## Contributing and Building

Please do; [see here](CONTRIBUTING.md)