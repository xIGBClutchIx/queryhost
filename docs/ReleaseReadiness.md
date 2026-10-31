# Release runbook

How to cut a QueryHost release, and the package gates every release must pass. Versions follow semantic versioning on the package-root contract (decision 55 in [Decisions](Decisions.md)); `X.Y.Z` below stands for the version being released.

## Gates

`npm run verify` is the single gate, run locally, by CI on every push and pull request, and by the publish workflow against the release tag. In order it checks formatting, release metadata (`scripts/release-check.mjs`), the build, generated API docs, type checking, linting, the runtime and property tests with coverage thresholds, type tests, `publint`, `attw`, and the packed-package smoke test (`scripts/package-smoke.mjs`).

CI runs the gate on Node.js 24 and 26 on Linux and Node.js 24 on Windows, then fails if `docs/api` differs from what the gate regenerated. A weekly workflow (`.github/workflows/properties.yml`) runs the parser property tests with a random seed and many more runs than the gate's fixed seed; a failure prints the seed, which `QUERYHOST_PROPERTY_SEED=<seed> npm run test:properties` replays.

### Coverage

`npm run test:coverage` enforces V8 coverage floors over `src/` set in `vitest.config.mjs`, about three points below the measured totals so a real regression fails while ordinary refactors do not. Raise the floors when coverage rises substantially; lower them only with a reason in the pull request.

### Public package boundary

The package root (`src/index.ts`) and the `queryhost/registry` subpath are the only entry points. The registry subpath repeats the registry, alias helpers, result vocabulary, and their types without importing any runtime module, so browser bundles can share the game list. Transports, protocol parsers, target-safety primitives, execution internals, and profile orchestration are not exported. Generated API documentation starts at `src/index.ts`, so it follows the same boundary.

The smoke test installs the packed archive into a clean fixture, compares both entry points' runtime exports to the reviewed surface, proves the registry entry loads no runtime modules and that an internal transport cannot be imported, runs an ESM JavaScript consumer, compiles a strict NodeNext TypeScript consumer, and runs the installed `queryhost` command. It also checks the packed README's game count and supported-games table against the packed registry, so a new game or alias cannot ship with a stale table.

### Package contents and size

The artifact ships `dist` (JavaScript and declarations, without source maps, which would point at unshipped `src/` files), `docs/api`, `examples`, `CHANGELOG.md`, `LICENSE`, and `README.md`. The hosted website reads `docs/api/**/*.md`, `CHANGELOG.md`, and `package.json` from the installed package, so those paths are part of the release contract. The smoke test requires the CLI, declarations, API reference, examples, changelog, license, and README, and rejects source maps, maintainer documents, source, tests, and repository scripts.

The packed artifact must stay at or below 300 KB compressed, 1.25 MB unpacked, and 450 files. At 1.11.0 it measured about 219 KB, 957 KB, and 341 files; the ceilings leave roughly 30% for new games' compiled modules and API pages. Raise a ceiling only after confirming with `npm pack --dry-run --json` that the growth is intended, and update this paragraph and `scripts/package-smoke.mjs` together.

### Dependencies

QueryHost has one direct runtime dependency, `@foxglove/wasm-bz2`, for bounded decompression of compressed A2S split packets; its only runtime transitive dependency is `tslib`. Their reviewed licenses are MIT and 0BSD; the smoke test fails if the runtime dependency set or either license changes. Every other dependency is development-only. Dependabot proposes weekly npm and GitHub Actions updates; workflow actions are pinned by commit SHA with the release tag in a comment.

## Supported-profile acceptance

A new or changed profile is releasable when it has typed public data, explicit registry capabilities and ports, deterministic merge tests, source provenance, bounded parser and transport behavior, target-safety coverage, successful source fixtures, and failure coverage for its applicable malformed, timeout, blocked, unsupported, skipped, and partial-result paths. Fixture READMEs identify synthetic or redacted provenance. Repository tests run profiles against fake transports and servers; the packed consumers verify the public package without a target-safety bypass.

