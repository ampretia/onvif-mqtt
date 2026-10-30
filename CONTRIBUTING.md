# Contributing to onvif-mqtt

Thanks for your interest in contributing. Bug reports, camera compatibility
reports, documentation fixes and code changes are all welcome.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
To report a security problem, see [SECURITY.md](SECURITY.md) rather than opening a public issue.

## Before you start

- Search the [existing issues](https://github.com/ampretia/onvif-mqtt/issues) and pull requests first.
- For anything larger than a small fix, open an issue to discuss it before writing code.
- Questions and usage help are fine as issues too.

## Reporting bugs

Please include:

- the `onvif-mqtt` version and how you run it (Node or Docker)
- your camera make, model and firmware, if known
- what you expected and what happened
- relevant logs

**Redact credentials before posting.** Remove camera passwords, MQTT passwords and
any RTSP or ONVIF URLs that embed credentials. Never paste your `.onvif-mqttrc.json` as is.

## Development setup

Requires Node.js 24 (see `engines` in [`package.json`](package.json)).

```sh
git clone https://github.com/<your-fork>/onvif-mqtt.git
cd onvif-mqtt
npm install
npm run build
```

Copy [`.onvif-mqttrc.example.json`](.onvif-mqttrc.example.json) to `.onvif-mqttrc.json`
and edit it for your cameras and broker. That file is git-ignored; do not commit it.

```sh
npm start        # runs lib/main.js
```

Docker:

```sh
docker build -t onvif .
```

## Making a change

1. Fork the repository and create a branch from `main`, for example `fix/reconnect-timeout`.
2. Keep the change focused. Unrelated refactors belong in a separate PR.
3. Add or update tests for behaviour changes, and update the docs if user-visible behaviour or setup changes.
4. Run all the checks below.
5. Open a pull request against `main` and fill in the template.

### Checks

CI runs the build and tests on every pull request, and they must pass. Run them locally first:

```sh
npm run format:check   # Prettier
npm run lint           # ESLint, warnings are errors
npm run typecheck      # TypeScript
npm test               # Jest, full suite
```

`npm run format` fixes formatting problems.

Follow the style of the existing code.

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):
`<type>(<optional-scope>): <imperative summary>`

```
fix(camera): reconnect after stream timeout
docs: clarify Docker setup
test: cover invalid broker configuration
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`.
Releases and the [`CHANGELOG.md`](CHANGELOG.md) are generated from these messages, so please don't edit the changelog by hand.

### Sign your commits (DCO)

Certify that you wrote the change or have the right to submit it under the
project licence, per the [Developer Certificate of Origin](https://developercertificate.org/),
by adding a `Signed-off-by` line:

```sh
git commit -s -m "fix(camera): reconnect after stream timeout"
```

## Licence

This project is licensed under the [Apache License 2.0](LICENSE). Contributions are
accepted under the same licence.

## Review

This is a small, maintainer-run project. Expect a reply within about a week. A
polite nudge on the PR is fine after that.
