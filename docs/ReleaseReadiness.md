# Package release

Slice 14 created the package-hardening gate. Slice 20 uses that gate to publish QueryHost 1.0.0 from the public GitHub repository. The release establishes the reviewed package-root contract and uses semantic versioning for later changes.

## Public package boundary

The package root contains `query()`, the game registry and alias helpers, and the documented public result and game-data types. The only subpath export, `queryhost/registry`, repeats the registry, alias helpers, and their types without any runtime imports, so browser bundles can share the game list. Transports, protocol parsers, target-safety primitives, execution internals, and profile orchestration are not subpath exports.

The package smoke test installs the packed archive into a clean fixture, compares the runtime export lists of both entry points to the reviewed surface, proves the registry entry loads no runtime modules, proves an internal transport cannot be imported, runs an ESM JavaScript consumer, and compiles a strict NodeNext TypeScript consumer. Generated API documentation starts at `src/index.ts`, so it follows the same boundary.

## Package and dependency review

The packed artifact must remain at or below 512 KB compressed, 1.75 MB unpacked, and 600 files. The file ceiling leaves room for each new game's generated API page and compiled profile module while the byte ceilings still bound what consumers download. The unpacked ceiling rose from 1.5 MB when the dependency-free QUIC transport added about 170 KB of compiled modules, declarations, and source maps. The smoke test also requires the CLI, declarations, API reference, examples, changelog, license, and README while rejecting leaked source, tests, and repository scripts.

QueryHost has one direct runtime dependency: `@foxglove/wasm-bz2` for bounded decompression of compressed A2S split packets. Its only runtime transitive dependency is `tslib`. Their reviewed licenses are MIT and 0BSD respectively; the smoke test fails if the runtime dependency set or either license changes. Documentation, property-testing, linting, type-testing, and packaging tools remain development-only dependencies.

## Supported-profile acceptance

| Profile                 | Required source            | Full-mode optional sources                                                          | Successful named fixtures                                  |
| ----------------------- | -------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Rust                    | A2S Info                   | A2S Player, A2S Rules                                                               | `test/fixtures/rust`                                       |
| Project Zomboid         | A2S Info                   | A2S Player, A2S Rules                                                               | `test/fixtures/project-zomboid`                            |
| 7 Days to Die           | A2S Info                   | A2S Player, A2S Rules                                                               | `test/fixtures/seven-days-to-die`                          |
| DayZ                    | A2S Info                   | A2S Rules; A2S Player is explicitly unsupported                                     | `test/fixtures/dayz`                                       |
| Minecraft Java          | SLP, else legacy ping      | DNS SRV discovery when applicable, UDP Query in full mode                           | `test/fixtures/minecraft-java`                             |
| Minecraft Bedrock       | NetherNet, else RakNet     | None                                                                                | `test/fixtures/minecraft-bedrock`                          |
| FiveM                   | Any usable fixed endpoint  | `info.json`, `dynamic.json`, and `players.json` are attempted together in full mode | `test/fixtures/fivem`                                      |
| RedM                    | Any usable fixed endpoint  | `info.json`, `dynamic.json`, and `players.json` are attempted together in full mode | `test/fixtures/redm`                                       |
| Satisfactory            | Lightweight UDP state      | HTTPS `HealthCheck` in full mode except while loading                               | `test/fixtures/satisfactory`                               |
| Don't Starve Together   | A2S Info                   | A2S Player, A2S Rules                                                               | `test/fixtures/dont-starve-together`                       |
| Source-engine games     | A2S Info                   | A2S Player, A2S Rules                                                               | `test/fixtures/source-engine`                              |
| Steam query-port games  | A2S Info                   | A2S Player (unsupported for Conan Exiles), A2S Rules                                | `test/fixtures/steam-query-port`, `test/fixtures/soulmask` |
| Steam port-layout games | A2S Info                   | A2S Player, A2S Rules (unsupported for Arma 3)                                      | `test/fixtures/steam-query-port`                           |
| Project Reclaimer       | QUIC server-browser status | None                                                                                | `test/fixtures/project-reclaimer`                          |

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

Publishing uses npm trusted publishing for `.github/workflows/publish.yml`. The trust relationship is limited to the `xIGBClutchIx/queryhost` repository and the `npm publish` action; the workflow uses GitHub OIDC and does not require a stored npm authentication token.

### Consumer pickup

The API and web repositories pin exact versions and move them through their own `QueryHost release` workflows. Both call one reusable bump workflow, `.github/workflows/consumer-bump.yml` in `xIGBClutchIx/queryhost-api`, which opens the bump pull request and later merges it once CI and its other checks pass. That workflow, its merge conditions, and its deployment gates belong to the consumers and are documented in their `docs/Operations.md`; this repository holds no deployment policy and only announces each release.

After `npm publish` succeeds, the `consumers` job in `publish.yml` runs `gh workflow run queryhost-release.yml -f version=<version>` in `xIGBClutchIx/queryhost-api` and then `xIGBClutchIx/queryhost-web`, so the bump pull requests open without waiting for the consumers' 15-minute schedules. The dispatch carries only the version; what happens next is up to each consumer. Those schedules remain the fallback and run the merge checks. The job uses the `QUERYHOST_CONSUMER_DISPATCH_TOKEN` repository secret in this repository (Settings, Secrets and variables, Actions): a fine-grained personal access token owned by the repository owner, limited to the `queryhost-api` and `queryhost-web` repositories with **Actions: Read and write** and nothing else beyond the **Metadata: Read** GitHub always adds. The publish job never sees it. When the secret is absent, the job leaves a notice and succeeds; when a dispatch fails, the job fails after trying both consumers, and the schedules still pick the release up. Renew the token before it expires.

npm does not permit reuse of a published name and version. If 1.0.0 contains a release defect, deprecate it when appropriate and publish a corrected patch version.
