# Changelog

QueryHost records user-visible package changes in this file.

## Unreleased

### Added

- RedM queries through the shared Cfx FXServer HTTP endpoints, with typed server data, player lists, and game-specific source provenance.
- Satisfactory dedicated-server queries using the authentication-free lightweight UDP state and optional HTTPS health APIs.
- Direct Vintage Story server queries with stock-server liveness detection and typed richer status data when the server provides it.

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

[1.1.0]: https://github.com/xIGBClutchIx/queryhost/releases/tag/v1.1.0
[1.0.0]: https://github.com/xIGBClutchIx/queryhost/releases/tag/v1.0.0
