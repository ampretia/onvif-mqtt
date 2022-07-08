# onvif-mqtt

_Bridges ONVIF events to MQTT topics_

[![License](https://img.shields.io/badge/License-Apache--2-blue)](#license)

## Background

Unable to get my camera's object detection to trigger recording, I looked into the ONVIF protocol. Part of this is well defined events for things such as motion detection. In my case, I knew that the camera's 'person' detection was pretty good.

Once I knew there were events, _obviously_ the next thing was to bridge these to MQTT/Node-Red _etc._ 

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


//// asciinema here

## Running as Docker container

## Contributing and Building

