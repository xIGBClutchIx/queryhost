# Working in QueryHost

This repository contains the TypeScript query library. The hosted API and website are separate projects and must consume the library through its public contract.

## Scope

- Implement the current slice completely before expanding the product surface.
- Do not add hosted-service concerns such as accounts, billing, persistent caching, or deployment code here.
- Do not add Cloudflare or Railway dependencies. The library performs live queries and stays portable across Node.js hosts.
- Do not preserve obsolete APIs, compatibility shims, or legacy libraries.
- Keep package-root exports intentional. A module under `src/` is not public unless `src/index.ts` exports it.

## Code rules

- Keep TypeScript strict in source, tests, type tests, and scripts.
- Do not use explicit `any` or `unknown`. Validate external data at the boundary and return a concrete type.
- Preserve the distinction between an omitted value and a confirmed empty, zero, or `false` value.
- Keep network work bounded by a deadline, cancellation signal, byte/count limits, and deterministic cleanup.
- Connect only to addresses returned by the validated, pinned-target pipeline. Do not resolve again inside a transport.
- Convert implementation failures into stable public error contracts; do not expose arbitrary exceptions.

## Architecture

Dependencies flow from game profiles to protocol implementations to bounded transports and validated targets. Transports do not interpret games, parsers do not perform network I/O, and shared protocols do not branch on game IDs.

`GAME_REGISTRY` is the single source of game metadata. Add a game's data contract, `GameDataMap` entry, registry definition, runtime tests, and type tests together.

See [docs/Internals.md](docs/Internals.md) for module ownership and detailed invariants. Put durable implementation detail there instead of growing this file.

## Documentation

- Keep `README.md` focused on users: purpose, current capabilities, public contract, setup, and project status.
- Document exported APIs with TSDoc.
- Use inline comments for rationale, security boundaries, and non-obvious invariants—not line-by-line narration.
- Update the narrowest relevant document when behavior changes; avoid copying the same explanation into multiple files.

## Finish gate

Run the complete repository check before handing off or committing:

```bash
npm run verify
```

Add focused regression tests with every behavior change. Do not commit generated `dist/` output or publish/push unless explicitly requested.

Use the repository's conventional, imperative commit subjects. When a commit needs supporting detail, format its body as a concise `-` list with one meaningful change per item; omit the body when the subject is sufficient.
