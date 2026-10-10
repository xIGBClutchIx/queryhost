[**queryhost**](../README.md)

***

[queryhost](../README.md) / DetectEvidence

# Type Alias: DetectEvidence

> **DetectEvidence** = `"protocol"` \| `"advertised"` \| `"port"` \| `"fallback"`

How the detected game was told apart from the others its protocol serves.

- `protocol`: the protocol that answered belongs to this game alone, such as Minecraft or Eco.
- `advertised`: the server named its game, through its A2S Steam App ID or Cfx `gamename`.
- `port`: several games share the protocol, and only this one conventionally uses the port.
- `fallback`: nothing identified a specific game, so the result uses the protocol's general
  profile, generic A2S or FiveM for Cfx.
