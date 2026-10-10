[**queryhost**](../README.md)

***

[queryhost](../README.md) / DetectSuccess

# Type Alias: DetectSuccess

> **DetectSuccess** = `{ readonly [G in GameId]: { durationMs: number; evidence: DetectEvidence; game: G; ok: true; probes: readonly DetectProbe[]; result: QueryResult<G> } }`\[[`GameId`](GameId.md)\]

Successful detection, correlated by game. `result` is the detected game's own query and can
still fail when the server stops answering between the probe and that query.
