# QueryHost internal architecture

This document explains how the current QueryHost library is divided and which invariants later transports, protocols, and game profiles must preserve. It is maintainer documentation, not a promise that internal modules are public package exports.

## Dependency direction

```text
index.ts
  -> runtime/client.ts public orchestration
  -> game profiles
  -> protocol implementations
  -> transports/udp.ts + transports/tcp.ts + transports/http.ts
  -> runtime/execution.ts + network/target.ts

network/target.ts
  -> network/ip.ts
```

Dependencies point downward. Networking code must not interpret game-specific rules, and shared protocol parsers must not branch on a game ID.

## Module ownership

- `index.ts` defines the package-root export boundary. Internal helpers are not public merely because TypeScript emits their files.
- `runtime/client.ts` validates public budgets, owns the global execution envelope, resolves and pins targets, dispatches through an exhaustive typed profile-runner registry, and produces stable success or failure envelopes. Adding an implemented game requires one registry entry rather than another orchestration branch.
- Input aliases are resolved once at the client boundary. Definition lookup accepts aliases, while registry storage, profile dispatch, result types, and runtime `game` fields use the canonical ID. Aliases are explicit and unambiguous; QueryHost does not infer fuzzy names.
- `cli/options.ts` validates command arguments without process side effects. `cli.ts` is the thin executable adapter that invokes the public client, prints the complete result, and maps usage and query outcomes to exit codes.
- `contracts/query.ts` connects literal game IDs to game-specific result types and defines success/failure discrimination.
- `contracts/games.ts` contains stable game-specific fields. It does not contain transport or parser state.
- `contracts/shared.ts` contains only concepts that are genuinely common across games, including provenance and stable errors.
- `contracts/registry.ts` is the exhaustive source of game metadata and capability support.
- `runtime/execution.ts` owns deadlines, cancellation propagation, the root outbound-attempt budget, cleanup, and internal-error redaction.
- `network/ip.ts` owns canonical IP parsing and the public-routability policy.
- `network/target.ts` owns hostname/port normalization, DNS boundaries, answer validation, pinning, and SRV-derived target safety.
- `transports/udp.ts` owns bounded single- and multi-datagram exchanges with no protocol interpretation.
- `transports/tcp.ts` owns bounded request/response streams against one pinned address. Protocol callbacks identify complete framing without moving parsing into the transport.
- `transports/http.ts` owns bounded, non-redirecting GET/POST requests to protocol-owned fixed paths over one pinned address while preserving the original Host and TLS SNI identity.
- `protocols/a2s/` owns bounds-checked binary primitives and protocol facts shared by A2S game profiles.
- `protocols/minecraft-java/` owns strict VarInts, status framing, JSON boundary validation, chat-component normalization, favicon validation, and SLP request/response handling.
- `protocols/minecraft-bedrock/` owns RakNet unconnected ping framing, echoed identifiers, strict UTF-8 decoding, and bounded advertisement parsing.
- `protocols/cfx/` owns the shared FXServer fixed endpoint paths, bounded JSON parsing, endpoint schemas, and explicit blocked/not-found response classification.
- `protocols/satisfactory/` owns Lightweight Query framing and the fixed HTTPS HealthCheck request and response schema.
- `protocols/vintage-story/` owns the direct TCP query packet, frame inspection, strict protobuf-compatible decoding, and stock-server liveness acknowledgement.
- `profiles/a2s.ts` owns game-neutral A2S source orchestration, address pinning, common server facts, provenance, and warnings.
- Each named module under `profiles/` owns only that game's interpretation and public data merge.

Tests mirror these ownership folders under `test/`. Shared fixtures, fake servers, and package-consumer checks remain in `test/fixtures`, `test/helpers`, and `test/package-smoke` rather than being duplicated beside each test.

## Result invariants

The `ok` property is the primary result discriminator. A successful result contains `server` and game-specific `data`; a failed result contains a stable `error`.

Missing values mean unavailable or unconfirmed. They must remain omitted. Empty collections and zero values are valid only when a source positively reports them.

Every attempted or skipped source produces provenance. Optional-source failure may produce a partial success, but required-source failure cannot masquerade as an offline or empty server.

## Execution invariants

One root execution scope owns the query deadline, caller signal, and a 16-attempt outbound-work budget. Child operation scopes inherit the same termination and attempt budget while clamping their own deadline to the parent. DNS lookups, transport exchanges, challenge retries, fallbacks, and optional sources all consume from that shared allowance before starting work.

