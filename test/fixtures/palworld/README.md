# Palworld profile fixture

This synthetic, deterministic fixture contains no real server or player data. Its packet layouts follow Valve's A2S protocol and model the public Steam query surface used by Palworld community servers.

- `info.hex` is a Source-format Info response with Palworld-identifying strings and tags.
- `players.hex` proves that a server-provided Player response is preserved when available.
- `rules.hex` proves that conditional Rules remain unchanged under `rawData.rules` rather than being presented as Pocketpair's authenticated REST settings.

Player and Rules support is conditional: these fixtures prove merge behavior, not that every Palworld server implements either optional source.

Protocol and product boundaries were checked against Valve's [server-query protocol](https://developer.valvesoftware.com/wiki/Server_queries), Steamworks' [separate game/query-port contract](https://partner.steamgames.com/doc/api/ISteamGameServer#InitGameServer), and Pocketpair's current [dedicated-server](https://docs.palworldgame.com/getting-started/deploy-dedicated-server/) and [REST API](https://docs.palworldgame.com/api/rest-api/palwold-rest-api/) documentation. Pocketpair requires Basic Auth for the richer REST interface and warns against exposing it directly to the Internet, so these fixtures do not imitate REST-only data.
