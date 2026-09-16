# Valheim profile fixture

This synthetic fixture models the direct Steam-backend behavior documented by Valheim and the
fields observed from its Source-style A2S endpoint. It contains no real server or player data.

- `info.hex` advertises a dedicated Linux server, world name, counts, password state, generic
  Steamworks version, and Valheim network version in the A2S keyword field.
- `players.hex` confirms two connection records with empty names, matching Valheim's deliberate
  absence of public player identities.
- There is no Rules fixture because Valheim does not provide A2S Rules. Full queries record that
  source as `unsupported` without opening a Rules socket.

The profile tests prove the game-port-plus-one convention, conditional anonymous Player data,
unsupported Rules provenance, and omission of raw Rules data.

Protocol scope is grounded in Valheim's official
[dedicated-server guide](https://www.valheim.com/support/a-guide-to-dedicated-servers/), which
documents ports 2456-2457 and the Steam/PlayFab backend split, and Valve's
[game-server API](https://partner.steamgames.com/doc/api/isteamgameserver), which defines the
separate server-browser query-port role. The fixture values themselves are synthetic so tests do
not retain a real operator's server or player data.
