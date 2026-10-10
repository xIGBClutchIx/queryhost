# QueryHost

Fast, typed game server queries for TypeScript.

QueryHost is a game-server query engine with correct protocols, explicit source provenance, bounded network behavior, and game-specific TypeScript results.

## Status

The current source tree contains the package foundation and supported profiles:

- typed public result contracts and an exhaustive game registry
- global deadlines, a shared outbound-attempt budget, cancellation, cleanup, and stable internal errors
- hostname and port validation, cancellable bounded DNS/SRV resolution, public-address policy, and immutable address pinning
- bounded UDP exchanges with peer validation, packet limits, cancellation, and deterministic socket cleanup
- A2S Info request encoding, bounded challenge handling, and strict Source and GoldSource parsing
- bounded Source and GoldSource split-packet reconstruction with bzip2, size, and checksum validation
- strict A2S Player and Rules parsing with bounded one-retry challenge flows
- concurrent optional A2S enrichment with per-source success, timeout, malformed, blocked, unsupported, skipped, and transport-failure provenance
- the public `query()` entry point, bounded-concurrency `queryMany()` batches, per-source progress callbacks, and complete Rust, Don't Starve Together, Palworld, Project Zomboid, 7 Days to Die, DayZ, and Steam-backend Valheim profiles over bounded A2S sources
- Counter-Strike 2, Counter-Strike: Source, Team Fortress 2, Left 4 Dead, Left 4 Dead 2, and Garry's Mod profiles over their game-port A2S endpoint
- ARK: Survival Evolved, Conan Exiles, Killing Floor 2, Day of Dragons, Soulmask, Sons of the Forest, Icarus, and Abiotic Factor profiles over their fixed Steam query port
- Arma 3, American Truck Simulator, Euro Truck Simulator 2, The Forest, Unturned, Enshrouded, and Insurgency: Sandstorm profiles over their Steam A2S endpoint
- Arma Reforger, Starbound, Space Engineers, HumanitZ, and V Rising profiles over their Steam A2S endpoint, which each server enables with a setting
- VEIN and Avorion profiles over their Steam A2S query port
- a generic A2S profile for Source and GoldSource servers with an explicit query port
- bounded TCP exchanges with pinned destinations, response framing, cancellation, byte limits, and deterministic cleanup
- Minecraft Java Server List Ping with strict VarInts, packet framing, bounded JSON, normalized MOTDs, validated favicons, player counts, protocol versions, and query latency
- a Minecraft Java legacy ping fallback for pre-1.7 servers (Beta 1.8 through 1.6)
- deterministic Minecraft SRV discovery and optional same-socket UDP Query enrichment for maps, software, plugins, and player names
- Minecraft Bedrock RakNet status with strict identifiers, bounded UTF-8 fields, advertised ports, and spoofed-peer filtering
- a `crossplay` hint on either Minecraft edition when the server advertises a Geyser bridge for the other edition's players, at no extra network cost
- fixed-path HTTP over pinned addresses with preserved Host/SNI identity, redirect refusal, and bounded bodies
- concurrent FiveM and RedM `info.json`, `dynamic.json`, and `players.json` queries with explicit partial and blocked-source semantics
- Satisfactory lightweight UDP status with optional authentication-free HTTPS health enrichment
- direct Vintage Story TCP queries with stock-server liveness detection and typed richer status responses
- Eco queries over the dedicated server's web `/frontpage` status page
- bounded property tests, generated API references, reviewed package boundaries, and clean JavaScript and TypeScript consumer smoke tests

The 1.0.0 release establishes the reviewed package-root contract. QueryHost follows semantic versioning for changes to that contract.

## Installation

```bash
npm install queryhost
```

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

Use `queryMany()` to check a server list, dashboard, or bot's servers together. It runs at most `concurrency` queries at once (8 by default, up to 64) and yields each result as it settles, so a slow server never holds up the rest:

```ts
import { queryMany } from "queryhost";

const servers = [
  { game: "rust", host: "play.example.com" },
  { game: "minecraft", host: "mc.example.com" },
] as const;

for await (const { index, result } of queryMany(servers, { concurrency: 4 })) {
  console.log(index, result.ok ? result.server.players : result.error.code);
}
```

Entries arrive in completion order with the input's `index`. Each target keeps its own `timeoutMs` and `signal`, and a failed target is an ordinary failure entry rather than a rejected batch. Passing `signal` in the options stops starting new inputs and cancels queries in flight; leaving the loop early does the same and waits for their cleanup.

Use `detect()` when you know the host but not the game. It probes the protocols and ports the registry's conventions allow for `port` (or, without one, each game's usual query port), stops at the first answer, and queries the server as the game it found:

```ts
import { detect } from "queryhost";

const detected = await detect({ host: "play.example.com", port: 28015 });

if (detected.ok) {
  console.log(detected.game, detected.evidence); // "rust", "advertised"
  if (detected.result.ok) console.log(detected.result.server.name);
}
```

A2S servers are matched by the Steam App ID they advertise, FiveM and RedM by their `gamename`, and otherwise by a port only one game uses; when nothing names the game, the result is generic A2S with `evidence: "fallback"`. Detection is bounded: at most `maxProbes` protocol and port pairs (8 by default, up to 16) run four at a time inside one `timeoutMs`, and `probes` reports each planned pair as `matched`, `answered`, `failed`, `cancelled`, or `skipped`. A host where nothing answered resolves with `NOT_DETECTED`. Passing the port players connect to keeps detection fast and precise. A port that is no game's default maps to more candidate destinations than the default budget covers, so raise `maxProbes` (up to 16) to try more of them.

For live progress, pass `onSource` with any query. It is called as each source starts and completes, and its completed reports are exactly the result's `sources`.

Implemented A2S profiles default to `mode: "full"`: Info is required, then supported optional sources run concurrently against the same pinned address. Use `mode: "summary"` to request only Info; skipped optional sources remain visible as `not-requested`.

Use `game: "a2s"` for an otherwise unsupported Source or GoldSource server. Generic A2S has no default port: `port` is required and means the server's actual A2S query port. It returns common Info facts and Player data under `data`, with unchanged Rules under `rawData.rules`.

Palworld uses its public Steam A2S listener for unauthenticated status queries. Info supplies the normalized summary; Player and Rules are conditional because deployments do not consistently expose them. This profile does not call Pocketpair's separate authenticated REST API, so REST-only player details and server settings are not represented as A2S data.

Don't Starve Together uses the Steam A2S service exposed by each shard, not its gameplay socket or Klei's lobby HTTP service. `port` is the gameplay port (default 10999); the independent Steam query port defaults to 27016 and can be changed with `queryPort`. A query describes only the shard that owns that Steam port. QueryHost does not discover sibling shards or combine a cluster, and a Klei lobby listing's gameplay port does not reveal a custom Steam query port.

Valheim queries its direct Steam-backend A2S endpoint. The default game port is UDP 2456 and the query destination is UDP 2457; custom game ports preserve that `+1` convention. Info provides the world, build, password state, and counts. Full mode also requests Player records, whose names Valheim commonly leaves empty, while Rules is reported as `unsupported` without network work. Successful data carries `backend: "steam"`. Servers launched with `-crossplay` use PlayFab relay discovery and cannot be queried through this direct A2S profile.

Counter-Strike 2, Counter-Strike: Source, Team Fortress 2, Left 4 Dead, Left 4 Dead 2, and Garry's Mod share one Source-engine profile. Each answers A2S on its game port, 27015 by default, so a custom `port` is also the query destination. Info supplies the normalized summary plus the game description, content folder, bots, VAC state, full App ID, advertised game port, server Steam ID, `sv_tags`, and any advertised SourceTV relay. Player and Rules are conditional because servers can hide them with cvars; Counter-Strike 2 commonly returns player records with empty names unless a server plugin restores them. Garry's Mod splits its space-separated keywords and types the gamemode, gamemode Workshop ID, category, location, and build. Team Fortress 2 derives its game modes, friendly fire, random crits, Highlander, and Medieval settings from the tags the game adds automatically.

