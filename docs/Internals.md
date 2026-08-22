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
- `transports/http.ts` owns bounded, non-redirecting GET requests to protocol-owned fixed paths over one pinned address while preserving the original Host and TLS SNI identity.
- `protocols/a2s/` owns bounds-checked binary primitives and protocol facts shared by A2S game profiles.
- `protocols/minecraft-java/` owns strict VarInts, status framing, JSON boundary validation, chat-component normalization, favicon validation, and SLP request/response handling.
- `protocols/minecraft-bedrock/` owns RakNet unconnected ping framing, echoed identifiers, strict UTF-8 decoding, and bounded advertisement parsing.
- `protocols/fivem/` owns fixed endpoint paths, bounded JSON parsing, endpoint schemas, and explicit blocked/not-found response classification.
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

Rust, Project Zomboid, and 7 Days to Die use the same game-neutral orchestration. A2S Info is required. The shared profile tries only addresses from the validated target in resolver order; once Info succeeds, Player and Rules use that same address so one result never merges different server instances. Info supplies the common name, map, version, password state, player counts, and primary query RTT.

Full mode requests Player and Rules concurrently. Summary mode records both as `not-requested` without opening optional sockets. Optional failure omits only its value, preserves its source report, adds stable warnings, and marks the successful result partial. Confirmed empty Player and Rules responses remain empty collections. The shared module has no game IDs, rule names, or game-specific result fields.

The public query deadline defaults to 5,000 ms and accepts values through 30,000 ms. Required Info attempts receive 2,000 ms per pinned address, optional sources receive 1,500 ms each, and every child remains capped by the root deadline.

## Game-specific A2S merges

- Rust converts Info keywords into ordered tags and Player records into `RustPlayer` values. Rules remain unchanged. Its registry ports are game 28015 and query 28017; custom game ports preserve that offset unless `queryPort` is explicit.
- Project Zomboid converts Player records and interprets lowercase `description`, numeric `pvp`, `version`, and semicolon-delimited `mods`. The Rules version overrides A2S Info's generic version when available. Its default A2S destination is UDP 16261.
- 7 Days to Die converts Player records and interprets `ServerDescription`, `GameName`, `LevelName`, `GameMode`, `CurrentServerTime`, and `ServerWebsiteURL`. Its default A2S destination is UDP 26900. Other rule names remain available unchanged.

Each game owns independent successful-source fixtures and tests for its merge semantics and port convention. Shared profile tests own common timeout, malformed-response, target-policy, summary-mode, and provenance behavior so those cases are not repeated for every game. A shared parser or orchestration module must never branch on one of these game IDs.

Successful A2S profiles keep normalized values in `server` and `data`. The untouched Rules map is exposed separately as `rawData.rules`, preventing protocol strings such as `pvp: "1"` from appearing alongside their typed interpretations. `rawData` is omitted when Rules was skipped or unavailable and retained with an empty `rules` object when the server confirmed zero rules.

## TCP transport invariants

One TCP exchange connects directly to an address already present in a pinned target and never resolves the hostname again. It sends one bounded request, retains at most 1 MiB, and gives immutable accumulated bytes to a synchronous protocol framing callback. The callback can report incomplete, complete, malformed, or too large without asking the transport to interpret the protocol.

Connection failure, write failure, early EOF, malformed framing, byte-limit exhaustion, timeout, and caller cancellation settle once and destroy the socket once. Successful completion measures the entire connect/request/response round trip. Protocol-specific operation scopes remain capped by the root query deadline.

## Fixed HTTP transport invariants

One fixed HTTP exchange connects directly to an address already present in a pinned target. The original normalized hostname is retained only for the HTTP `Host` header and, for HTTPS DNS names, TLS SNI. Protocols provide a fixed path consisting of one safe path segment; caller URLs, authorities, query strings, fragments, and redirect destinations are not accepted.

The transport uses a non-redirecting platform request and returns every valid HTTP status to the protocol. It asks for identity encoding, caps both declared and streamed response size at the protocol's limit, rejects mismatched content lengths, and destroys the response and request exactly once on success, failure, timeout, or cancellation. A protocol receives copied bytes, status, RTT, and pinned destination facts; it remains responsible for status and body interpretation.

## FiveM HTTP profile invariants

FiveM resolves and pins the caller's host on TCP port 30120 by default. Full mode starts `info.json`, `dynamic.json`, and `players.json` concurrently with separate child budgets against the same selected address. If none succeeds, the complete three-source set may be retried on the next pinned address; once any endpoint succeeds, failed endpoints are not retried elsewhere, preventing one result from merging different server instances. Summary mode requests only `dynamic.json` and records the other sources as `not-requested`.

JSON bodies have endpoint byte limits plus depth, node, collection, key, and string limits. `info.json` supplies the server software identity, resources, server-info variables, OneSync state, and enhanced-host flag. `dynamic.json` supplies the normalized name, map, game type, and player counts. `players.json` supplies bounded public player IDs, names, and pings. Unknown fields are ignored only after the complete document satisfies the shared structural budget.

HTTP 404 is `unsupported`, transport and other HTTP failures retain their specific source status, and both `Nope` and the server's current `Nope.` body are explicit `blocked` outcomes. A confirmed empty resources, variables, or players collection remains empty; a failed or blocked endpoint omits its fields. Any usable endpoint produces a successful result, with warnings and `partial: true` when another requested endpoint failed. If every requested endpoint fails, the query fails after all source reports are preserved.

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
