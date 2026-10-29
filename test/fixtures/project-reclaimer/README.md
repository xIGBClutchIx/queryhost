# Project Reclaimer fixtures

Each file is the JSON body of one status answer, without its four-byte length prefix. Tests add
the frame header. The files are excluded from Prettier so they stay byte-for-byte as received.

`status-mods.json`, `status-odst.json`, and `status-plain.json` were captured on 2026-10-29 from
public dedicated servers listed by the default master (`148.251.153.44:49175/v3/discovery`),
answering the 0.9.23 browser's `{"status":2}` request. Together they cover a server with mods
whose entries carry the optional `customization`, `lineage`, `required`, and `key` fields (the
last two are not retained); a Halo 3: ODST Firefight server with an `odst` block and no
`map_variant`; and a server with a Forge `map_variant` and no mods.

`status-players.json` is synthetic. It follows the shape of a captured answer from a populated
server, but its player names and server identity are invented. It covers `player_names`,
`max_ping`, `ready: false`, a required password, and an unknown top-level field.