Every resource acquired during a query must register cleanup immediately. Cleanup is idempotent from the scope's perspective, runs in reverse registration order, and continues if another cleanup callback throws.

Arbitrary exceptions and abort reasons are internal details. Code crossing into the public result contract must expose only a stable `QueryErrorCode` and stable message.

## Target-safety invariants

Target resolution is an SSRF and network-abuse boundary:

- Accept a hostname or IP literal, never a caller-provided URL, path, packet, or redirect target.
- Validate ports as integers from 1 through 65535.
- Accept at most four combined address answers and four SRV records before derived work grows.
- Use one Node resolver per public query. Pass the root signal into every lookup, cancel native resolver work on termination, and settle the lookup adapter immediately even if a platform promise is slow to reject.
- Reject the entire answer set when any address is unsafe or malformed.
- Treat IPv4-mapped IPv6, scoped IPv6, documentation, benchmark, multicast, private, link-local, loopback, and reserved space as blocked.
- Use the returned pinned address set for connection; never resolve the hostname again inside a transport.
- Preserve the normalized hostname only for protocol identity such as Host headers or SNI.
- Apply the same validation to every SRV-derived hostname and port.

IPv6 uses an allocation allowlist because unallocated gaps inside `2000::/3` remain reserved. The tables in `network/ip.ts` record their human-readable prefixes and allocation purpose; update them only after reviewing IANA's [IPv4 special-purpose registry](https://www.iana.org/assignments/iana-ipv4-special-registry), [IPv6 special-purpose registry](https://www.iana.org/assignments/iana-ipv6-special-registry), and [IPv6 global-unicast allocations](https://www.iana.org/assignments/ipv6-unicast-address-assignments), then extend the policy tests.

## UDP transport invariants

One UDP exchange selects an address already present in a pinned target and creates a fresh family-matched socket. It sends one non-empty datagram and accepts only non-empty, non-truncated responses from the selected address and port. A single-response exchange stops after the first accepted datagram. A collection exchange additionally requires protocol-supplied datagram-count, per-datagram, aggregate-byte, and completion bounds.

Datagrams from every other peer are ignored before their contents or size are considered. Request and response sizes cannot exceed the UDP payload ceiling, and each protocol supplies a tighter response limit. The execution scope terminates the exchange on its deadline or caller cancellation; success, failure, timeout, and cancellation all close the socket exactly once.

The transport returns copied bytes, round-trip duration, and destination facts. A collection completion callback may inspect framing, but the transport does not parse headers itself, retry protocol exchanges, select another pinned address, or interpret game data.

## A2S protocol invariants

The A2S exchange accepts direct datagrams no larger than 4,096 bytes and split fragments no larger than 1,400 bytes; reconstructed responses remain capped at 65,536 bytes. The larger direct bound is required by real 7 Days to Die Rules responses while split packets retain their tighter Source-protocol limit. The Info parser distinguishes the modern Source and legacy GoldSource layouts, validates enumerated and boolean fields, requires valid null-terminated UTF-8 strings, and consumes every byte described by the response and its EDF flags.

The protocol layer may perform one challenge retry under the same execution scope. A second challenge fails deterministically. Split reconstruction accepts at most 15 unique fragments and 30 total datagrams, keys fragments by response ID, reorders them, ignores exact duplicates, and rejects conflicting duplicates or metadata. Both Source header variants and the packed GoldSource layout are supported.

Compressed Source replies are retained only up to 16,384 compressed bytes. Their declared output size must fit the 65,536-byte response ceiling before bzip2 runs, and the decoded byte count and CRC32 must match the first fragment's metadata. These checks prevent fragment floods, oversized reconstruction, and decompression bombs from turning protocol input into unbounded work. Parsed values remain protocol facts; Rust and other game-specific interpretation belongs in later profiles.

A2S Player and Rules share the same bounded exchange and split reconstruction path. Each sends the protocol's initial challenge value, echoes at most one server-provided signed token, and rejects a second challenge. Player records require unique indexes, bounded valid UTF-8 names, finite non-negative durations, and exact packet consumption. Rules require bounded valid UTF-8 names and values, non-empty unique names, a fixed count ceiling, and exact packet consumption. Special JavaScript property names are installed as data properties so server-controlled rule keys cannot alter the rule map's prototype.

