[**queryhost**](../README.md)

***

[queryhost](../README.md) / CounterStrikeSourceData

# Interface: CounterStrikeSourceData

Counter-Strike: Source data collected from its game-port A2S endpoint.

## Extends

- [`SourceEngineData`](SourceEngineData.md)

## Properties

### appId?

> `readonly` `optional` **appId?**: `number`

Present only for modern Source-style Info responses.

#### Inherited from

[`SourceEngineData`](SourceEngineData.md).[`appId`](SourceEngineData.md#appid)

***

### bots

> `readonly` **bots**: `number`

#### Inherited from

[`SourceEngineData`](SourceEngineData.md).[`bots`](SourceEngineData.md#bots)

***

### environment

> `readonly` **environment**: `"linux"` \| `"macos"` \| `"windows"`

#### Inherited from

[`SourceEngineData`](SourceEngineData.md).[`environment`](SourceEngineData.md#environment)

***

### folder

> `readonly` **folder**: `string`

Game content directory, such as `tf` or `garrysmod`, which also identifies server mods.

#### Inherited from

[`SourceEngineData`](SourceEngineData.md).[`folder`](SourceEngineData.md#folder)

***

### players?

> `readonly` `optional` **players?**: readonly [`SourceEnginePlayer`](SourceEnginePlayer.md)[]

Omitted when Player is skipped or unavailable; empty means the server confirmed no players.

#### Inherited from

[`SourceEngineData`](SourceEngineData.md).[`players`](SourceEngineData.md#players)

***

### serverType

> `readonly` **serverType**: `"dedicated"` \| `"listen"` \| `"proxy"`

#### Inherited from

[`SourceEngineData`](SourceEngineData.md).[`serverType`](SourceEngineData.md#servertype)

***

### sourceTv?

> `readonly` `optional` **sourceTv?**: [`SourceTvEndpoint`](SourceTvEndpoint.md)

SourceTV relay advertised by the server; never followed as a query destination.

#### Inherited from

[`SourceEngineData`](SourceEngineData.md).[`sourceTv`](SourceEngineData.md#sourcetv)

***

### tags?

> `readonly` `optional` **tags?**: readonly `string`[]

Server-advertised `sv_tags`, when present.

#### Inherited from

[`SourceEngineData`](SourceEngineData.md).[`tags`](SourceEngineData.md#tags)

***

### vac

> `readonly` **vac**: `boolean`

#### Inherited from

[`SourceEngineData`](SourceEngineData.md).[`vac`](SourceEngineData.md#vac)
