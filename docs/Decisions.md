# QueryHost decisions

This document records project decisions across the library, API, and web repositories that should remain stable until evidence justifies revisiting them. It is intended to prevent future work from silently changing the project's shape.

Superseded decisions keep their number and original text so later references stay meaningful. Each is followed by what replaced it.

## Product and repository decisions

1. **QueryHost is the query engine first.** The npm library is useful independently of any hosted service or website.
2. **Use separate repositories.** The library, API, and web projects are not a monorepo.
3. **Keep authoritative technical data with the library.** The library owns registry metadata and generated API reference source; the web repository owns the authored documentation experience that renders it.
4. **Use the purchased domain deliberately.** `query.host` is the site and playground, `docs.query.host` is documentation, and `api.query.host` is reserved for a future public developer API while the current API stays private.
   - _Superseded:_ `docs.query.host` was removed on October 7, 2026; documentation is served under `query.host/docs/`. The public read-only developer endpoints (`/api/v1/games`, `/api/v1/openapi.json`) are served by the web service, not `api.query.host`. The query API stays private.
5. **Prefer the unscoped npm package `queryhost`.** Use a scoped fallback only if the name is unavailable.
6. **Use Apache-2.0 unless a concrete licensing issue appears.** The project should be permissive for library and commercial use.
7. **Do not optimize for the largest game count.** Depth, correctness, types, and predictable semantics come first.

## Public API decisions

8. **The main call is `query(input)`.** Keep the common path short and unsurprising.
9. **Require an explicit game ID.** Public auto-detection is deferred because it complicates correctness and creates abuse risk.
   - _Superseded:_ `query()` still requires a game ID. The separate `detect()` export probes only the protocols and ports the registry's conventions allow, stops at the first answer, and stays bounded like every other query.
10. **Connect game IDs to `GameDataMap`.** Literal inputs return game-specific TypeScript data.
11. **Use `server` for normalized common fields.** Do not call it `core`.
12. **Use `data` for stable game-specific fields.** Do not flatten every game into one giant result.
13. **Expose source provenance.** Callers can see which protocol sources succeeded, timed out, were blocked, or were malformed.
14. **Represent optional-source failure as a partial success.** Do not report a reachable server offline because a secondary source failed.
15. **Omit unknown values.** Do not invent `false`, zero, or empty arrays.
16. **Distinguish query RTT from total duration.** Query RTT is not ICMP ping.
17. **Keep raw packet data out of the hosted contract.** Any library debug data is opt-in and semver-unstable.
18. **Use response schema metadata, not URL versioning.** The hosted paths do not include `/v1`.
    - _Superseded in part:_ the private API paths still have no version prefix. The web service's public developer endpoints are versioned under `/api/v1/`.

## Architecture decisions

19. **Separate transports, protocols, and game profiles.** Networking does not interpret games; protocols do not own game-specific rules.
20. **Use Node.js platform primitives where practical.** Avoid dependencies that add little beyond `Buffer`, sockets, fetch, DNS, and abort support.
21. **Make all I/O bounded and cancellable.** Global deadlines, source budgets, packet/body limits, and cleanup are mandatory.
22. **Run independent protocol work concurrently.** Preserve prerequisites but avoid unnecessary sequential latency.
23. **Host QueryHost services on Railway.** The API is a private normal Node.js service; one public web repository and service hosts both documentation and the playground. Cloudflare may provide DNS only.
24. **Keep the API runtime portable.** Use standard Node.js networking and isolate Railway configuration from the service core.
25. **Keep infrastructure out of the library.** `queryhost` has no hosting-provider dependencies and performs live queries by default.
26. **Do not add Redis, D1, KV, queues, or Durable Object cache architecture initially.** Short-lived query results do not require persistent storage.
27. **Keep the first deployment to one API service.** Avoid multiple regions or a control plane before traffic requires them.

## Caching decisions

28. **The npm library has no hidden cache.** Direct callers decide whether and how to cache.
29. **The hosted service uses short caches.** Start around 10 seconds for success, 5 seconds for partial data, and 2 seconds for timeout/offline results.
30. **Use the cache that matches the traffic.** The web service sends public cache headers for static documentation and assets; `POST /query` uses the private API's bounded process memory and in-flight coalescing.
31. **Coalesce identical in-flight queries.** Cache expiry must not cause a query stampede against a game server.
32. **Expose hosted cache metadata.** Callers can tell whether a response was cached and its age.
33. **Do not build cache bypass or account systems yet.** Add them only after a concrete use case exists.

## Hosted API and website decisions

