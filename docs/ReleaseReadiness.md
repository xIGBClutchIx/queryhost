# Package hardening and release readiness

Slice 14 prepares QueryHost to be packaged without making it public. The package remains version `0.0.0` with npm's `private` publish guard. Publishing, choosing a release version, creating a Git remote or tag, and deploying any service are intentionally out of scope.

## Public package boundary

The package exports only its root entry point. That entry point contains `query()`, the game registry and alias helpers, and the documented public result and game-data types. Transports, protocol parsers, target-safety primitives, execution internals, and profile orchestration are not subpath exports.

The package smoke test installs the packed archive into a clean fixture, compares the runtime export list to the reviewed surface, proves an internal transport cannot be imported, runs an ESM JavaScript consumer, and compiles a strict NodeNext TypeScript consumer. Generated API documentation starts at `src/index.ts`, so it follows the same boundary.

## Package and dependency review

The packed artifact must remain at or below 250 KB compressed, 1.5 MB unpacked, and 300 files. The smoke test also requires the CLI, declarations, API reference, examples, changelog, license, and README while rejecting leaked source, tests, and repository scripts.

QueryHost has one direct runtime dependency: `@foxglove/wasm-bz2` for bounded decompression of compressed A2S split packets. Its only runtime transitive dependency is `tslib`. Their reviewed licenses are MIT and 0BSD respectively; the smoke test fails if the runtime dependency set or either license changes. Documentation, property-testing, linting, type-testing, and packaging tools remain development-only dependencies.

## Supported-profile acceptance

| Profile           | Required source           | Full-mode optional sources                                                          | Successful named fixtures         |
| ----------------- | ------------------------- | ----------------------------------------------------------------------------------- | --------------------------------- |
| Rust              | A2S Info                  | A2S Player, A2S Rules                                                               | `test/fixtures/rust`              |
| Project Zomboid   | A2S Info                  | A2S Player, A2S Rules                                                               | `test/fixtures/project-zomboid`   |
| 7 Days to Die     | A2S Info                  | A2S Player, A2S Rules                                                               | `test/fixtures/seven-days-to-die` |
| Minecraft Java    | Server List Ping          | DNS SRV discovery when applicable, UDP Query in full mode                           | `test/fixtures/minecraft-java`    |
| Minecraft Bedrock | RakNet unconnected ping   | None                                                                                | `test/fixtures/minecraft-bedrock` |
| FiveM             | Any usable fixed endpoint | `info.json`, `dynamic.json`, and `players.json` are attempted together in full mode | `test/fixtures/fivem`             |

Each advertised profile has typed public data, explicit registry capabilities and ports, deterministic merge tests, source provenance, bounded parser and transport behavior, target-safety coverage, successful source fixtures, and failure coverage for its applicable malformed, timeout, blocked, unsupported, skipped, and partial-result paths. Fixture READMEs identify synthetic or redacted provenance. Repository tests run profiles against fake transports and servers; the separately packed consumers verify the public package without adding a target-safety bypass.

## Local verification

Run the full non-public readiness gate:

```bash
npm run verify
```

Useful focused commands are `npm run docs:api` for the generated Markdown API reference and `npm run test:package` for packing plus clean-consumer verification. These commands create only local build, documentation, and temporary package artifacts; they do not publish or deploy anything.
