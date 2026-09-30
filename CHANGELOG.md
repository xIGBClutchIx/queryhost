# Changelog

QueryHost records user-visible package changes in this file.

## [Unreleased]

### Added

- Counter-Strike 2, Counter-Strike: Source, Team Fortress 2, Left 4 Dead, Left 4 Dead 2, and Garry's Mod queries through a shared Source-engine A2S profile on the game port, with typed server, SourceTV, tag, and Player data plus unchanged Rules output.
- ARK: Survival Evolved, Conan Exiles, Killing Floor 2, Day of Dragons, Soulmask, Sons of the Forest, Icarus, and Abiotic Factor queries through their fixed Steam query ports, with the same typed A2S data, Soulmask's real build version, and an explicit unsupported Player source for Conan Exiles.
- Arma 3, American Truck Simulator, Euro Truck Simulator 2, The Forest, Unturned, Enshrouded, and Insurgency: Sandstorm queries through Steam A2S, with each game's documented query-port rule, plus Arma 3's decoded difficulty, DLC, Creator DLC, mods, and signatures from its binary Rules pages and its typed server-browser keyword fields.
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

[1.2.1]: https://github.com/xIGBClutchIx/queryhost/releases/tag/v1.2.1
[1.2.0]: https://github.com/xIGBClutchIx/queryhost/releases/tag/v1.2.0
[1.1.0]: https://github.com/xIGBClutchIx/queryhost/releases/tag/v1.1.0
[1.0.0]: https://github.com/xIGBClutchIx/queryhost/releases/tag/v1.0.0