ARK: Survival Evolved, Conan Exiles, Killing Floor 2, Day of Dragons, Soulmask, Sons of the Forest, Icarus, and Abiotic Factor answer A2S on a separately configured Steam query port. Their data has the same shape as the Source-engine games. Conan Exiles never answers A2S Player, so its Player source is reported as `unsupported` without network work. Soulmask advertises a placeholder `1.0.0.0` Info version; when Rules includes its `NO_s` build, `server.version` uses that instead. ARK also types its session Rules (full server name, PvE, BattlEye, official, cluster, game mode, day, download permissions, and Workshop mods) and takes `server.version` from the ` - (v358.7)` suffix ARK appends to its name, because its Info version is also a placeholder. The Unreal Engine 4 games (ARK, Conan Exiles, Day of Dragons, Soulmask, Icarus, Abiotic Factor, and Insurgency: Sandstorm) also report the build ID, open public slots, and decoded session flags their Steam integration advertises; Conan Exiles adds its full server name and Abiotic Factor its join code and password lock. Killing Floor 2 types its match Rules: game mode, difficulty, current and total waves, whether a match is in progress, mutators, custom (unranked) status, and spectators.

Arma 3, American Truck Simulator, Euro Truck Simulator 2, The Forest, Unturned, Enshrouded, and Insurgency: Sandstorm use the same Steam A2S data shape. Arma 3 also decodes its binary server-browser Rules into difficulty settings, required DLC, Creator DLC, Workshop mods, and accepted signatures, and its one-letter keywords into BattlEye, required version and build, session state, game type, lock, signature, platform, language, country, time-left, and island fields. Unturned types its server-browser flags (PvP, cheats, difficulty, camera, Workshop, Gold, BattlEye, monetization, thumbnail, transport, and plugin framework) and its chunked Rules (game version, full description, Workshop IDs, links, changed gameplay config, and RocketMod plugins). Insurgency: Sandstorm types its game mode, coop or versus, day or night lighting, ranked status, mutators, and mod.io mod IDs.

Arma Reforger, Starbound, Space Engineers, HumanitZ, and V Rising use the same Steam A2S data shape, but their servers answer only when a server setting enables queries. Arma Reforger needs the `a2s` block in its server config (`address` plus `port`, 17777 by default) and never provides player records, so its Player source is reported as `unsupported` without network work. Starbound needs `"runQueryServer": true` in `starbound_server.config`; its `queryServerPort` defaults to the game port, 21025. Space Engineers answers on its game port (`ServerPort`, 27016 by default). HumanitZ answers on the port its `-queryport` launch option sets, 27015 by default, and reports the same Unreal Engine build ID, open public slots, and session flags as the other Unreal Engine games. V Rising registers with Steam only when `ListOnSteam` is `true` in `ServerHostSettings.json`, and then answers on `QueryPort`, 9877 by default.

VEIN and Avorion use the same Steam A2S data shape and answer without extra server configuration. VEIN queries `-QueryPort`, which defaults to the game port `+1` (7777 and 7778). Avorion queries its separately configured Steam query port, which stays at 27020 when the game port (27000 by default) changes; its separate 27003 port is Avorion's own server-listing protocol and is not used.

Minecraft Java performs optional SRV discovery followed by one required Server List Ping over TCP. When a pre-1.7 server closes or rejects that handshake, QueryHost retries once with the legacy ping and reports it as the `minecraft-legacy-ping` source; legacy responses have no favicon, and Beta 1.8 through 1.3 servers report no version or protocol, so those fields are omitted. In `full` mode it also attempts optional UDP Query enrichment for the map, software, plugins, and player names. Query failure preserves the successful SLP result as partial; `summary` mode skips Query explicitly.

