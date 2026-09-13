[**queryhost**](../README.md)

***

[queryhost](../README.md) / A2sData

# Interface: A2sData

Protocol facts exposed by the generic Source or GoldSource A2S profile.

## Properties

### appId?

> `readonly` `optional` **appId?**: `number`

Present only for modern Source-style Info responses.

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

> `readonly` `optional` **players?**: readonly [`A2sPlayer`](A2sPlayer.md)[]

Omitted when Player is skipped or unavailable; empty means the server confirmed no players.

***

### protocol

> `readonly` **protocol**: `number`

***

### serverType

> `readonly` **serverType**: `"dedicated"` \| `"listen"` \| `"proxy"`

***

### tags?

> `readonly` `optional` **tags?**: readonly `string`[]

Server-advertised tags, when a Source-style Info response provides them.

***

### vac

> `readonly` **vac**: `boolean`
