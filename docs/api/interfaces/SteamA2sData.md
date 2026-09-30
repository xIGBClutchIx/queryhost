[**queryhost**](../README.md)

***

[queryhost](../README.md) / SteamA2sData

# Interface: SteamA2sData

Facts shared by games whose direct Steam A2S endpoint needs no game-specific interpretation.

## Extended by

- [`ArkSurvivalEvolvedData`](ArkSurvivalEvolvedData.md)
- [`ConanExilesData`](ConanExilesData.md)
- [`KillingFloor2Data`](KillingFloor2Data.md)
- [`DayOfDragonsData`](DayOfDragonsData.md)
- [`SoulmaskData`](SoulmaskData.md)
- [`SonsOfTheForestData`](SonsOfTheForestData.md)
- [`IcarusData`](IcarusData.md)
- [`AbioticFactorData`](AbioticFactorData.md)
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

Game content directory, such as `tf` or `garrysmod`, which also identifies Source mods.

***

### players?

> `readonly` `optional` **players?**: readonly [`SteamA2sPlayer`](SteamA2sPlayer.md)[]

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

Comma-delimited A2S Info keywords split in server order, when present.

***

### vac

> `readonly` **vac**: `boolean`