Minecraft Bedrock sends one required RakNet unconnected ping to UDP 19132 by default. Its pong supplies the normalized name, version, player counts, and Bedrock-specific edition, protocol, game mode, server ID, and advertised IPv4/IPv6 ports. Advertised ports are reported as server data; QueryHost does not follow them or connect to a new destination.

FiveM and RedM use the shared Cfx FXServer HTTP endpoint family on port 30120 by default. In `full` mode, their fixed `info.json`, `dynamic.json`, and `players.json` endpoints run concurrently against one pinned address. Any usable endpoint can identify a live server; unavailable endpoints remain omitted and produce game-specific partial provenance. `summary` mode requests only `dynamic.json`. Redirects are never followed, and blocked `Nope` responses are reported as blocked rather than empty data.

Vintage Story uses its normal TCP game port, 42420 by default. Current stock servers acknowledge the direct status request without disclosing metadata, producing `data.response: "liveness"`; compatible servers may return the protocol's richer status answer with name, MOTD, player counts, mode, password state, and version. QueryHost connects only to the caller's validated, pinned target and does not consult the public server list or another central service.

Eco reads the dedicated server's unauthenticated `GET /frontpage` status page from its web server, TCP 3001 by default. `port` is the UDP game port (3000 by default) and the web port follows it at `+1`; set `queryPort` when `WebServerPort` is configured separately. The page supplies the normalized name (with Unity rich-text tags removed), version, password state, and online count, plus online player names and world facts such as the meteor countdown, laws, animals, and plants. Eco reports how many players have ever joined the world rather than a slot limit, so `server.players.max` is omitted and that count is `data.totalPlayers`. The name and long description exactly as served, tags included, are kept under `rawData`.

Satisfactory uses the dedicated server's shared UDP/TCP game port, 7777 by default. Its lightweight UDP API is the required status source and returns the server name, lifecycle state, network changelist, modded flag, and substate revisions without authentication. Full mode additionally calls the authentication-free HTTPS `HealthCheck`; summary mode and the documented `loading` state skip HTTPS. Vanilla servers generate self-signed certificates by default, so this narrowly scoped request disables certificate identity validation while retaining TLS encryption and the validated pinned destination. QueryHost never attempts password login, requests an API token, or calls authenticated management functions.

`port` is the game's normal connection port. Rust follows its conventional two-port offset, so game port 28015 queries A2S on 28017. Palworld uses game port 8211 and a fixed conventional Steam query port of 27015; changing the game port does not shift that query default. DayZ uses game port 2302 and Steam query port 2305 by convention; a custom game port preserves the `+3` offset. Don't Starve Together keeps its independently configured query port at 27016 even when `port` changes. The same fixed rule applies to Steam query port 27015 for ARK: Survival Evolved, Conan Exiles, Killing Floor 2, Day of Dragons, and Abiotic Factor (game port 7777), Soulmask (8777), and Icarus (17777), and to 27016 for Sons of the Forest (8766). American Truck Simulator, Euro Truck Simulator 2, and The Forest default to game port 27015 with fixed query port 27016, and Insurgency: Sandstorm to 27102 with fixed query port 27131. Arma 3 derives its query port as game port `+1` (2302 and 2303 by default). Arma Reforger keeps its A2S port fixed at 17777 for game port 2001, Starbound keeps its query port at 21025, and HumanitZ keeps 27015 for game port 7777. V Rising keeps its separately configured `QueryPort` at 9877 for game port 9876, and Space Engineers answers on its game port (27016). Unturned (27015) and Enshrouded (15637) answer A2S on the port players connect to, so a custom `port` is also the query destination. Project Zomboid uses UDP 16261, 7 Days to Die uses UDP 26900, and the Source-engine games use UDP 27015 for both the registry default and A2S destination. An explicit `queryPort` always takes precedence for custom layouts.

