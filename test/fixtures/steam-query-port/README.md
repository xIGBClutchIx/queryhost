# Steam query-port profile fixture

This synthetic fixture models an Unreal Engine dedicated server that answers Steam A2S on a separately configured query port. It contains no real server or player data. ARK: Survival Evolved, Conan Exiles, Killing Floor 2, Day of Dragons, Sons of the Forest, Icarus, and Abiotic Factor share the Steam A2S profile, so one packet set proves their common merge.

- `info.hex` is a Source-format Info response with the game port, server Steam ID, keyword, and game ID extra-data fields. Its 16-bit App ID field holds ARK's truncated 18430 while the game ID carries the full 346110 and no SourceTV relay. Its keywords include surrounding whitespace to prove tag trimming.
- `players.hex` confirms two Player records, including one with an empty name.
- `rules.hex` confirms two string rules that stay unchanged under `rawData.rules`.

Protocol scope follows Valve's [Server queries](https://developer.valvesoftware.com/wiki/Server_queries) documentation. Default ports come from each game's dedicated-server documentation, as listed in `docs/Internals.md`.
