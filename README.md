# onvif-mqtt

_Bridges ONVIF events to MQTT topics_

[![License](https://img.shields.io/badge/License-Apache--2-blue)](#license)

## Background

Unable to get my camera's object detection to trigger recording, I looked into the ONVIF protocol. Part of this is well defined events for things such as motion detection. In my case, I knew that the camera's 'person' detection was pretty good.

Once I knew there were events, _obviously_ the next thing was to bridge these to MQTT/Node-Red _etc._ 

**Note, this is running on my own systems and doing what it needs to. There are a few rough edges - so treat this as  BETA rather than a PRODUCT**

## Credits

This would have been impossible with the [onvif repo](https://github.com/agsh/onvif)

## Setup

1. Need a camera that supports the ONVIF protocol
    - all the heavy lifting for the camera is done by the ONVIF module
2. MQTT server setup accessible
3. Server to run this bridge on

### Camera

For this you need the IP address and username/password. These are passed to the ONVIF module. I have included a retry loop; quite often what the camera sends back isn't parsed correctly. 

### MQTT Server

Hostname/port along with any credentials you need.

## Running - CLI based

Set all the properties needed as environment variables; easy way to do this is to create a `.env` file like this.

```
CAMERA_HOSTNAME=192.168.1.183
CAMERA_USER=admin
CAMERA_PASSWORD=notgoingtotellyou
CAMERA_PORT=80
MQTT_BROKER=tcp://192.168.1.150:1885
# CAMERA_CONNECT_RETRIES=5   
# CANERA_RETRY_DELAY=1000
```

The last two are the retry loop controls; the default values are to retry a further 5 times after the initiala attempt. Waiting 1000ms between attempts. 

Set the environment with this command; it will ignore the lines starting '#'
```
export $(grep -v '^#'  .env | xargs)
```

Install the onvif-mqtt, probably best to install globally.

```
npm install -g @ampretia/onvif-mqtt
onvif-mqtt
```

This will run in the foreground, and produce output like this

```

                    _ ____                            __  __
  ____  ____ _   __(_) __/           ____ ___  ____ _/ /_/ /_
 / __ \/ __ \ | / / / /_   ______   / __ `__ \/ __ `/ __/ __/
/ /_/ / / / / |/ / / __/  /_____/  / / / / / / /_/ / /_/ /_
\____/_/ /_/|___/_/_/             /_/ /_/ /_/\__, /\__/\__/
                                               /_/

[1657454096574] INFO (7 on 27d05aaea9f1): onvif-mqtt  v0.0.12
[1657454096643] INFO (7 on 27d05aaea9f1): Connect to MQTT
[1657454096644] INFO (7 on 27d05aaea9f1): Creating new Cam - retry left:5
[1657454096750] INFO (7 on 27d05aaea9f1): Connected to Camera
[1657454096780] INFO (7 on 27d05aaea9f1):
    manufacturer: "A_ONVIF_CAMERA"
    model: "YMF50B_NM223N_AF"
    firmwareVersion: "V3.0.6.3 build 2021-11-17 18:10:12 \n"
    serialNumber: "EF00000000B83D56"
    hardwareId: "1419d68a-1dd2-11b2-a105-F00000B83D56"
[1657454096803] INFO (7 on 27d05aaea9f1): Camera Time is Sun Jan 07 2018 12:54:30 GMT+0000 (Coordinated Universal Time)
[1657454096835] INFO (7 on 27d05aaea9f1): {"analytics":{"XAddr":"http://192.168.1.183:80/onvif/analytics","ruleSupport":true,"analyticsModuleSupport":true},"device":{"XAddr":"http://192.168.1.183:80/onvif/device","network":{"IPFilter":false,"zeroConfiguration":false,"IPVersion6":false,"dynDNS":false,"extension":{"dot11Configuration":false}},"system":{"discoveryResolve":false,"discoveryBye":false,"remoteDiscovery":false,"systemBackup":false,"systemLogging":true,"firmwareUpgrade":true,"supportedVersions":{"major":17,"minor":6},"extension":{"httpFirmwareUpgrade":true,"httpSystemBackup":false,"httpSystemLogging":true,"httpSupportInformation":true}},"IO":{"inputConnectors":1,"relayOutputs":1},"security":{"TLS1.1":false,"TLS1.2":false,"onboardKeyGeneration":false,"accessPolicyConfig":false,"X.509Token":false,"SAMLToken":false,"kerberosToken":false,"RELToken":false}},"events":{"XAddr":"http://192.168.1.183:80/onvif/events","WSSubscriptionPolicySupport":true,"WSPullPointSupport":true,"WSPausableSubscriptionManagerInterfaceSupport":true},"imaging":{"XAddr":"http://192.168.1.183:80/onvif/imaging"},"media":{"XAddr":"http://192.168.1.183:80/onvif/media","streamingCapabilities":{"RTPMulticast":true,"RTP_TCP":true,"RTP_RTSP_TCP":true}},"PTZ":{"XAddr":"http://192.168.1.183:80/onvif/ptz"},"extension":{"hikCapabilities":{"XAddr":"http://192.168.1.183:80/onvif/hik_ext","IOInputSupport":true},"deviceIO":{"XAddr":"http://192.168.1.183:80/onvif/deviceIO","videoSources":1,"videoOutputs":0,"audioSources":1,"audioOutputs":1,"relayOutputs":1},"extensions":{"telexCapabilities":{"XAddr":"http://192.168.1.183:80/onvif/telecom_service","timeOSDSupport":true,"titleOSDSupport":true,"PTZ3DZoomSupport":true,"PTZAuxSwitchSupport":true,"motionDetectorSupport":true,"tamperDetectorSupport":true}},"hbCapabilities":{"XAddr":"http://192.168.1.183:80/onvif/hbgk_ext","H265Support":true,"privacyMaskSupport":true,"cameraNum":1,"maxMaskAreaNum":4}}}
[1657454096835] INFO (7 on 27d05aaea9f1): Event handler added
[1657454096835] INFO (7 on 27d05aaea9f1): System configured and running
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