After a required source succeeds, requested independent optional sources receive separate child operation scopes and start concurrently. Their reports remain in deterministic profile order regardless of completion order. Confirmed empty Player or Rules responses are preserved as empty values; failed values are omitted. Timeout, malformed data, policy blocking, unsupported capability, deliberate omission, and other transport failure remain distinct provenance states and do not reject optional enrichment. Root timeout or caller cancellation still terminates the whole operation rather than being reduced to an optional-source report.

## Shared A2S profile invariants

Generic A2S, Rust, Palworld, Project Zomboid, 7 Days to Die, and DayZ use the same game-neutral orchestration. A2S Info is required. The shared profile tries only addresses from the validated target in resolver order; once Info succeeds, optional Player and Rules work uses that same address so one result never merges different server instances. Info supplies the common name, map, version, password state, player counts, and primary query RTT.

Full mode applies each profile's declared Player and Rules policy concurrently. A supported source is queried; an unavailable capability is reported as `unsupported` without opening a socket. Summary mode records both as `not-requested`. Optional failure omits only its value, preserves its source report, adds stable warnings, and marks the successful result partial. Confirmed empty Player and Rules responses remain empty collections. The shared module has no game IDs, rule names, or game-specific result fields.

The public query deadline defaults to 5,000 ms and accepts values through 30,000 ms. Required Info attempts receive 2,000 ms per pinned address, optional sources receive 1,500 ms each, and every child remains capped by the root deadline.

## Game-specific A2S merges

- Generic A2S exposes portable Info facts, Player records, and untouched Rules without guessing at game-specific rule names. It requires `port` as the actual A2S query destination because there is no reliable universal default.
- Rust converts Info keywords into ordered tags and Player records into `RustPlayer` values. Rules remain unchanged. Its registry ports are game 28015 and query 28017; custom game ports preserve that offset unless `queryPort` is explicit.
- Palworld converts Info keywords into ordered tags and conditionally returned Player records into `PalworldPlayer` values. Rules remain unchanged. Its gameplay listener conventionally uses UDP 8211 while Steam A2S uses fixed UDP 27015; a custom game port does not shift that query default, and `queryPort` remains the explicit override. The public A2S profile deliberately excludes Pocketpair's Basic-Auth REST API, which is a separate LAN administration surface with richer player and settings fields.
- Project Zomboid converts Player records and interprets lowercase `description`, numeric `pvp`, `version`, and semicolon-delimited `mods`. The Rules version overrides A2S Info's generic version when available. Its default A2S destination is UDP 16261.
- 7 Days to Die converts Player records and interprets `ServerDescription`, `GameName`, `LevelName`, `GameMode`, `CurrentServerTime`, and `ServerWebsiteURL`. Its default A2S destination is UDP 26900. Other rule names remain available unchanged.
- DayZ splits A2S Info keywords without assigning undocumented meanings, interprets only validated direct Rules values (`island`, `platform`, `dedicated`, port, build, version, time-left, and language fields), and preserves every direct string rule unchanged. Its profile injects a DayZ-owned Rules decoder into the shared challenge flow. That decoder accepts at most 32 consistently numbered metadata pages, reverses only the protocol's three escape sequences under the 65,536-byte response ceiling, requires DayZ metadata version 2, and bounds-checks every mod, Workshop ID, name, signature, and description before exposing typed metadata. Binary page records are excluded from `rawData.rules` because they are not strings. A2S Player is declared `unsupported`, so aggregate Info counts remain available without exposing anonymous or malformed records as a player list. The registry's game port 2302 and Steam query port 2305 preserve the conventional `+3` offset for custom game ports unless `queryPort` is explicit. Server-advertised `clientPort` is informational and never redirects work outside the validated pinned target.

Each game owns independent successful-source fixtures and tests for its merge semantics and port convention. Shared profile tests own common timeout, malformed-response, target-policy, summary-mode, and provenance behavior so those cases are not repeated for every game. A shared parser or orchestration module must never branch on one of these game IDs.

Successful A2S profiles keep normalized values in `server` and `data`. The untouched Rules map is exposed separately as `rawData.rules`, preventing protocol strings such as `pvp: "1"` from appearing alongside their typed interpretations. `rawData` is omitted when Rules was skipped or unavailable and retained with an empty `rules` object when the server confirmed zero rules.

