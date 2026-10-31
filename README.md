# QueryHost

Fast, typed game server queries for TypeScript.

QueryHost asks a game server for its live status and returns a typed result: the server name, map, version, player counts, and game-specific data such as mods, rules, and player lists. Every result records which protocol sources answered, so a partial answer is never mistaken for a complete one, and every query runs within a deadline, a byte budget, and a public-address policy.

## Features

- **43 games plus generic A2S.** Steam A2S games (Source, GoldSource, and Unreal Engine servers), Minecraft Java and Bedrock, FiveM and RedM, Satisfactory, Vintage Story, Eco, and Project Reclaimer. See [Supported games](#supported-games).
- **Game-specific types.** A literal game ID such as `"rust"` narrows the result to that game's data type.
- **Source provenance.** Each result lists every protocol source it attempted and how it ended, and marks partial results with stable warnings.
- **Batches and detection.** `queryMany()` checks many servers with bounded concurrency; `detect()` finds the game a host is running.
- **Bounded and safe by default.** One deadline per query, cancellation, attempt and byte limits, deterministic cleanup, and validated, pinned public destinations.
- **Shared registry.** Game metadata, aliases, and the result vocabulary are exported, including a browser-safe `queryhost/registry` entry point.
- **Command line.** The `queryhost` command prints any query as JSON.

## Status

QueryHost is stable. The package-root contract has followed semantic versioning since 1.0.0; the [changelog](CHANGELOG.md) lists every release. QueryHost is a Node.js library with no hosting-platform dependencies, and every `query()` performs live network work, so add your own caching when you need it.

## Installation

```bash
npm install queryhost
```

QueryHost requires Node.js 24 or newer and is published as an ES module.

## Quick start

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
} else {
  console.error(result.error.code, result.error.message);
}
```

The generated [API reference](docs/api/README.md) documents every export, and the packaged [examples](examples) show JavaScript and TypeScript consumers.

## Public contract

### `query()`

`query()` takes a game ID or alias, a `host`, and optionally `port`, `queryPort`, `mode`, `timeoutMs`, `signal`, and `onSource`. It always resolves; it never rejects for a failed server.

`QueryResult` is a discriminated union. Check `ok` before reading `data` or `error`. A dynamic `GameId` can be narrowed with an exhaustive switch on `result.game`.

`port` is the game's normal connection port. Each game maps it to its query destination by its own convention (Rust queries game port `+2`, for example); an explicit `queryPort` always takes precedence for custom layouts.

Profiles default to `mode: "full"`: the required source runs first, then supported optional sources run concurrently against the same pinned address. Use `mode: "summary"` to request only the required source; skipped optional sources remain visible as `not-requested`.

For live progress, pass `onSource`. It is called as each source starts and completes, and its completed reports are exactly the result's `sources`.

### Results, errors, and warnings

Optional values are omitted when the server or source cannot confirm them. QueryHost does not convert unavailable data into `false`, zero, or an empty collection.

A required-source failure produces `ok: false` with a stable `error.code`. When a required source succeeds and optional enrichment fails, the result remains successful with `partial: true`, per-source provenance in `sources`, and stable `warnings`.

`server.queryRttMs` measures the primary query exchange. `durationMs` measures the complete operation, including discovery and optional sources.

### `queryMany()`

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

### `detect()`

Use `detect()` when you know the host but not the game. It probes the protocols and ports the registry's conventions allow for `port` (or, without one, each game's usual query port), stops at the first answer, and queries the server as the game it found:

```ts
import { detect } from "queryhost";

const detected = await detect({ host: "play.example.com", port: 28015 });

if (detected.ok) {
  console.log(detected.game, detected.evidence); // "rust", "advertised"
  if (detected.result.ok) console.log(detected.result.server.name);
}
```

A2S servers are matched by the Steam App ID they advertise, FiveM and RedM by their `gamename`, and otherwise by a port only one game uses; when nothing names the game, the result is generic A2S with `evidence: "fallback"`. Detection is bounded: at most `maxProbes` protocol and port pairs (9 by default, up to 16) run four at a time inside one `timeoutMs`, and `probes` reports each planned pair as `matched`, `answered`, `failed`, `cancelled`, or `skipped`. A host where nothing answered resolves with `NOT_DETECTED`. Passing the port players connect to keeps detection fast and precise. A port that is no game's default maps to more candidate destinations than the default budget covers, so raise `maxProbes` (up to 16) to try more of them.

### Registry and vocabulary

Registry metadata is available from the same package so applications and documentation can share one source of truth:

```ts
import { GAME_REGISTRY, isGameId, listGames } from "queryhost";