| Profile                          | Required source            | Full-mode optional sources                                                          | Successful named fixtures                                  |
| -------------------------------- | -------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Generic A2S                      | A2S Info                   | A2S Player, A2S Rules                                                               | `test/fixtures/a2s`                                        |
| Rust                             | A2S Info                   | A2S Player, A2S Rules                                                               | `test/fixtures/rust`                                       |
| Palworld                         | A2S Info                   | A2S Player, A2S Rules                                                               | `test/fixtures/palworld`                                   |
| Project Zomboid                  | A2S Info                   | A2S Player, A2S Rules                                                               | `test/fixtures/project-zomboid`                            |
| 7 Days to Die                    | A2S Info                   | A2S Player, A2S Rules                                                               | `test/fixtures/seven-days-to-die`                          |
| DayZ                             | A2S Info                   | A2S Rules; A2S Player is explicitly unsupported                                     | `test/fixtures/dayz`                                       |
| Valheim                          | A2S Info                   | A2S Player; A2S Rules is explicitly unsupported                                     | `test/fixtures/valheim`                                    |
| Don't Starve Together            | A2S Info                   | A2S Player, A2S Rules                                                               | `test/fixtures/dont-starve-together`                       |
| Source-engine games              | A2S Info                   | A2S Player, A2S Rules                                                               | `test/fixtures/source-engine`                              |
| Steam query-port games           | A2S Info                   | A2S Player (unsupported for Conan Exiles), A2S Rules                                | `test/fixtures/steam-query-port`, `test/fixtures/soulmask` |
| Port-layout games, VEIN, Avorion | A2S Info                   | A2S Player, A2S Rules                                                               | `test/fixtures/steam-query-port`                           |
| Games that need queries enabled  | A2S Info                   | A2S Player (unsupported for Arma Reforger), A2S Rules                               | `test/fixtures/steam-query-port`                           |
| Minecraft: Java Edition          | SLP, else legacy ping      | DNS SRV discovery when applicable, UDP Query in full mode                           | `test/fixtures/minecraft-java`                             |
| Minecraft: Bedrock Edition       | NetherNet, else RakNet     | None                                                                                | `test/fixtures/minecraft-bedrock`                          |
| FiveM                            | Any usable fixed endpoint  | `info.json`, `dynamic.json`, and `players.json` are attempted together in full mode | `test/fixtures/fivem`                                      |
| RedM                             | Any usable fixed endpoint  | `info.json`, `dynamic.json`, and `players.json` are attempted together in full mode | `test/fixtures/redm`                                       |
| Satisfactory                     | Lightweight UDP state      | HTTPS `HealthCheck` in full mode except while loading                               | `test/fixtures/satisfactory`                               |
| Vintage Story                    | Direct TCP status          | None                                                                                | `test/fixtures/vintage-story`                              |
| Eco                              | HTTP `/frontpage`          | None                                                                                | `test/fixtures/eco`                                        |
| Project Reclaimer                | QUIC server-browser status | None                                                                                | `test/fixtures/project-reclaimer`, `test/fixtures/quic`    |

Add a row with every new profile or profile family.

## Cutting a release

1. **Prepare.** On a `chore/release-X.Y.Z` branch, set `version` in `package.json` and `package-lock.json` (`npm version X.Y.Z --no-git-tag-version`), move the changelog's Unreleased entries under a dated `## [X.Y.Z] - YYYY-MM-DD` heading, and add the `[X.Y.Z]: https://github.com/xIGBClutchIx/queryhost/releases/tag/vX.Y.Z` link. `npm run release:check` fails until both are present.
2. **Verify.** Run `npm run verify` and review `npm pack --dry-run --json` for unexpected files or growth. Commit as `chore: release X.Y.Z`, including any regenerated `docs/api` output.
3. **Merge.** Open the pull request and merge it once CI passes.
4. **Release.** Publish a GitHub release whose tag is `vX.Y.Z` on the merged commit, with the changelog section as its notes.
5. **Publish.** `.github/workflows/publish.yml` checks out the tag, rejects a tag that does not match `package.json` (`npm run release:check -- vX.Y.Z`), runs `npm run verify` once, and publishes with `npm publish --provenance --ignore-scripts` (the flag only skips `prepublishOnly`, which would rerun the gate).
6. **Confirm.** Check `npm view queryhost@X.Y.Z`, install it in a clean consumer, and run `npm audit signatures`.

Publishing uses npm trusted publishing: the trust relationship is limited to the `xIGBClutchIx/queryhost` repository and `.github/workflows/publish.yml`, which authenticates with GitHub OIDC and needs no stored npm token. The publish job's permissions are `contents: read` and `id-token: write`.

npm does not permit reuse of a published name and version. If a release has a defect, deprecate it when appropriate and publish a corrected patch version.

### Consumer pickup

The API and web repositories pin exact versions and move them through their own `QueryHost release` workflows. Both call one reusable bump workflow, `.github/workflows/consumer-bump.yml` in `xIGBClutchIx/queryhost-api`, which opens the bump pull request and later merges it once CI and its other checks pass. That workflow, its merge conditions, and its deployment gates belong to the consumers and are documented in their `docs/Operations.md`; this repository holds no deployment policy and only announces each release.

After `npm publish` succeeds, the `consumers` job in `publish.yml` runs `gh workflow run queryhost-release.yml -f version=<version>` in `xIGBClutchIx/queryhost-api` and then `xIGBClutchIx/queryhost-web`, so the bump pull requests open without waiting for the consumers' 15-minute schedules. The dispatch carries only the version; what happens next is up to each consumer. Those schedules remain the fallback and run the merge checks. The job uses the `QUERYHOST_CONSUMER_DISPATCH_TOKEN` repository secret in this repository (Settings, Secrets and variables, Actions): a fine-grained personal access token owned by the repository owner, limited to the `queryhost-api` and `queryhost-web` repositories with **Actions: Read and write** and nothing else beyond the **Metadata: Read** GitHub always adds. The publish job never sees it. When the secret is absent, the job leaves a notice and succeeds; when a dispatch fails, the job fails after trying both consumers, and the schedules still pick the release up. Renew the token before it expires.
