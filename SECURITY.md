# Security Policy

## Supported versions

Security fixes are applied to the latest release only.

## Security Best Practices

### Credentials Protection
- Always use the `@@ENV_VAR` syntax in `.onvif-mqttrc.json` for passwords (e.g., `@@MQTT_PASSWORD`, `@@CAMERA_PASSWORD`) and provide values via environment variables or Docker `--env-file`.
- Avoid committing `.env` or plain credentials to version control.

### Network and Transport Security
- **MQTT Transport:** Use encrypted connections via `mqtts://` broker URLs. Custom CA certificates (`ca_cert`), client certificates (`client_cert`), and private keys (`client_key`) can be configured under the `mqtt` configuration block.
- **ONVIF Communications:** Standard ONVIF device service communications and pull-point subscriptions operate over HTTP SOAP XML on local LANs. It is strongly recommended to isolate IP cameras and this bridge onto a dedicated CCTV/IoT VLAN to prevent eavesdropping of credentials and video event traffic.
- **Third-Party ONVIF Library:** The ONVIF SOAP communication layer is strictly isolated behind the `Camera` wrapper module.

## Reporting a vulnerability

Please do **not** report security issues in public issues or pull requests.

Use GitHub's private reporting:
<https://github.com/ampretia/onvif-mqtt/security/advisories/new>

Or email [matthew@mh-white.com](mailto:matthew@mh-white.com).

Include what you found, how to reproduce it, and the version affected. Do not include
real camera or broker credentials.

You can expect an acknowledgement within about a week. Please allow time for a fix
before disclosing publicly.
