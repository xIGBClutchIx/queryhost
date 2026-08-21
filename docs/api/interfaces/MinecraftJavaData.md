[**queryhost**](../README.md)

***

[queryhost](../README.md) / MinecraftJavaData

# Interface: MinecraftJavaData

Minecraft Java data merged from Server List Ping and optional Query/SRV sources.

## Properties

### favicon?

> `readonly` `optional` **favicon?**: `string`

Validated data URL for the server icon, subject to a strict size limit.

***

### motd?

> `readonly` `optional` **motd?**: [`MinecraftMotd`](MinecraftMotd.md)

***

### players?

> `readonly` `optional` **players?**: readonly `string`[]

Omitted when Query is skipped or unavailable; empty means Query confirmed no listed players.

***

### plugins?

> `readonly` `optional` **plugins?**: readonly [`MinecraftPlugin`](MinecraftPlugin.md)[]

Omitted when the Query source is disabled, unavailable, or does not advertise plugins.

***

### protocolVersion?

> `readonly` `optional` **protocolVersion?**: `number`

Numeric protocol version, distinct from the human-readable server version.

***

### software?

> `readonly` `optional` **software?**: [`MinecraftSoftware`](MinecraftSoftware.md)

***

### srv?

> `readonly` `optional` **srv?**: [`MinecraftSrvTarget`](MinecraftSrvTarget.md)
