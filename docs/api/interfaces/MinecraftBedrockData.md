[**queryhost**](../README.md)

***

[queryhost](../README.md) / MinecraftBedrockData

# Interface: MinecraftBedrockData

Minecraft Bedrock data parsed from a RakNet unconnected pong.

## Properties

### advertisedIpv4Port?

> `readonly` `optional` **advertisedIpv4Port?**: `number`

Port advertised by the server; it may differ from the queried destination.

***

### advertisedIpv6Port?

> `readonly` `optional` **advertisedIpv6Port?**: `number`

IPv6 port advertised by the server, when present.

***

### crossplay?

> `readonly` `optional` **crossplay?**: [`MinecraftCrossplayHint`](MinecraftCrossplayHint.md)

Present when the pong carries a Geyser default sub-MOTD, so Java players can likely join.

***

### edition?

> `readonly` `optional` **edition?**: `string`

***

### gameMode?

> `readonly` `optional` **gameMode?**: `string`

***

### motd?

> `readonly` `optional` **motd?**: `string`

***

### protocolVersion?

> `readonly` `optional` **protocolVersion?**: `number`

***

### serverId?

> `readonly` `optional` **serverId?**: `string`