Minecraft Java looks up `_minecraft._tcp.<host>` only when `host` is a DNS name and `port` is omitted. Valid SRV targets are tried by ascending priority and RFC-weighted order; no record falls back to the original host on port 25565. Supplying `port` or an IP literal bypasses SRV. `queryPort` changes only the optional UDP Query destination and does not replace the SLP game port.

Game inputs accept documented aliases while results always use the canonical ID. `minecraft` and `mc` resolve to Java Edition; Bedrock remains explicit.

| Canonical ID               | Accepted aliases                                             |
| -------------------------- | ------------------------------------------------------------ |
| `a2s`                      | —                                                            |
| `rust`                     | —                                                            |
| `palworld`                 | —                                                            |
| `project-zomboid`          | `projectzomboid`, `zomboid`, `pz`                            |
| `7-days-to-die`            | `seven-days-to-die`, `7days-to-die`, `7d2d`, `7dtd`          |
| `dayz`                     | —                                                            |
| `valheim`                  | —                                                            |
| `minecraft-java`           | `minecraft`, `mc`, `java`, `minecraft-java-edition`          |
| `minecraft-bedrock`        | `bedrock`, `mcbe`, `mc-bedrock`, `minecraft-bedrock-edition` |
| `fivem`                    | `five-m`                                                     |
| `redm`                     | `red-m`, `rdr3`                                              |
| `satisfactory`             | —                                                            |
| `vintage-story`            | `vintagestory`, `vs`                                         |
| `dont-starve-together`     | `dst`, `dontstarvetogether`                                  |
| `counter-strike-2`         | `cs2`, `counterstrike2`                                      |
| `counter-strike-source`    | `css`, `cs-source`, `counterstrikesource`                    |
| `team-fortress-2`          | `tf2`, `teamfortress2`                                       |
| `left-4-dead`              | `l4d`, `left4dead`                                           |
| `left-4-dead-2`            | `l4d2`, `left4dead2`                                         |
| `garrys-mod`               | `gmod`, `garrysmod`                                          |
| `ark-survival-evolved`     | `ark`, `arkse`, `ase`                                        |
| `conan-exiles`             | `conan`, `conanexiles`                                       |
| `killing-floor-2`          | `kf2`, `killingfloor2`                                       |
| `day-of-dragons`           | `dayofdragons`                                               |
| `soulmask`                 | —                                                            |
| `sons-of-the-forest`       | `sotf`, `sonsoftheforest`                                    |
| `icarus`                   | —                                                            |
| `abiotic-factor`           | `abioticfactor`                                              |
| `arma-3`                   | `arma3`, `a3`                                                |
| `american-truck-simulator` | `ats`, `americantrucksimulator`                              |
| `euro-truck-simulator-2`   | `ets2`, `eurotrucksimulator2`                                |
| `the-forest`               | `theforest`                                                  |
| `unturned`                 | —                                                            |
| `enshrouded`               | —                                                            |
| `insurgency-sandstorm`     | `sandstorm`, `insurgencysandstorm`                           |
| `arma-reforger`            | `armareforger`, `reforger`                                   |
| `starbound`                | —                                                            |
| `space-engineers`          | `spaceengineers`                                             |
| `humanitz`                 | —                                                            |
| `v-rising`                 | `vrising`                                                    |
| `eco`                      | —                                                            |
| `vein`                     | —                                                            |
| `avorion`                  | —                                                            |

Project Zomboid interprets its description, PvP state, game version, and semicolon-delimited mod IDs from Rules. Its game-specific Rules version takes precedence over the generic A2S Info version. 7 Days to Die interprets its description, game name, world, mode, server clock, and website.

