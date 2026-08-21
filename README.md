# QueryHost

Fast, typed game server queries for TypeScript.

QueryHost is being built as a modern game-server query engine with correct protocols, explicit source provenance, bounded network behavior, and game-specific TypeScript results.

## Status

The repository currently contains the strict package foundation and Slices 1–14:

- typed public result contracts and an exhaustive game registry
- global deadlines, operation budgets, cancellation, cleanup, and stable internal errors
- hostname and port validation, bounded DNS/SRV resolution, public-address policy, and immutable address pinning
- bounded UDP exchanges with peer validation, packet limits, cancellation, and deterministic socket cleanup
- A2S Info request encoding, bounded challenge handling, and strict Source and GoldSource parsing
- bounded Source and GoldSource split-packet reconstruction with bzip2, size, and checksum validation
- strict A2S Player and Rules parsing with bounded one-retry challenge flows
- concurrent optional A2S enrichment with per-source success, timeout, malformed, blocked, unsupported, skipped, and transport-failure provenance
- the public `query()` entry point and complete Rust, Project Zomboid, and 7 Days to Die profiles that merge A2S Info, Player, and Rules
- bounded TCP exchanges with pinned destinations, response framing, cancellation, byte limits, and deterministic cleanup
- Minecraft Java Server List Ping with strict VarInts, packet framing, bounded JSON, normalized MOTDs, validated favicons, player counts, protocol versions, and query latency
- deterministic Minecraft SRV discovery and optional same-socket UDP Query enrichment for maps, software, plugins, and player names
- Minecraft Bedrock RakNet status with strict identifiers, bounded UTF-8 fields, advertised ports, and spoofed-peer filtering
- fixed-path HTTP over pinned addresses with preserved Host/SNI identity, redirect refusal, and bounded bodies
- concurrent FiveM `info.json`, `dynamic.json`, and `players.json` queries with explicit partial and blocked-source semantics
- bounded property tests, generated API references, reviewed package boundaries, and clean JavaScript and TypeScript consumer smoke tests

The package is deliberately private at version `0.0.0`. Slice 14 hardens the package for a future release; it does not publish, tag, deploy, or make QueryHost publicly available.

## Public contract

The generated [API reference](docs/api/README.md), packaged [examples](examples), [changelog](CHANGELOG.md), and [release-readiness review](docs/ReleaseReadiness.md) document the intended package boundary.

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

Minecraft Java performs optional SRV discovery followed by one required Server List Ping over TCP. In `full` mode it also attempts optional UDP Query enrichment for the map, software, plugins, and player names. Query failure preserves the successful SLP result as partial; `summary` mode skips Query explicitly.

Minecraft Bedrock sends one required RakNet unconnected ping to UDP 19132 by default. Its pong supplies the normalized name, version, player counts, and Bedrock-specific edition, protocol, game mode, server ID, and advertised IPv4/IPv6 ports. Advertised ports are reported as server data; QueryHost does not follow them or connect to a new destination.

FiveM uses HTTP port 30120 by default. In `full` mode, its fixed `info.json`, `dynamic.json`, and `players.json` endpoints run concurrently against one pinned address. Any usable endpoint can identify a live server; unavailable endpoints remain omitted and produce partial provenance. `summary` mode requests only `dynamic.json`. Redirects are never followed, and blocked `Nope` responses are reported as blocked rather than empty data.

`port` is the game's normal connection port. Rust follows its conventional two-port offset, so game port 28015 queries A2S on 28017. Project Zomboid uses UDP 16261 and 7 Days to Die uses UDP 26900 for both the registry default and A2S destination. An explicit `queryPort` always takes precedence for custom layouts.

Minecraft Java looks up `_minecraft._tcp.<host>` only when `host` is a DNS name and `port` is omitted. Valid SRV targets are tried by ascending priority and RFC-weighted order; no record falls back to the original host on port 25565. Supplying `port` or an IP literal bypasses SRV. `queryPort` changes only the optional UDP Query destination and does not replace the SLP game port.

Game inputs accept documented aliases while results always use the canonical ID. `minecraft` and `mc` resolve to Java Edition; Bedrock remains explicit.

| Canonical ID        | Accepted aliases                                             |
| ------------------- | ------------------------------------------------------------ |
| `rust`              | —                                                            |
| `project-zomboid`   | `projectzomboid`, `zomboid`, `pz`                            |
| `7-days-to-die`     | `seven-days-to-die`, `7days-to-die`, `7d2d`, `7dtd`          |
| `minecraft-java`    | `minecraft`, `mc`, `java`, `minecraft-java-edition`          |
| `minecraft-bedrock` | `bedrock`, `mcbe`, `mc-bedrock`, `minecraft-bedrock-edition` |
| `fivem`             | `five-m`                                                     |

Project Zomboid interprets its description, PvP state, game version, and semicolon-delimited mod IDs from Rules. Its game-specific Rules version takes precedence over the generic A2S Info version. 7 Days to Die interprets its description, game name, world, mode, server clock, and website. Both expose the complete untouched Rules map under `rawData.rules`, separate from normalized `data`; all rule-derived values and `rawData` remain omitted when Rules is unavailable.

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
queryhost 7dtd play.example.com 26900
queryhost mc play.example.com 25565
queryhost mcbe play.example.com 19132
queryhost fivem play.example.com 30120
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

`npm run verify` checks formatting, linting, runtime and property tests, generated API docs, type tests, the production build, dependency licenses, package size and contents, public exports, and packed JavaScript and TypeScript consumers.

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
