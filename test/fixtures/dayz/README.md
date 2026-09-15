# DayZ fixtures

These synthetic packets describe a fictional server and contain no live-server data. They
exercise DayZ's Source-style A2S Info, escaped paged server-browser metadata, and direct
string-valued Rules independently.

The envelope and paging/escaping shape is based on Valve's A2S packet documentation and Bohemia's
server-browser protocol documentation. The DayZ-specific version-2 metadata body follows a
documented 2026 packet analysis because Bohemia does not publish a separate current DayZ body
schema. DayZ's server configuration documents the separate game and Steam query ports. The Player
packet is intentionally unused because the profile records that source as unsupported rather than
presenting DayZ's anonymous or malformed records as a public player list.

Sources:

- <https://developer.valvesoftware.com/wiki/Server_queries>
- <https://community.bohemia.net/wiki/DayZ:Server_Configuration>
- <https://community.bohemia.net/wiki/Arma_3:_ServerBrowserProtocol3>
- <https://github.com/BohemiaInteractive/DayZ-Script-Diff/blob/main/scripts/5_mission/gui/newui/serverbrowsermenu/serverbrowsermenunew.c>
- <https://velvetcache.org/2026/07/09/dayz-server-browsers-part-two/>
