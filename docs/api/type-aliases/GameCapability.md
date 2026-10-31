[**queryhost**](../README.md)

***

[queryhost](../README.md) / GameCapability

# Type Alias: GameCapability

> **GameCapability** = *typeof* [`GAME_CAPABILITIES`](../variables/GAME_CAPABILITIES.md)\[`number`\]

Features exposed through normalized or game-specific query results:

- `summary`: normalized server facts under `server`.
- `players`: a player list (names, possibly empty strings when the server hides them) under
  `data.players`. Aggregate counts in `server.players` are part of `summary`, not this
  capability, so a game can report counts while `players` is `unsupported`.
- `rules`: server-reported rule or setting key-value pairs, such as A2S Rules in
  `rawData.rules` or Cfx server variables in `data.variables`.
- `mods`: server mod or Workshop metadata in a game-specific `data` field.
- `plugins`: a list of server plugins in `data.plugins`.
- `resources`: a list of server resources in `data.resources`.
- `srv`: DNS SRV discovery of the query destination, reported in `data.srv`.
