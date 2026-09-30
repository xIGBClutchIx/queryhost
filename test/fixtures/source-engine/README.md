# Source-engine profile fixture

This synthetic fixture models a Team Fortress 2 dedicated server's game-port A2S answers. It contains no real server or player data. Counter-Strike 2, Counter-Strike: Source, Team Fortress 2, Left 4 Dead, Left 4 Dead 2, and Garry's Mod share one profile, so one packet set proves their common merge.

- `info.hex` is a Source-format Info response with the port, SourceTV, keyword, and game ID extra-data fields. Its keywords include surrounding whitespace to prove tag trimming.
- `players.hex` confirms three Player records, including one with an empty name like those Counter-Strike 2 returns without a server plugin.
- `rules.hex` confirms three string rules that stay unchanged under `rawData.rules`.

Protocol scope follows Valve's [Server queries](https://developer.valvesoftware.com/wiki/Server_queries) documentation, which defines the Info, Player, and Rules layouts and the Source-engine convention of answering queries on the game port (27015 by default).
