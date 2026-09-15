[**queryhost**](../README.md)

***

[queryhost](../README.md) / DontStarveTogetherData

# Interface: DontStarveTogetherData

Don't Starve Together shard facts reported through its Steam A2S endpoint.

## Properties

### appId?

> `readonly` `optional` **appId?**: `number`

Truncated 16-bit App ID carried by the base Source Info layout.

***

### bots

> `readonly` **bots**: `number`

***

### environment

> `readonly` **environment**: `"linux"` \| `"macos"` \| `"windows"`

***

### folder

> `readonly` **folder**: `string`

***

### game

> `readonly` **game**: `string`

***

### players?

> `readonly` `optional` **players?**: readonly [`DontStarveTogetherPlayer`](DontStarveTogetherPlayer.md)[]

Omitted when Player is skipped or unavailable; empty means the shard confirmed no players.

***

### protocol

> `readonly` **protocol**: `number`

***

### serverType

> `readonly` **serverType**: `"dedicated"` \| `"listen"` \| `"proxy"`

***

### steamGameId?

> `readonly` `optional` **steamGameId?**: `string`

Full 64-bit Steam game ID, encoded as decimal text when the response provides it.

***

### tags?

> `readonly` `optional` **tags?**: readonly `string`[]

Server-advertised Steam tags, when present.

***

### vac

> `readonly` **vac**: `boolean`