## TCP transport invariants

One TCP exchange connects directly to an address already present in a pinned target and never resolves the hostname again. It sends one bounded request, retains at most 1 MiB, and gives immutable accumulated bytes to a synchronous protocol framing callback. The callback can report incomplete, complete, malformed, or too large without asking the transport to interpret the protocol.

Connection failure, write failure, early EOF, malformed framing, byte-limit exhaustion, timeout, and caller cancellation settle once and destroy the socket once. Successful completion measures the entire connect/request/response round trip. Protocol-specific operation scopes remain capped by the root query deadline.

## Fixed HTTP transport invariants

One fixed HTTP exchange connects directly to an address already present in a pinned target. The original normalized hostname is retained only for the HTTP `Host` header and, for HTTPS DNS names, TLS SNI. Protocols provide a fixed path consisting only of safe path segments; caller URLs, authorities, query strings, fragments, and redirect destinations are not accepted.

The transport uses a non-redirecting platform request and returns every valid HTTP status to the protocol. It asks for identity encoding, caps both declared and streamed response size at the protocol's limit, rejects mismatched content lengths, and destroys the response and request exactly once on success, failure, timeout, or cancellation. A protocol receives copied bytes, status, RTT, and pinned destination facts; it remains responsible for status and body interpretation.

## Cfx HTTP profile invariants

FiveM and RedM resolve and pin the caller's host on TCP port 30120 by default. Cfx's official setup guide configures the same FXServer binary for RedM with `gamename rdr3` and binds its TCP and UDP endpoints to 30120. The shared FXServer HTTP handler owns `info.json`, `dynamic.json`, and `players.json`; the server-command documentation also defines their common `sv_requestParanoia` blocking behavior. The protocol and orchestration modules therefore contain no game-ID branches: thin profile definitions provide only the caller-facing game name and distinct source identities.

Full mode starts all three endpoints concurrently with separate child budgets against the same selected address. If none succeeds, the complete three-source set may be retried on the next pinned address; once any endpoint succeeds, failed endpoints are not retried elsewhere, preventing one result from merging different server instances. Summary mode requests only `dynamic.json` and records the other sources as `not-requested`.

JSON bodies have endpoint byte limits plus depth, node, collection, key, and string limits. `info.json` supplies the server software identity, resources, server-info variables, OneSync state, and enhanced-host flag. `dynamic.json` supplies the normalized name, map, game type, and player counts. `players.json` supplies bounded public player IDs, names, and pings. Unknown fields are ignored only after the complete document satisfies the shared structural budget.

HTTP 404 is `unsupported`, transport and other HTTP failures retain their specific source status, and both `Nope` and the server's current `Nope.` body are explicit `blocked` outcomes. A confirmed empty resources, variables, or players collection remains empty; a failed or blocked endpoint omits its fields. Any usable endpoint produces a successful result, with warnings and `partial: true` when another requested endpoint failed. If every requested endpoint fails, the query fails after all source reports are preserved.

