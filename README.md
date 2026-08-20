# QueryHost

Fast, typed game server queries for TypeScript.

QueryHost is being built as a modern game-server query engine with correct protocols, explicit source provenance, bounded network behavior, and game-specific TypeScript results.

## Status

The repository currently contains the strict package foundation and Slices 1–9:

- typed public result contracts and an exhaustive game registry
- global deadlines, operation budgets, cancellation, cleanup, and stable internal errors
- hostname and port validation, bounded DNS/SRV resolution, public-address policy, and immutable address pinning
- bounded UDP exchanges with peer validation, packet limits, cancellation, and deterministic socket cleanup
- A2S Info request encoding, bounded challenge handling, and strict Source and GoldSource parsing
- bounded Source and GoldSource split-packet reconstruction with bzip2, size, and checksum validation
- strict A2S Player and Rules parsing with bounded one-retry challenge flows
- concurrent optional A2S enrichment with per-source success, timeout, malformed, blocked, unsupported, skipped, and transport-failure provenance
- the public `query()` entry point and complete Rust, Project Zomboid, and 7 Days to Die profiles that merge A2S Info, Player, and Rules

Minecraft Java, Minecraft Bedrock, and FiveM already have stable public data contracts but return `UNSUPPORTED_GAME` until their implementation slices land.

## Public contract

Literal game IDs remain connected to their game-specific data types:

```ts
import { query } from "queryhost";

const result = await query({
  game: "rust",
  host: "play.example.com",
  port: 28015,
});

if (result.ok) {
  console.log(result.server.name);
  console.log(result.data.tags); // RustData
  console.log(result.sources);
}
```

`QueryResult` is a discriminated union. Check `ok` before reading `data` or `error`. A dynamic `GameId` can be narrowed with an exhaustive switch on `result.game`.

Implemented A2S profiles default to `mode: "full"`: Info is required, then Player and Rules run concurrently against the same pinned address. Use `mode: "summary"` to request only Info; skipped optional sources remain visible as `not-requested`.

`port` is the game's normal connection port. Rust follows its conventional two-port offset, so game port 28015 queries A2S on 28017. Project Zomboid uses UDP 16261 and 7 Days to Die uses UDP 26900 for both the registry default and A2S destination. An explicit `queryPort` always takes precedence for custom layouts.

Project Zomboid interprets its description, PvP state, pause-when-empty state, and semicolon-delimited mod IDs from Rules. 7 Days to Die interprets its description, game name, world, mode, server clock, and website. Both retain the complete raw Rules map, and all rule-derived values remain omitted when Rules is unavailable.

## Command-line queries

For quick real-server testing from this repository:

```bash
npm run query -- rust play.example.com 28015
```

The installed package also provides the same command as `queryhost`. It writes the complete parsed `QueryResult` as formatted JSON and exits with 0 for success, 1 for a query failure, or 2 for invalid command arguments.

```bash
queryhost rust play.example.com 28015 --mode full --timeout 3000
queryhost rust play.example.com --query-port 28017 --mode summary
queryhost project-zomboid play.example.com 16261
queryhost 7-days-to-die play.example.com 26900
```

Run `npm run query -- --help` or `queryhost --help` for the complete option list. The command uses the library's normal target policy, so private, loopback, link-local, reserved, and other non-public destinations remain blocked.

### Data semantics

Optional values are omitted when the server or source cannot confirm them. QueryHost does not convert unavailable data into `false`, zero, or an empty collection.

A required-source failure produces `ok: false`. When a required source succeeds and optional enrichment fails, the result remains successful with `partial: true`, source provenance, and stable warnings.

`server.queryRttMs` measures the primary query exchange. `durationMs` measures the complete operation, including discovery and optional sources. See [Internal architecture](docs/Internals.md) for the full result invariants.

### Registry

Registry metadata is available from the same package so applications, the hosted API, and documentation can share one source of truth:

```ts
import { GAME_REGISTRY, isGameId } from "queryhost";

GAME_REGISTRY["minecraft-java"].defaultPort; // 25565
isGameId("rust"); // true
```

The registry is exhaustive over `GameId`. Adding a game requires a typed data model and registry definition; consumers should not maintain a second game list.

## Safety model

Queries use one global deadline, propagated cancellation, bounded work, and deterministic cleanup. Untrusted targets pass through hostname and port validation, bounded DNS resolution, public-address policy, and immutable address pinning before a transport can connect. The same policy applies to SRV-derived targets.

## Requirements

- Node.js 24 or newer
- npm 12

## Development

```bash
npm install
npm run verify
```

`npm run verify` checks formatting, linting, runtime tests, type tests, the production build, package contents, exports, and published type compatibility.

The codebase uses strict TypeScript across library code, runtime tests, and type tests. Explicit `any` and `unknown` types are forbidden by ESLint; boundary data must be validated into a concrete type before it enters the library.

## Package layout

```text
src/       Public contracts and internal library implementation
test/      Runtime tests
test-d/    Published TypeScript contract tests
docs/      Maintainer-facing technical documentation
```

Detailed module ownership, invariants, and extension rules live in [Internal architecture](docs/Internals.md).

## License

Apache-2.0
