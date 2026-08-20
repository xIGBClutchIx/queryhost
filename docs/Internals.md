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
- `transports/udp.ts` owns bounded single- and multi-datagram exchanges with no protocol interpretation.
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

One UDP exchange selects an address already present in a pinned target and creates a fresh family-matched socket. It sends one non-empty datagram and accepts only non-empty, non-truncated responses from the selected address and port. A single-response exchange stops after the first accepted datagram. A collection exchange additionally requires protocol-supplied datagram-count, per-datagram, aggregate-byte, and completion bounds.

Datagrams from every other peer are ignored before their contents or size are considered. Request and response sizes cannot exceed the UDP payload ceiling, and each protocol supplies a tighter response limit. The execution scope terminates the exchange on its deadline or caller cancellation; success, failure, timeout, and cancellation all close the socket exactly once.

The transport returns copied bytes, round-trip duration, and destination facts. A collection completion callback may inspect framing, but the transport does not parse headers itself, retry protocol exchanges, select another pinned address, or interpret game data.

## A2S protocol invariants

The A2S Info parser accepts direct packets no larger than 1,400 bytes and reconstructed responses no larger than 65,536 bytes. It distinguishes the modern Source and legacy GoldSource layouts, validates enumerated and boolean fields, requires valid null-terminated UTF-8 strings, and consumes every byte described by the response and its EDF flags.

The protocol layer may perform one challenge retry under the same execution scope. A second challenge fails deterministically. Split reconstruction accepts at most 15 unique fragments and 30 total datagrams, keys fragments by response ID, reorders them, ignores exact duplicates, and rejects conflicting duplicates or metadata. Both Source header variants and the packed GoldSource layout are supported.

Compressed Source replies are retained only up to 16,384 compressed bytes. Their declared output size must fit the 65,536-byte response ceiling before bzip2 runs, and the decoded byte count and CRC32 must match the first fragment's metadata. These checks prevent fragment floods, oversized reconstruction, and decompression bombs from turning protocol input into unbounded work. Parsed values remain protocol facts; Rust and other game-specific interpretation belongs in later profiles.

A2S Player and Rules share the same bounded exchange and split reconstruction path. Each sends the protocol's initial challenge value, echoes at most one server-provided signed token, and rejects a second challenge. Player records require unique indexes, bounded valid UTF-8 names, finite non-negative durations, and exact packet consumption. Rules require bounded valid UTF-8 names and values, non-empty unique names, a fixed count ceiling, and exact packet consumption. Special JavaScript property names are installed as data properties so server-controlled rule keys cannot alter the rule map's prototype.

After a required source succeeds, requested independent optional sources receive separate child operation scopes and start concurrently. Their reports remain in deterministic profile order regardless of completion order. Confirmed empty Player or Rules responses are preserved as empty values; failed values are omitted. Timeout, malformed data, policy blocking, unsupported capability, deliberate omission, and other transport failure remain distinct provenance states and do not reject optional enrichment. Root timeout or caller cancellation still terminates the whole operation rather than being reduced to an optional-source report.

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
