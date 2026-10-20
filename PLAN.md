# Package Metadata and Build Plan

## Goal

Align `package.json`, the build workflow, and the Docker image with the project's intended distribution model and supported Node.js versions.

## Plan

1. [x] Preserve both distribution modes: keep the Docker application and expose the library API through a dedicated package entry point. Added `src/index.ts` to export `Camera`, `MQTTService`, `CamEvent`, and `CamEventListener` without importing the app startup module.

2. [x] Set Node.js 24 as the supported runtime in `engines`, CI, and both Docker stages. Tests and TypeScript checking passed on Node 24; Docker image validation is unavailable here because Docker is not installed.
3. [x] Make build and validation scripts predictable. `build` now cleans and compiles only; `lint` is an explicit, non-mutating check scoped to `src`, and the build no longer formats sources or runs `npm link`.
4. Deferred at the user's request: leave `node-config-ts` integration and the existing `postinstall` hook unchanged until the config library work is understood.
5. [x] Review dependencies: removed deprecated `@types/pino` and unused `yargs`; moved `@types/source-map-support` to `devDependencies`. Kept `@types/ws` in `devDependencies` because MQTT's declarations import it. TypeScript passes, and `ts-node` remains for Jest's TypeScript config support.
6. [x] Complete package metadata with SPDX license `Apache-2.0`, a description, and relevant keywords.
7. [x] Update `package-lock.json` for manifest changes.

## Verification

- [x] On Node 24, run clean `npm ci`, build, lint, and test; Jest reports no tests are present.
- [ ] Docker image verification remains blocked because Docker is unavailable in this environment.
- [x] Inspect the npm pack dry run and require the compiled package entry point; both package entry files are included and exports resolve.