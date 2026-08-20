# QueryHost

Fast, typed game server queries for TypeScript.

QueryHost is being built as a modern game-server query engine with correct protocols, explicit source provenance, bounded network behavior, and game-specific TypeScript results.

## Status

This repository currently contains the Slice 1 public contract and game registry. Network transports and protocol implementations arrive in later slices.

## Public contract

Literal game IDs remain connected to their game-specific data types:

```ts
import type { QueryResult } from "queryhost";

declare const result: QueryResult<"rust">;

if (result.ok) {
  result.data; // RustData
}
```

Registry metadata is available from the same package so applications, the hosted API, and documentation can share one source of truth:

```ts
import { GAME_REGISTRY, isGameId } from "queryhost";

GAME_REGISTRY["minecraft-java"].defaultPort; // 25565
isGameId("rust"); // true
```

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
src/       Public library source
test/      Runtime tests
test-d/    Published TypeScript contract tests
scripts/   Package and consumer verification
```

## License

Apache-2.0
