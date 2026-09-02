# Package release

Slice 14 created the package-hardening gate. Slice 20 uses that gate to publish QueryHost 1.0.0 from the public GitHub repository. The release establishes the reviewed package-root contract and uses semantic versioning for later changes.

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

## Release verification

Run the full gate and confirm the tag matches the package version:

```bash
npm run verify
npm run release:check -- v1.0.0
```

Review `npm pack --dry-run --json` before creating the release. The package must stay within the documented size, file-count, dependency, and license limits.

## Publication

1. Create a code-signed commit containing the 1.0.0 metadata and generated API reference.
2. Create and verify the signed `v1.0.0` tag from that commit.
3. Push the commit and tag, then publish a GitHub release from `v1.0.0`.
4. Let `.github/workflows/publish.yml` run the full gate and publish to npm with provenance.
5. Verify `npm view queryhost@1.0.0`, install the registry package in a clean consumer, and run `npm audit signatures`.
6. Replace the API and web repositories' vendored tarball dependencies with exact `queryhost` version `1.0.0` dependencies and run both finish gates.

The first release workflow uses the repository's `NPM_TOKEN` secret. After npm creates the package, configure npm trusted publishing for `.github/workflows/publish.yml`, remove the token from the workflow and repository, and retain the OIDC provenance path.

npm does not permit reuse of a published name and version. If 1.0.0 contains a release defect, deprecate it when appropriate and publish a corrected patch version.
