[**queryhost**](../README.md)

***

[queryhost](../README.md) / SteamA2sData

# Interface: SteamA2sData

Facts shared by games whose direct Steam A2S endpoint needs no game-specific interpretation.

## Extended by

- [`Arma3Data`](Arma3Data.md)
- [`AmericanTruckSimulatorData`](AmericanTruckSimulatorData.md)
- [`EuroTruckSimulator2Data`](EuroTruckSimulator2Data.md)
- [`TheForestData`](TheForestData.md)
- [`UnturnedData`](UnturnedData.md)
- [`EnshroudedData`](EnshroudedData.md)
- [`InsurgencySandstormData`](InsurgencySandstormData.md)
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

Steam App ID for modern Source-style Info responses. It comes from the 64-bit game ID when
the server sends one, because the base Info field is 16 bits and truncates larger IDs.

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

### game

> `readonly` **game**: `string`

Game description advertised by the server, such as a mode, mission, or product name.

***

### gamePort?

> `readonly` `optional` **gamePort?**: `number`

Game port the server advertises, which may differ from the queried Steam port.

***

### players?

> `readonly` `optional` **players?**: readonly [`SteamA2sPlayer`](SteamA2sPlayer.md)[]

Omitted when Player is skipped or unavailable; empty means the server confirmed no players.

***

### serverSteamId?

> `readonly` `optional` **serverSteamId?**: `string`

Server's 64-bit Steam ID as decimal text, when advertised.

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