34. **Start with `POST /query`, `GET /games`, and `GET /health`.** Do not add unrelated endpoints.
35. **The API consumes the public npm package.** It does not use a secret internal engine.
36. **The web server is the public caller boundary.** Browser code calls the web service, which applies caller controls and proxies to the private API; neither the browser nor the web project queries game servers directly.
37. **Export one game registry.** The API, documentation surface, and playground do not maintain separate support lists.
38. **The website is a playground, not an account dashboard.** Start with a polished query flow, provenance, JSON, examples, and shareable non-secret inputs.
39. **Do not store query history or player names beyond the short cache lifetime by default.** Monitoring is a separate future product decision.
    - _Updated:_ the playground keeps a short "recent checks" list (game, host, and ports only; never results or player names) in the visitor's own browser storage, with a Clear control. It is never sent to or stored by any QueryHost service, so this decision still holds for everything QueryHost stores.
40. **Host documentation and the playground together.** One `web` repository and Railway service owns both domains so they share a design system, navigation, components, and deployment.
    - _Updated:_ the service now owns the single `query.host` domain, with documentation under `/docs/` (see decision 4).
41. **Keep Railway Serverless disabled initially.** Avoid cold first requests and possible wake-up failures while combined usage remains within the plan allowance; revisit only with measured savings.

## Security decisions

42. **Treat the hosted API as an SSRF and network-abuse boundary.** Security is part of the core design.
43. **Accept only bounded query fields.** Allow game, host, approved port fields, mode, and timeout. Never accept arbitrary URLs, paths, redirects, payloads, or packet bytes.
44. **Resolve, validate, and pin public destinations.** Apply the same policy to SRV-derived addresses and IPv4/IPv6 forms.
45. **Enforce controls at every trust boundary.** The private Railway API enforces target and resource safety; the public web service independently enforces client-level limits before forwarding.
46. **Limit admissions and destinations.** Add bounded global and per-destination rolling windows, concurrency, cooldowns, queues, and hard protocol budgets.
47. **Accept no credentials in the anonymous service.** RCON, administrator APIs, owner tokens, and mutations are out of scope.
48. **Fail closed on cost.** Keep the API private behind origin authentication, bounded API admission and queueing, Railway resource limits, usage alerts, and a hard spending limit. The public web boundary must reject excess callers before forwarding.

## Scope decisions

49. **Prove a few protocol families first.** Initial profiles are Rust, Project Zomboid, 7 Days to Die, Minecraft Java, Minecraft Bedrock, and FiveM.
    - _Completed:_ those families are proven; the registry now covers 43 profiles. Decision 7 still governs additions.
50. **Use Satisfactory as a likely post-MVP extension.** Its public lightweight query is appropriate; authenticated administration is not.
    - _Completed:_ Satisfactory is supported through its public lightweight query only.
51. **Defer credentialed Palworld APIs.** Public A2S support may be considered separately.
    - _Completed in part:_ Palworld is supported through public A2S only; credentialed APIs remain out of scope.
52. **Do not build accounts, billing, alerts, persistent monitoring, saved servers, or organization features before demand exists.** Design clean seams, not unused systems.
    - _Updated:_ the browser-only recent-checks list described under decision 39 is a convenience, not saved servers: nothing is stored server-side or tied to an identity. Server-side saved servers remain out of scope.
53. **Build documentation before the playground.** Establish the shared web design and content system first, then add the interactive query flow to the same repository and service.

## Release and extension decisions

54. **Release the library as `queryhost@1.0.0`.** The unscoped name is available and the reviewed package-root contract is ready for its first stable version.
    - _Completed:_ 1.0.0 shipped; later versions follow decision 55 (see `CHANGELOG.md`).
55. **Apply semantic versioning to the package-root contract.** Export changes, result semantics, supported runtimes, and documented behavior determine future version changes.
56. **Publish from a signed repository release with npm provenance.** The release workflow runs the complete package gate against the release tag before it can publish.
57. **Use npm trusted publishing after the bootstrap release.** Limit GitHub OIDC trust to the release repository and workflow, and keep no long-lived npm publishing token in repository secrets.
58. **Pin hosted consumers to exact public versions.** Replace vendored tarballs only after the registry artifact and provenance verify, then run each consumer's finish gate.
59. **Keep WebMCP in the web project.** Browser tool registration adapts the existing site and same-origin query path; it does not add browser concerns or new network authority to the portable library.
60. **Expose exactly two document-scoped WebMCP tools.** One tool returns package-owned game metadata and one tool runs the existing playground query. Both are read-only, server-provided values are explicitly untrusted, and unsupported browsers keep the ordinary site without a polyfill.
61. **Open the hosted source without opening the API runtime.** The web and API repositories use Apache-2.0 and are publicly inspectable for the hackathon; Railway private networking, the origin token, and the absence of an API public domain remain unchanged.

## Revisiting a decision

A decision can change when new evidence makes the current choice materially worse. A proposal should state the observed problem, affected users, simplest alternative, migration cost, and whether the change belongs in the library, API, or web repository. Preference alone is not enough to expand scope. When a decision changes, mark it superseded here in the same change.