DayZ uses required A2S Info and optional A2S Rules. It exposes ordered Info keywords plus validated direct Rules fields such as terrain, platform, dedicated state, connection port, and build/version values. Its bounded DayZ decoder also reassembles escaped server-browser metadata pages into a description, Steam Workshop mods, and signing-key names. Direct string-valued Rules remain available under `rawData.rules`; binary page records are represented by their typed decoded values instead of lossy strings. Malformed or undocumented values remain raw instead of being guessed. DayZ's A2S Player response is intentionally `unsupported`: Info still supplies confirmed aggregate player counts, but the profile does not present anonymous or malformed Player records as identities. DayZ's official [server configuration](https://community.bohemia.net/wiki/DayZ:Server_Configuration) documents its separately configured game and Steam query ports, while the official [server-browser source](https://github.com/BohemiaInteractive/DayZ-Script-Diff/blob/main/scripts/5_mission/gui/newui/serverbrowsermenu/serverbrowsermenunew.c) keeps both destinations distinct.

Every named A2S profile exposes confirmed string Rules unchanged under `rawData.rules`, separate from normalized `data`; all rule-derived values and `rawData` remain omitted when Rules is unavailable.

## Command-line queries

For quick real-server testing from this repository:

```bash
npm run query -- rust play.example.com 28015
```

The installed package also provides the same command as `queryhost`. Pass `auto` instead of a game to run `detect()` and print its `DetectResult`. It writes the complete parsed `QueryResult` as formatted JSON and exits with 0 for success, 1 for a query failure, or 2 for invalid command arguments.

```bash
queryhost a2s play.example.com 27015
queryhost auto play.example.com 28015
queryhost dayz play.example.com 2302 --mode full
queryhost dst play.example.com 10999 --query-port 27016
queryhost rust play.example.com 28015 --mode full --timeout 3000
queryhost palworld play.example.com 8211 --mode full
queryhost rust play.example.com --query-port 28017 --mode summary
queryhost project-zomboid play.example.com 16261
queryhost 7-days-to-die play.example.com 26900
queryhost 7dtd play.example.com 26900
queryhost valheim play.example.com 2456
queryhost cs2 play.example.com 27015
queryhost tf2 play.example.com 27015
queryhost gmod play.example.com 27015
queryhost ark play.example.com 7777
queryhost sotf play.example.com 8766
queryhost arma3 play.example.com 2302
queryhost ets2 play.example.com 27015
queryhost mc play.example.com 25565
queryhost mcbe play.example.com 19132
queryhost fivem play.example.com 30120
queryhost redm play.example.com 30120
queryhost satisfactory play.example.com 7777
queryhost vs play.example.com 42420
queryhost eco play.example.com 3000
queryhost vein play.example.com 7777
queryhost avorion play.example.com 27000
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

Browser and edge code can import the same metadata from `queryhost/registry`. That entry point contains only the registry, the alias helpers, and their types, so bundlers never pull in the Node.js transports behind `query()`:

```ts
import { listGames } from "queryhost/registry";

const games = listGames(); // safe in a browser bundle
```

## Infrastructure boundary

This package is a standalone Node.js library with no Cloudflare or Railway dependencies. Every `query()` call performs live network work unless the caller adds caching. The separate hosted API runs the package as a portable Node.js service on Railway behind Cloudflare.

## Safety model

Queries use one global deadline, propagated cancellation, a shared 16-attempt outbound-work budget, and deterministic cleanup. Production DNS uses one resolver per query, cancels its native work with the query, and settles immediately when the caller aborts or the deadline expires. Untrusted targets pass through hostname and port validation, DNS/SRV answer caps, public-address policy, and immutable address pinning before a transport can connect. The same policy applies to SRV-derived targets.

## Requirements

- Node.js 24 or newer
- npm 12

## Development

```bash
npm install
npm run verify
```

`npm run verify` checks formatting, linting, runtime and property tests, generated API docs, type tests, the production build, dependency licenses, package size and contents, public exports, and packed JavaScript and TypeScript consumers.

The codebase uses the native TypeScript 7 compiler across library code, runtime tests, and type tests. Oxlint provides type-aware linting through its Go backend, while TypeDoc uses the TypeScript 6 compatibility package until the native compiler exposes a stable tooling API. Explicit `any` and `unknown` types are forbidden; boundary data must be validated into a concrete type before it enters the library.

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
