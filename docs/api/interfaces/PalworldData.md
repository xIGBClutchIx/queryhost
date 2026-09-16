[**queryhost**](../README.md)

***

[queryhost](../README.md) / PalworldData

# Interface: PalworldData

Palworld-specific data collected from its public Steam query listener.

## Properties

### players?

> `readonly` `optional` **players?**: readonly [`PalworldPlayer`](PalworldPlayer.md)[]

Omitted when Player is skipped or unavailable; empty means the server confirmed no players.

***

### tags?

> `readonly` `optional` **tags?**: readonly `string`[]

Server-advertised tags, when the A2S Info response provides them.