Primary references: [Cfx vanilla FXServer setup](https://docs.fivem.net/docs/server-manual/setting-up-a-server-vanilla/), [Cfx server commands](https://docs.fivem.net/docs/server-manual/server-commands/), and the [FXServer HTTP handler](https://github.com/citizenfx/fivem/blob/master/code/components/citizen-server-impl/src/InfoHttpHandler.cpp).

## Vintage Story query invariants

Vintage Story sends the protocol's fixed eight-byte empty `ServerQuery` request directly to TCP 42420 by default, or to the caller's validated `port`/`queryPort`. The game and query port are the same. Every address attempt uses only the immutable addresses returned by target validation; the profile does not consult the master server, follow response-directed destinations, or accept a caller-provided URL.

Responses use the game's four-byte big-endian frame length. Compressed frames, trailing bytes, non-canonical varints, duplicate known fields, invalid UTF-8, impossible player counts, and responses above 8,192 bytes fail deterministically. Unknown protobuf-compatible fields are skipped only within the validated frame and bounded wire representation.

Current stock 1.22 servers return the exact protocol acknowledgement `Query complete` to an unauthenticated direct query. That response confirms protocol liveness but no metadata, so the public result sets `data.response` to `liveness` and leaves name, version, player counts, mode, MOTD, and password state omitted. Servers that implement the official `ServerQueryAnswer` schema produce `data.response: "status"`; only fields present in that answer are normalized. These behaviors were verified against the official 1.22.7 server archive and the official server configuration documentation, which specifies TCP and UDP port 42420.

## Minecraft Java SLP invariants

With no explicit game port, a DNS hostname first attempts `_minecraft._tcp` discovery. At most four SRV records and four addresses per derived hostname are accepted; all are validated and pinned, grouped by ascending priority, then placed in RFC 2782 weighted order using an injectable random source. Their DNS work and every later connection share the root attempt budget, so the record and address caps cannot multiply into an unbounded fallback set. An absent SRV answer falls back to the original hostname on port 25565. An explicit game port or IP literal bypasses SRV; an explicit `queryPort` affects only optional UDP Query.

SLP tries each ordered target and its validated addresses until the required source succeeds. The handshake uses the selected SRV hostname and port when discovery succeeds, and `data.srv` records the target that actually answered rather than the first DNS record.

VarInts are canonical signed 32-bit encodings limited to five bytes. Framed responses, JSON bytes, JSON characters, chat-component depth, node count, and normalized MOTD output all have explicit limits. Status documents require a version name, numeric protocol, non-negative player counts, and a supported description component. Invalid UTF-8, trailing packet bytes, malformed JSON, and invalid field types fail deterministically.

MOTD plain text strips legacy formatting. HTML is produced only from escaped text and fixed color/style declarations, so server text cannot inject markup or attributes. Favicon values must be bounded PNG data URLs with a 64-by-64 IHDR; malformed, incorrectly sized, or excessive icons are rejected. The normalized result exposes version and player counts under `server`, with MOTD, protocol version, and favicon under `data`.

## Minecraft Query invariants

Full mode attempts one optional UDP Query source after SLP. The challenge request and full-stat request share one bounded UDP socket because the challenge belongs to the client's endpoint. Session IDs, challenge tokens, packet types, full-stat markers, field counts, string sizes, plugin counts, player counts, response bytes, and exact packet endings are validated before merge. The parser also understands bounded basic-stat responses without fabricating full-stat player or plugin lists.

SLP remains authoritative for the primary version, player counts, MOTD, and query RTT. Query can add the normalized map plus Minecraft-specific software, plugins, and player names. Missing Query fields remain omitted, while confirmed empty plugin or player lists remain empty arrays. Summary mode reports Query as `not-requested`; timeout, malformed data, or transport failure keeps `ok: true`, marks the result partial, and emits source-specific warnings.

## Minecraft Bedrock RakNet invariants

The Bedrock profile sends one 33-byte unconnected ping to UDP 19132 by default, or the caller's validated `port`/`queryPort`. Each address attempt uses a fresh bounded UDP exchange. Only a pong from the selected pinned address and destination port can be accepted; advertised ports never redirect the active query or bypass target validation.

The pong must echo the request timestamp and contain the exact RakNet offline-message magic, an unsigned server GUID, and an exact 16-bit payload length. Responses are limited to 2,048 bytes. Advertisement text must be valid UTF-8 and is split into at most 32 semicolon fields of at most 1,024 bytes each. `MCPE` and `MCEE` are the only accepted edition headers. Missing later fields remain omitted, bounded extra fields are ignored, and every present numeric field must use a canonical non-negative decimal representation within its field-specific range.

The primary MOTD becomes `server.name` and `data.motd`; version and player counts are normalized under `server`. Edition, numeric protocol, game mode, decimal server ID, and advertised IPv4/IPv6 ports remain under `MinecraftBedrockData`. Advertised ports are informational because following untrusted response-directed destinations would cross the validated target boundary. RakNet is the profile's single required source, so timeout, malformed data, or transport failure returns a failed query rather than partial success.

## Satisfactory Dedicated Server invariants

Satisfactory resolves and pins one public destination on port 7777 by default. The required source is the version-1 Lightweight Query API over UDP. Poll cookies are random unsigned 64-bit correlation values; responses must echo the cookie and match the fixed magic, message type, version, terminator, exact packet length, bounded UTF-8 server name, known lifecycle state, and bounded substate collection. The parser retains the unsigned flag word as a decimal string, interprets only the documented modded bit, and discards future unknown substate IDs as required by the shipped protocol documentation.

Full mode optionally sends the fixed `HealthCheck` JSON request to HTTPS `/api/v1` on the same pinned address that answered UDP. It never performs `PasswordlessLogin`, accepts a password or token, or invokes authenticated state and management functions. When lightweight status is `loading`, HTTPS is documented unavailable and remains `not-requested`; summary mode also skips it. Health failures preserve the required UDP result as partial with source-specific warnings.

The server always uses TLS and generates a self-signed certificate when the operator does not install one. Because QueryHost has no interactive certificate-trust store, the Satisfactory health request explicitly disables certificate identity validation. TLS still encrypts the exchange, and direct connection to the already validated pinned address prevents DNS rebinding, but callers must not treat the health response as cryptographic server authentication. The transport exposes this as an explicit game-neutral certificate policy and otherwise retains fixed-path, no-redirect, deadline, body-size, and cleanup rules.

Source: Coffee Stain's `CommunityResources/DedicatedServerAPIDocs.md`, mirrored by the Official Satisfactory Wiki's [Lightweight Query API](https://satisfactory.wiki.gg/wiki/Dedicated_servers/Lightweight_Query_API) and [HTTPS API](https://satisfactory.wiki.gg/wiki/Dedicated_servers/HTTPS_API) pages. The shipped document defines the same-port UDP and HTTPS protocols, port 7777 default, TLS/self-signed behavior, API availability, packet layout, and authentication requirements.

## Factorio support boundary

Factorio is intentionally not registered as an implemented game. As of September 2026, Wube's published interfaces do not define an unauthenticated, read-only status exchange against a dedicated server:

- The [official multiplayer documentation](https://wiki.factorio.com/Multiplayer) identifies UDP 34197 as the default gameplay port and `_factorio._udp` as optional DNS SRV discovery. These are connection-routing facts; the documentation does not define a status request or response packet.
- Wube's [server settings](https://github.com/wube/factorio-data/blob/master/server-settings.example.json) publish public games to the official matching server and require Factorio credentials for that visibility. Hidden and LAN-only servers therefore cannot be covered by the public listing.
- The [official Matchmaking API documentation](https://wiki.factorio.com/Matchmaking_API) requires a username and token to list games. Its unauthenticated detail endpoint accepts a matching-service `game_id` obtained from that listing, so the returned name, version, player, mod, and heartbeat fields are central-service metadata rather than a direct exchange with the caller's target.
- The dedicated-server command line exposes a separately configured [RCON port and password](https://wiki.factorio.com/Command_line_parameters). RCON is an authenticated administration surface, not a public server-status protocol, and neither its port nor its credentials can be inferred from the gameplay address.

QueryHost must not treat UDP silence as reachability, reverse-engineer a gameplay connection handshake into a status protocol, send administrative RCON credentials through the public query contract, or substitute matching-service data for a live query of the requested server. Those approaches would respectively fabricate data, rely on an unstable private wire contract, expand the trust boundary, or exclude valid hidden and LAN-only servers while claiming direct support.

Factorio can become a registered profile if Wube publishes a stable direct status exchange, or if QueryHost deliberately adds a separately scoped authenticated-management contract. Until then there is no `FactorioData`, registry entry, profile dispatch, CLI ID, fixture, or generated API surface to keep synchronized.

## Command-line invariants

The packaged `queryhost` binary and repository `npm run query --` script share the same entry point. The command accepts only a canonical or documented aliased game ID, host, optional port, and bounded library options; it does not expose protocol packets or bypass target validation. It prints the full public `QueryResult` as JSON, uses standard output for results and help, and reserves standard error for invalid invocation or an unexpected command-level failure. Ctrl+C aborts the active library query so the normal cleanup path closes network resources.

## Adding implementation code

New transports should accept an execution scope and a pinned target, impose explicit byte/count limits, validate the responding peer, and close their resources through the scope. They should return transport facts rather than game-specific meaning.

New parsers should consume bounded bytes, reject malformed or excessive structures deterministically, and contain no network access. Protocol fixtures and malformed-input cases belong in the same slice as the parser.

New game profiles should declare required and optional sources, define merge precedence, preserve provenance, and add their contract to `GameDataMap` and `GAME_REGISTRY` together.

## Verification

Run the complete gate before committing:

```bash
npm run verify
```

The gate checks formatting, generated API documentation, production declarations, strict type safety, lint rules, runtime and bounded property tests, published type tests, reviewed runtime dependency licenses, packed-package size and contents, the public export boundary, and clean JavaScript and TypeScript consumers.
