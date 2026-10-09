# Changelog

QueryHost records user-visible package changes in this file.

## [Unreleased]

### Added

- Eco queries over the dedicated server's unauthenticated web `/frontpage` status page (web port 3001, game port `+1`), with the server name stripped of Unity rich-text tags, online player names, total and active player counts, and world facts such as the meteor countdown, laws, animals, and plants. The name and description as served stay under `rawData`.
- `eco` in the `GameProtocol` union and an `eco-frontpage` query source.

## [1.5.1] - 2026-10-08

### Fixed

- Send FiveM, RedM, and Satisfactory HTTP queries through a dedicated built-in agent, so a host application's global or proxy HTTP agent can no longer carry the connection away from the validated, pinned address.

### Changed

- Load the HTTP stacks and the bzip2 decoder only when a query needs them, cutting the package-root import time by more than half.

## [1.5.0] - 2026-10-08

### Added

- A `protocol` field on every `GAME_REGISTRY` definition naming the game's query protocol family (`a2s`, `a2s-unreal`, `minecraft-java`, `minecraft-bedrock`, `cfx`, `satisfactory`, or `vintage-story`), with the exported `GameProtocol` type and a `GameProtocolMap` that types each game's protocol literally.
- Arma Reforger, Starbound, Space Engineers, HumanitZ, and V Rising queries through Steam A2S, with each game's query-port rule, an explicit unsupported Player source for Arma Reforger, and Unreal Engine session data for HumanitZ. Each server must enable queries with a setting; the README names it.

## [1.4.2] - 2026-10-08

### Fixed

- Accept hostnames with more than four DNS answers instead of reporting `TARGET_BLOCKED`. Up to 64 answers are validated, any unsafe answer still rejects the whole set, and four are pinned, alternating address families when both are present.
- Report one round trip in `server.queryRttMs` and A2S source `rttMs` when a server requires a challenge, instead of the sum of the challenge and data exchanges.

### Changed

- Start the next validated address 250 ms after the previous one, or as soon as it fails, for required A2S, Minecraft, Satisfactory, and Vintage Story sources. A silent first address no longer costs its full 2 s budget, and later addresses now get tried within the default deadline.

## [1.4.1] - 2026-10-06

### Fixed

- Return an `INVALID_INPUT` failure instead of throwing when JavaScript callers pass an unregistered game ID, an inherited key such as `"__proto__"`, a non-object input, a non-string host, or a signal that is not an `AbortSignal`.
- Fail a UDP query to a closed port as `CONNECTION_FAILED` in about one round trip instead of waiting out the timeout, by connecting each UDP socket to its pinned peer.

### Changed

- Reduce per-query CPU by about 30% by reusing one abort reason when execution scopes end.

## [1.4.0] - 2026-10-06

### Added

- A browser-safe `queryhost/registry` entry point with the game registry, alias helpers, and their types, so client bundles can share the game list without the Node.js query runtime.

## [1.3.0] - 2026-09-30

### Added