GAME_REGISTRY["minecraft-java"].defaultPort; // 25565
isGameId("rust"); // true
listGames().map((game) => game.id); // every supported game ID
```

The registry is exhaustive over `GameId` and deeply frozen. Game inputs accept aliases (`GAME_ALIASES`, `canonicalGameId()`), while results always use the canonical ID. Each game's `capabilities` map rates every `GameCapability` as `supported`, `conditional`, or `unsupported`; `players` means a player list can be returned, while player counts are part of `summary`.

`resolveQueryPort()` returns the port `query()` will contact for a game and optional `port`/`queryPort`, or `undefined` when the input cannot produce a valid port:

```ts
import { resolveQueryPort } from "queryhost";

resolveQueryPort("rust"); // 28017
resolveQueryPort("rust", { port: 28100 }); // 28102
resolveQueryPort("rust", { port: 28100, queryPort: 28200 }); // 28200
resolveQueryPort("a2s"); // undefined: generic A2S needs a port
```

The result vocabulary is exported as frozen tuples that list every member of their union in declaration order: `GAME_PROTOCOLS`, `GAME_CAPABILITIES`, `SUPPORT_LEVELS`, `QUERY_SOURCE_NAMES`, `QUERY_SOURCE_STATUSES`, `QUERY_ERROR_CODES`, `QUERY_WARNING_CODES`, and `DETECT_ERROR_CODES`. Each union type is derived from its tuple, so schemas, validators, and documentation built from them gain new members with the package instead of a hand-kept copy. `QUERY_SOURCE_LABELS` gives each query source a short display label:

```ts
import { QUERY_SOURCE_LABELS, QUERY_SOURCE_NAMES } from "queryhost";

QUERY_SOURCE_NAMES.map((source) => QUERY_SOURCE_LABELS[source]); // ["Info", "Players", ...]
```

`QUERY_ERROR_GUIDANCE`, `DETECT_ERROR_GUIDANCE`, and `QUERY_WARNING_GUIDANCE` give every code a deeply frozen `CodeGuidance` entry: a one-sentence `meaning` and the typical `response`. Detection codes shared with query failures reuse the query entries:

```ts
import { QUERY_ERROR_CODES, QUERY_ERROR_GUIDANCE } from "queryhost";

QUERY_ERROR_CODES.map((code) => [code, QUERY_ERROR_GUIDANCE[code].meaning]);
// [["ABORTED", "The caller's signal cancelled the query."], ...]
```

Browser and edge code can import the same metadata from `queryhost/registry`. That entry point contains only the registry, the alias helpers, the result vocabulary, and their types, so bundlers never pull in the Node.js transports behind `query()`:

```ts
import { listGames } from "queryhost/registry";

