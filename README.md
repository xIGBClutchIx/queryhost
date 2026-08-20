# QueryHost

Fast, typed game server queries for TypeScript.

QueryHost is being built as a modern game-server query engine with correct protocols, explicit source provenance, bounded network behavior, and game-specific TypeScript results.

## Status

The repository currently contains the strict package foundation and Slices 1–4:

- typed public result contracts and an exhaustive game registry
- global deadlines, operation budgets, cancellation, cleanup, and stable internal errors
- hostname and port validation, bounded DNS/SRV resolution, public-address policy, and immutable address pinning
- bounded UDP exchanges with peer validation, packet limits, cancellation, and deterministic socket cleanup

The public `query()` function and protocol implementations are not implemented yet. TCP and fixed HTTP transports arrive in later slices. The examples below document the contract that those later slices will fulfill.

## Public contract

Literal game IDs remain connected to their game-specific data types:

```ts
import type { QueryResult } from "queryhost";

declare const result: QueryResult<"rust">;

if (result.ok) {
  result.data; // RustData
}
```

`QueryResult` is a discriminated union. Check `ok` before reading `data` or `error`. A dynamic `GameId` can be narrowed with an exhaustive switch on `result.game`.

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

The codebase uses strict TypeScript across library code, tests, and project scripts. Explicit `any` and `unknown` types are forbidden by ESLint; boundary data must be validated into a concrete type before it enters the library.

## Package layout

```text
src/       Public contracts and internal library implementation
test/      Runtime tests
test-d/    Published TypeScript contract tests
scripts/   Package and consumer verification
docs/      Maintainer-facing technical documentation
```

Detailed module ownership, invariants, and extension rules live in [Internal architecture](docs/Internals.md).

## License

Apache-2.0