- Counter-Strike 2, Counter-Strike: Source, Team Fortress 2, Left 4 Dead, Left 4 Dead 2, and Garry's Mod queries through a shared Source-engine A2S profile on the game port, with typed server, SourceTV, tag, and Player data plus unchanged Rules output.
- ARK: Survival Evolved, Conan Exiles, Killing Floor 2, Day of Dragons, Soulmask, Sons of the Forest, Icarus, and Abiotic Factor queries through their fixed Steam query ports, with the same typed A2S data, Soulmask's real build version, and an explicit unsupported Player source for Conan Exiles.
- Arma 3, American Truck Simulator, Euro Truck Simulator 2, The Forest, Unturned, Enshrouded, and Insurgency: Sandstorm queries through Steam A2S, with each game's documented query-port rule, plus Arma 3's decoded difficulty, DLC, Creator DLC, mods, and signatures from its binary Rules pages and its typed server-browser keyword fields.
- Team Fortress 2 game modes and friendly fire, random crits, Highlander, and Medieval settings from its automatic tags.
- Garry's Mod gamemode, gamemode Workshop ID, category, location, and build from its space-separated keywords.
- Unreal Engine 4 build ID, open public slots, and session flags for ARK, Conan Exiles, Day of Dragons, Soulmask, Icarus, Abiotic Factor, and Insurgency: Sandstorm, plus Conan's full server name and Abiotic Factor's join code and lock.
- ARK: Survival Evolved session Rules, Workshop mods, and its real build from the server name suffix.
- Insurgency: Sandstorm game mode, coop, lighting, ranked status, mutators, and mod IDs from its Rules.
- Killing Floor 2 game mode, difficulty, wave progress, and match state from its Rules.
- Unturned server-browser flags, full description, Workshop IDs, links, changed gameplay config, and RocketMod plugins from its keywords and chunked Rules.
- Game description, advertised game port, server Steam ID, and the full App ID from the 64-bit game ID in the data of every game above.

## [1.2.1] - 2026-09-15

### Fixed

- Preserve the HTTP transport error when a Satisfactory HTTPS health check is cancelled or reaches the global deadline.

## [1.2.0] - 2026-09-15

### Added

- RedM queries through the shared Cfx FXServer HTTP endpoints, with typed server data, player lists, and game-specific source provenance.
- Palworld dedicated-server queries through Steam A2S, with typed server and Player data plus unchanged Rules output.
- Satisfactory dedicated-server queries using the authentication-free lightweight UDP state and optional HTTPS health APIs.
- Direct Vintage Story server queries with stock-server liveness detection and typed richer status data when the server provides it.
- DayZ dedicated-server queries with typed Info and Rules data, an explicit unsupported Player source, and separate game/query-port defaults.
- Don't Starve Together shard queries through the independently configured Steam A2S port, with typed Info and Player data plus unchanged Rules output.
- Valheim dedicated-server queries for the direct Steam backend, with default game/query ports, typed network and Player data, and explicit unsupported provenance for Rules.

## [1.1.0] - 2026-09-12

### Added

- Generic Source and GoldSource A2S queries with explicit query-port input, typed Info and Player data, and unchanged Rules output.

## [1.0.0] - 2026-09-02

### Added

- Typed game-server queries for Rust, Project Zomboid, 7 Days to Die, Minecraft Java, Minecraft Bedrock, and FiveM.
- Bounded UDP, TCP, and fixed-path HTTP transports with validated and pinned destinations.
- Source provenance, stable failures, partial-result warnings, and game-specific TypeScript data.
- A command-line query tool for local and real-server testing.

### Security

- Public-address enforcement, DNS and SRV answer validation, global deadlines, operation budgets, byte and collection limits, and deterministic transport cleanup.

[1.5.1]: https://github.com/xIGBClutchIx/queryhost/releases/tag/v1.5.1
[1.5.0]: https://github.com/xIGBClutchIx/queryhost/releases/tag/v1.5.0
[1.4.2]: https://github.com/xIGBClutchIx/queryhost/releases/tag/v1.4.2
[1.4.1]: https://github.com/xIGBClutchIx/queryhost/releases/tag/v1.4.1
[1.4.0]: https://github.com/xIGBClutchIx/queryhost/releases/tag/v1.4.0
[1.3.0]: https://github.com/xIGBClutchIx/queryhost/releases/tag/v1.3.0
[1.2.1]: https://github.com/xIGBClutchIx/queryhost/releases/tag/v1.2.1
[1.2.0]: https://github.com/xIGBClutchIx/queryhost/releases/tag/v1.2.0
[1.1.0]: https://github.com/xIGBClutchIx/queryhost/releases/tag/v1.1.0
[1.0.0]: https://github.com/xIGBClutchIx/queryhost/releases/tag/v1.0.0