const games = listGames(); // safe in a browser bundle
```

## Supported games

The default port is the port players connect to, which `port` means in every query. Generic A2S has no default: its `port` is required and means the server's actual A2S query port. `minecraft` and `mc` resolve to Java Edition; Bedrock remains explicit.

| Game                       | ID                         | Aliases                                                      | Default port |
| -------------------------- | -------------------------- | ------------------------------------------------------------ | ------------ |
| Generic A2S                | `a2s`                      | —                                                            | —            |
| Don't Starve Together      | `dont-starve-together`     | `dst`, `dontstarvetogether`                                  | 10999        |
| Rust                       | `rust`                     | —                                                            | 28015        |
| Palworld                   | `palworld`                 | —                                                            | 8211         |
| Project Zomboid            | `project-zomboid`          | `zomboid`, `pz`, `projectzomboid`                            | 16261        |
| 7 Days to Die              | `7-days-to-die`            | `seven-days-to-die`, `7days-to-die`, `7d2d`, `7dtd`          | 26900        |
| DayZ                       | `dayz`                     | —                                                            | 2302         |
| Valheim                    | `valheim`                  | —                                                            | 2456         |
| Minecraft: Java Edition    | `minecraft-java`           | `minecraft`, `mc`, `java`, `minecraft-java-edition`          | 25565        |
| Minecraft: Bedrock Edition | `minecraft-bedrock`        | `bedrock`, `mcbe`, `mc-bedrock`, `minecraft-bedrock-edition` | 19132        |
| FiveM                      | `fivem`                    | `five-m`                                                     | 30120        |
| RedM                       | `redm`                     | `red-m`, `rdr3`                                              | 30120        |
| Satisfactory               | `satisfactory`             | —                                                            | 7777         |
| Vintage Story              | `vintage-story`            | `vintagestory`, `vs`                                         | 42420        |
| Counter-Strike 2           | `counter-strike-2`         | `cs2`, `counterstrike2`                                      | 27015        |
| Counter-Strike: Source     | `counter-strike-source`    | `css`, `cs-source`, `counterstrikesource`                    | 27015        |
| Team Fortress 2            | `team-fortress-2`          | `tf2`, `teamfortress2`                                       | 27015        |
| Left 4 Dead                | `left-4-dead`              | `l4d`, `left4dead`                                           | 27015        |
| Left 4 Dead 2              | `left-4-dead-2`            | `l4d2`, `left4dead2`                                         | 27015        |
| Garry's Mod                | `garrys-mod`               | `gmod`, `garrysmod`                                          | 27015        |
| ARK: Survival Evolved      | `ark-survival-evolved`     | `ark`, `arkse`, `ase`                                        | 7777         |
| Conan Exiles               | `conan-exiles`             | `conan`, `conanexiles`                                       | 7777         |
| Killing Floor 2            | `killing-floor-2`          | `kf2`, `killingfloor2`                                       | 7777         |
| Day of Dragons             | `day-of-dragons`           | `dayofdragons`                                               | 7777         |
| Soulmask                   | `soulmask`                 | —                                                            | 8777         |
| Sons of the Forest         | `sons-of-the-forest`       | `sotf`, `sonsoftheforest`                                    | 8766         |
| Icarus                     | `icarus`                   | —                                                            | 17777        |
| Abiotic Factor             | `abiotic-factor`           | `abioticfactor`                                              | 7777         |
| Arma 3                     | `arma-3`                   | `arma3`, `a3`                                                | 2302         |
| American Truck Simulator   | `american-truck-simulator` | `ats`, `americantrucksimulator`                              | 27015        |
| Euro Truck Simulator 2     | `euro-truck-simulator-2`   | `ets2`, `eurotrucksimulator2`                                | 27015        |
| The Forest                 | `the-forest`               | `theforest`                                                  | 27015        |
| Unturned                   | `unturned`                 | —                                                            | 27015        |
| Enshrouded                 | `enshrouded`               | —                                                            | 15637        |
| Insurgency: Sandstorm      | `insurgency-sandstorm`     | `sandstorm`, `insurgencysandstorm`                           | 27102        |
| Arma Reforger              | `arma-reforger`            | `armareforger`, `reforger`                                   | 2001         |
| Starbound                  | `starbound`                | —                                                            | 21025        |
| Space Engineers            | `space-engineers`          | `spaceengineers`                                             | 27016        |
| HumanitZ                   | `humanitz`                 | —                                                            | 7777         |
| V Rising                   | `v-rising`                 | `vrising`                                                    | 9876         |
| Eco                        | `eco`                      | —                                                            | 3000         |
| VEIN                       | `vein`                     | —                                                            | 7777         |
| Avorion                    | `avorion`                  | —                                                            | 27000        |
| Project Reclaimer          | `project-reclaimer`        | `reclaimer`                                                  | 49176        |

The package smoke test checks this table against the packaged registry. At runtime, `listGames()` and `GAME_ALIASES` are the authoritative list.

### Game notes

**Generic A2S.** Use `game: "a2s"` for an otherwise unsupported Source or GoldSource server. It returns common Info facts and Player data under `data`, with unchanged Rules under `rawData.rules`.

**Steam A2S games.** Every named A2S profile requires A2S Info; in full mode Player and Rules follow as optional sources. Each exposes confirmed string Rules unchanged under `rawData.rules`, separate from normalized `data`; all rule-derived values and `rawData` remain omitted when Rules is unavailable.

**Query ports.** Rust queries A2S on game port `+2` (28015 → 28017). Palworld uses a fixed Steam query port of 27015 that does not shift with the game port. DayZ uses game port `+3` (2302 → 2305). Don't Starve Together keeps its independently configured query port at 27016 even when `port` changes. The same fixed rule applies to Steam query port 27015 for ARK: Survival Evolved, Conan Exiles, Killing Floor 2, Day of Dragons, and Abiotic Factor (game port 7777), Soulmask (8777), and Icarus (17777), and to 27016 for Sons of the Forest (8766). American Truck Simulator, Euro Truck Simulator 2, and The Forest default to game port 27015 with fixed query port 27016, and Insurgency: Sandstorm to 27102 with fixed query port 27131. Arma 3 derives its query port as game port `+1` (2302 and 2303 by default). Arma Reforger keeps its A2S port fixed at 17777 for game port 2001, Starbound keeps its query port at 21025, and HumanitZ keeps 27015 for game port 7777. V Rising keeps its separately configured `QueryPort` at 9877 for game port 9876, and Space Engineers answers on its game port (27016). Unturned (27015) and Enshrouded (15637) answer A2S on the port players connect to, so a custom `port` is also the query destination. Project Zomboid uses UDP 16261, 7 Days to Die uses UDP 26900, and the Source-engine games use UDP 27015 for both the registry default and A2S destination.

**Palworld** uses its public Steam A2S listener for unauthenticated status queries. Info supplies the normalized summary; Player and Rules are conditional because deployments do not consistently expose them. This profile does not call Pocketpair's separate authenticated REST API, so REST-only player details and server settings are not represented as A2S data.

**Don't Starve Together** uses the Steam A2S service exposed by each shard, not its gameplay socket or Klei's lobby HTTP service. `port` is the gameplay port (default 10999); the independent Steam query port defaults to 27016 and can be changed with `queryPort`. A query describes only the shard that owns that Steam port. QueryHost does not discover sibling shards or combine a cluster, and a Klei lobby listing's gameplay port does not reveal a custom Steam query port.

**Valheim** queries its direct Steam-backend A2S endpoint. The default game port is UDP 2456 and the query destination is UDP 2457; custom game ports preserve that `+1` convention. Info provides the world, build, password state, and counts. Full mode also requests Player records, whose names Valheim commonly leaves empty, while Rules is reported as `unsupported` without network work. Successful data carries `backend: "steam"`. Servers launched with `-crossplay` use PlayFab relay discovery and cannot be queried through this direct A2S profile.

**Project Zomboid** interprets its description, PvP state, game version, and semicolon-delimited mod IDs from Rules. Its game-specific Rules version takes precedence over the generic A2S Info version. **7 Days to Die** interprets its description, game name, world, mode, server clock, and website.

**DayZ** uses required A2S Info and optional A2S Rules. It exposes ordered Info keywords plus validated direct Rules fields such as terrain, platform, dedicated state, connection port, and build/version values. Its bounded DayZ decoder also reassembles escaped server-browser metadata pages into a description, Steam Workshop mods, and signing-key names. Direct string-valued Rules remain available under `rawData.rules`; binary page records are represented by their typed decoded values instead of lossy strings. Malformed or undocumented values remain raw instead of being guessed. DayZ's A2S Player response is intentionally `unsupported`: Info still supplies confirmed aggregate player counts, but the profile does not present anonymous or malformed Player records as identities. DayZ's official [server configuration](https://community.bohemia.net/wiki/DayZ:Server_Configuration) documents its separately configured game and Steam query ports, while the official [server-browser source](https://github.com/BohemiaInteractive/DayZ-Script-Diff/blob/main/scripts/5_mission/gui/newui/serverbrowsermenu/serverbrowsermenunew.c) keeps both destinations distinct.

**Source-engine games.** Counter-Strike 2, Counter-Strike: Source, Team Fortress 2, Left 4 Dead, Left 4 Dead 2, and Garry's Mod share one Source-engine profile. Each answers A2S on its game port, 27015 by default, so a custom `port` is also the query destination. Info supplies the normalized summary plus the game description, content folder, bots, VAC state, full App ID, advertised game port, server Steam ID, `sv_tags`, and any advertised SourceTV relay. Player and Rules are conditional because servers can hide them with cvars; Counter-Strike 2 commonly returns player records with empty names unless a server plugin restores them. Garry's Mod splits its space-separated keywords and types the gamemode, gamemode Workshop ID, category, location, and build. Team Fortress 2 derives its game modes, friendly fire, random crits, Highlander, and Medieval settings from the tags the game adds automatically.

**Steam query-port games.** ARK: Survival Evolved, Conan Exiles, Killing Floor 2, Day of Dragons, Soulmask, Sons of the Forest, Icarus, and Abiotic Factor answer A2S on a separately configured Steam query port. Their data has the same shape as the Source-engine games. Conan Exiles never answers A2S Player, so its Player source is reported as `unsupported` without network work. Soulmask advertises a placeholder `1.0.0.0` Info version; when Rules includes its `NO_s` build, `server.version` uses that instead. ARK also types its session Rules (full server name, PvE, BattlEye, official, cluster, game mode, day, download permissions, and Workshop mods) and takes `server.version` from the ` - (v358.7)` suffix ARK appends to its name, because its Info version is also a placeholder. The Unreal Engine 4 games (ARK, Conan Exiles, Day of Dragons, Soulmask, Icarus, Abiotic Factor, Insurgency: Sandstorm, and HumanitZ) also report the build ID, open public slots, and decoded session flags their Steam integration advertises; Conan Exiles adds its full server name and Abiotic Factor its join code and password lock. Killing Floor 2 types its match Rules: game mode, difficulty, current and total waves, whether a match is in progress, mutators, custom (unranked) status, and spectators.

**Steam port-layout games.** Arma 3, American Truck Simulator, Euro Truck Simulator 2, The Forest, Unturned, Enshrouded, and Insurgency: Sandstorm use the same Steam A2S data shape. Arma 3 also decodes its binary server-browser Rules into difficulty settings, required DLC, Creator DLC, Workshop mods, and accepted signatures, and its one-letter keywords into BattlEye, required version and build, session state, game type, lock, signature, platform, language, country, time-left, and island fields. Unturned types its server-browser flags (PvP, cheats, difficulty, camera, Workshop, Gold, BattlEye, monetization, thumbnail, transport, and plugin framework) and its chunked Rules (game version, full description, Workshop IDs, links, changed gameplay config, and RocketMod plugins). Insurgency: Sandstorm types its game mode, coop or versus, day or night lighting, ranked status, mutators, and mod.io mod IDs.

**Games that need queries enabled.** Arma Reforger, Starbound, Space Engineers, HumanitZ, and V Rising use the same Steam A2S data shape, but their servers answer only when a server setting enables queries. Arma Reforger needs the `a2s` block in its server config (`address` plus `port`, 17777 by default) and never provides player records, so its Player source is reported as `unsupported` without network work. Starbound needs `"runQueryServer": true` in `starbound_server.config`; its `queryServerPort` defaults to the game port, 21025. Space Engineers answers on its game port (`ServerPort`, 27016 by default). HumanitZ answers on the port its `-queryport` launch option sets, 27015 by default. V Rising registers with Steam only when `ListOnSteam` is `true` in `ServerHostSettings.json`, and then answers on `QueryPort`, 9877 by default.

**VEIN and Avorion** use the same Steam A2S data shape and answer without extra server configuration. VEIN queries `-QueryPort`, which defaults to the game port `+1` (7777 and 7778). Avorion queries its separately configured Steam query port, which stays at 27020 when the game port (27000 by default) changes; its separate 27003 port is Avorion's own server-listing protocol and is not used.

**Minecraft: Java Edition** performs optional SRV discovery followed by one required Server List Ping over TCP. It looks up `_minecraft._tcp.<host>` only when `host` is a DNS name and `port` is omitted; valid SRV targets are tried by ascending priority and RFC-weighted order, and no record falls back to the original host on port 25565. Supplying `port` or an IP literal bypasses SRV. When a pre-1.7 server closes or rejects the handshake, QueryHost retries once with the legacy ping and reports it as the `minecraft-legacy-ping` source; legacy responses have no favicon, and Beta 1.8 through 1.3 servers report no version or protocol, so those fields are omitted. In `full` mode it also attempts optional UDP Query enrichment for the map, software, plugins, and player names; `queryPort` changes only that UDP Query destination. Query failure preserves the successful SLP result as partial; `summary` mode skips Query explicitly.

**Minecraft: Bedrock Edition** first requests NetherNet status over HTTP at `/v1/join`, using port 19132 by default. If that source does not answer successfully, it falls back to a RakNet UDP ping on the same endpoint. Both summary and full mode support these transports, and `data.transport` identifies which answered. NetherNet can supply the name, world, version, player counts, protocol, and game mode; a capability-only response leaves unavailable metadata omitted. RakNet additionally supplies edition, server ID, and advertised ports. Advertised ports remain informational; QueryHost does not follow them. This supports direct HTTP NetherNet endpoints, without opening a WebRTC session or discovering Xbox/LAN worlds.

Either Minecraft edition reports a `crossplay` hint when the server advertises a Geyser bridge for the other edition's players, at no extra network cost.

**FiveM and RedM** use the shared Cfx FXServer HTTP endpoint family on port 30120 by default. In `full` mode, their fixed `info.json`, `dynamic.json`, and `players.json` endpoints run concurrently against one pinned address. Any usable endpoint can identify a live server; unavailable endpoints remain omitted and produce game-specific partial provenance. `summary` mode requests only `dynamic.json`. Redirects are never followed, and blocked `Nope` responses are reported as blocked rather than empty data.

**Satisfactory** uses the dedicated server's shared UDP/TCP game port, 7777 by default. Its lightweight UDP API is the required status source and returns the server name, lifecycle state, network changelist, modded flag, and substate revisions without authentication. Full mode additionally calls the authentication-free HTTPS `HealthCheck`; summary mode and the documented `loading` state skip HTTPS. Vanilla servers generate self-signed certificates by default, so this narrowly scoped request disables certificate identity validation while retaining TLS encryption and the validated pinned destination. QueryHost never attempts password login, requests an API token, or calls authenticated management functions.

**Vintage Story** uses its normal TCP game port, 42420 by default. Current stock servers acknowledge the direct status request without disclosing metadata, producing `data.response: "liveness"`; compatible servers may return the protocol's richer status answer with name, MOTD, player counts, mode, password state, and version. QueryHost connects only to the caller's validated, pinned target and does not consult the public server list or another central service.

**Eco** reads the dedicated server's unauthenticated `GET /frontpage` status page from its web server, TCP 3001 by default. `port` is the UDP game port (3000 by default) and the web port follows it at `+1`; set `queryPort` when `WebServerPort` is configured separately. The page supplies the normalized name (with Unity rich-text tags removed), version, password state, and online count, plus online player names and world facts such as the meteor countdown, laws, animals, and plants. Eco reports how many players have ever joined the world rather than a slot limit, so `server.players.max` is omitted and that count is `data.totalPlayers`. The name and long description exactly as served, tags included, are kept under `rawData`.

**Project Reclaimer**, the fan-made Halo 3 multiplayer client, answers its server browser over QUIC on the dedicated server's UDP game port, 49176 for the first server a `dedicated init` configuration defines. QueryHost sends the same length-framed `{"status":2}` request the in-game browser sends and returns the server name, map, version, password state, and player counts, plus the host name, game type, game and map variants, readiness, VPN blocking, ping limit, connected player names, listed mods with their maps, and Halo 3: ODST settings when the server reports them. Servers present a fresh self-signed certificate, so certificate identity validation is disabled; the TLS 1.3 handshake is still encrypted and authenticated against the key the server presented, and the connection goes only to the validated, pinned address. QueryHost does not read the public master servers' listings, which hold only signed addresses.

## Command line

The package installs a `queryhost` command. Pass a game ID or alias, a host, and an optional port; pass `auto` instead of a game to run `detect()`. It writes the complete parsed result as formatted JSON (or one line with `--compact`) to stdout and exits with 0 for success, 1 for a query failure, 2 for invalid command arguments (with usage on stderr), or 130 when interrupted. `--list-games` prints every game ID, name, and alias from the registry.

```bash
npx queryhost rust play.example.com 28015
queryhost auto play.example.com 28015
queryhost a2s play.example.com 27015
queryhost dayz play.example.com 2302 --mode full
queryhost dst play.example.com 10999 --query-port 27016
queryhost rust play.example.com 28015 --mode full --timeout 3000
queryhost rust play.example.com --query-port 28017 --mode summary
queryhost mc play.example.com 25565
queryhost mcbe play.example.com 19132
queryhost fivem play.example.com 30120
queryhost reclaimer play.example.com 49176
queryhost rust play.example.com 28015 --compact
queryhost --list-games
```

Run `queryhost --help` for the complete option list. The command uses the library's normal target policy, so private, loopback, link-local, reserved, and other non-public destinations remain blocked.

## Safety model

Queries use one global deadline, propagated cancellation, a shared 16-attempt outbound-work budget, and deterministic cleanup. Production DNS uses one resolver per query, cancels its native work with the query, and settles immediately when the caller aborts or the deadline expires. Untrusted targets pass through hostname and port validation, DNS/SRV answer caps, public-address policy, and immutable address pinning before a transport can connect. The same policy applies to SRV-derived targets.

## Development

Development uses npm 12 (see `packageManager`):

```bash
npm install
npm run verify
npm run query -- rust play.example.com 28015
```

`npm run verify` is the complete gate: formatting, release metadata, the build, generated API docs, type checking, linting, runtime and property tests with coverage, type tests, and the packed-package checks. [Internal architecture](docs/Internals.md) covers module ownership and invariants, and [AGENTS.md](AGENTS.md) the contribution rules.

## License

Apache-2.0
