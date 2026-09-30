[**queryhost**](../README.md)

***

[queryhost](../README.md) / SourceEngineData

# Interface: SourceEngineData

Facts shared by Valve Source-engine multiplayer games through their game-port A2S endpoint.

## Extended by

- [`CounterStrike2Data`](CounterStrike2Data.md)
- [`CounterStrikeSourceData`](CounterStrikeSourceData.md)
- [`GarrysModData`](GarrysModData.md)
- [`Left4DeadData`](Left4DeadData.md)
- [`Left4Dead2Data`](Left4Dead2Data.md)
- [`TeamFortress2Data`](TeamFortress2Data.md)

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

Game content directory, such as `tf` or `garrysmod`, which also identifies server mods.

***

### players?

> `readonly` `optional` **players?**: readonly [`SourceEnginePlayer`](SourceEnginePlayer.md)[]

Omitted when Player is skipped or unavailable; empty means the server confirmed no players.

***

### serverType

> `readonly` **serverType**: `"dedicated"` \| `"listen"` \| `"proxy"`

***

### sourceTv?

> `readonly` `optional` **sourceTv?**: [`SourceTvEndpoint`](SourceTvEndpoint.md)

SourceTV relay advertised by the server; never followed as a query destination.

***

### tags?

> `readonly` `optional` **tags?**: readonly `string`[]

Server-advertised `sv_tags`, when present.

***

### vac

> `readonly` **vac**: `boolean`
