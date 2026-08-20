# QueryHost internal architecture

This document explains how the current QueryHost library is divided and which invariants later transports, protocols, and game profiles must preserve. It is maintainer documentation, not a promise that internal modules are public package exports.

## Dependency direction

```text
index.ts
  -> public query, game, registry, and shared contracts

future query implementation
  -> game profiles
  -> protocol implementations
  -> transports/udp.ts + future TCP and fixed HTTP adapters
  -> execution.ts + target.ts

target.ts
  -> ip.ts
```

Dependencies point downward. Networking code must not interpret game-specific rules, and shared protocol parsers must not branch on a game ID.

## Module ownership

- `index.ts` defines the package-root export boundary. Internal helpers are not public merely because TypeScript emits their files.
- `query.ts` connects literal game IDs to game-specific result types and defines success/failure discrimination.
- `games.ts` contains stable game-specific fields. It does not contain transport or parser state.
- `shared.ts` contains only concepts that are genuinely common across games, including provenance and stable errors.
- `registry.ts` is the exhaustive source of game metadata and capability support.
- `execution.ts` owns deadlines, cancellation propagation, cleanup, and internal-error redaction.
- `ip.ts` owns canonical IP parsing and the public-routability policy.
- `target.ts` owns hostname/port normalization, DNS boundaries, answer validation, pinning, and SRV-derived target safety.
- `transports/udp.ts` owns one bounded request/response exchange with no protocol interpretation.
- `protocols/a2s/` owns bounds-checked binary primitives and protocol facts shared by A2S game profiles.

## Result invariants

The `ok` property is the primary result discriminator. A successful result contains `server` and game-specific `data`; a failed result contains a stable `error`.

Missing values mean unavailable or unconfirmed. They must remain omitted. Empty collections and zero values are valid only when a source positively reports them.

Every attempted or skipped source produces provenance. Optional-source failure may produce a partial success, but required-source failure cannot masquerade as an offline or empty server.

## Execution invariants

One root execution scope owns the query deadline and caller signal. Child operation scopes inherit that termination and clamp their own deadline to the parent.

Every resource acquired during a query must register cleanup immediately. Cleanup is idempotent from the scope's perspective, runs in reverse registration order, and continues if another cleanup callback throws.

Arbitrary exceptions and abort reasons are internal details. Code crossing into the public result contract must expose only a stable `QueryErrorCode` and stable message.

## Target-safety invariants

Target resolution is an SSRF and network-abuse boundary:

- Accept a hostname or IP literal, never a caller-provided URL, path, packet, or redirect target.
- Validate ports as integers from 1 through 65535.
- Bound DNS and SRV answer counts before derived work grows.
- Reject the entire answer set when any address is unsafe or malformed.
- Treat IPv4-mapped IPv6, scoped IPv6, documentation, benchmark, multicast, private, link-local, loopback, and reserved space as blocked.
- Use the returned pinned address set for connection; never resolve the hostname again inside a transport.
- Preserve the normalized hostname only for protocol identity such as Host headers or SNI.
- Apply the same validation to every SRV-derived hostname and port.

IPv6 uses an allocation allowlist because unallocated gaps inside `2000::/3` remain reserved. The tables in `ip.ts` record their human-readable prefixes and allocation purpose; update them only after reviewing IANA's [IPv4 special-purpose registry](https://www.iana.org/assignments/iana-ipv4-special-registry), [IPv6 special-purpose registry](https://www.iana.org/assignments/iana-ipv6-special-registry), and [IPv6 global-unicast allocations](https://www.iana.org/assignments/ipv6-unicast-address-assignments), then extend the policy tests.

## UDP transport invariants

One UDP exchange selects an address already present in a pinned target and creates a fresh family-matched socket. It sends one non-empty datagram and accepts only the first non-empty, non-truncated response from the selected address and port.

Datagrams from every other peer are ignored before their contents or size are considered. Request and response sizes cannot exceed the UDP payload ceiling, and each protocol supplies a tighter response limit. The execution scope terminates the exchange on its deadline or caller cancellation; success, failure, timeout, and cancellation all close the socket exactly once.

The transport returns copied bytes, round-trip duration, and destination facts. It does not parse headers, retry protocol exchanges, select another pinned address, or interpret game data.

## A2S Info invariants

The A2S Info parser accepts one packet no larger than 1,400 bytes. It distinguishes the modern Source and legacy GoldSource layouts, validates enumerated and boolean fields, requires valid null-terminated UTF-8 strings, and consumes every byte described by the response and its EDF flags.

The protocol layer may perform one challenge retry under the same execution scope. A second challenge fails deterministically. Split-packet headers are identified explicitly but reconstruction remains owned by Slice 6. Parsed values remain protocol facts; Rust and other game-specific interpretation belongs in later profiles.

## Adding implementation code

New transports should accept an execution scope and a pinned target, impose explicit byte/count limits, validate the responding peer, and close their resources through the scope. They should return transport facts rather than game-specific meaning.

New parsers should consume bounded bytes, reject malformed or excessive structures deterministically, and contain no network access. Protocol fixtures and malformed-input cases belong in the same slice as the parser.

New game profiles should declare required and optional sources, define merge precedence, preserve provenance, and add their contract to `GameDataMap` and `GAME_REGISTRY` together.

## Verification

Run the complete gate before committing:

```bash
npm run verify
```

The gate checks formatting, production declarations, strict type safety, lint rules, runtime tests, published type tests, packed-package consumption, package metadata, and ESM compatibility.
