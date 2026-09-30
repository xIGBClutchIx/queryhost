[**queryhost**](../README.md)

***

[queryhost](../README.md) / TeamFortress2Data

# Interface: TeamFortress2Data

Team Fortress 2 data collected from its game-port A2S endpoint. The game adds a tag whenever
one of these cvars differs from its default, so with tags present an absent tag means default.

## Extends

- [`SteamA2sData`](SteamA2sData.md)

## Properties

### appId?

> `readonly` `optional` **appId?**: `number`

Steam App ID for modern Source-style Info responses. It comes from the 64-bit game ID when
the server sends one, because the base Info field is 16 bits and truncates larger IDs.

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`appId`](SteamA2sData.md#appid)

***

### bots

> `readonly` **bots**: `number`

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`bots`](SteamA2sData.md#bots)

***

### environment

> `readonly` **environment**: `"linux"` \| `"macos"` \| `"windows"`

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`environment`](SteamA2sData.md#environment)

***

### folder

> `readonly` **folder**: `string`

Game content directory, such as `tf` or `garrysmod`, which also identifies Source mods.

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`folder`](SteamA2sData.md#folder)

***

### friendlyFire?

> `readonly` `optional` **friendlyFire?**: `boolean`

***

### game

> `readonly` **game**: `string`

Game description advertised by the server, such as a mode, mission, or product name.

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`game`](SteamA2sData.md#game)

***

### gameModes?

> `readonly` `optional` **gameModes?**: readonly [`TeamFortress2GameMode`](../type-aliases/TeamFortress2GameMode.md)[]

Game modes of the current map; `cp` also covers King of the Hill and attack/defend maps.

***

### gamePort?

> `readonly` `optional` **gamePort?**: `number`

Game port the server advertises, which may differ from the queried Steam port.

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`gamePort`](SteamA2sData.md#gameport)

***

### highlander?

> `readonly` `optional` **highlander?**: `boolean`

***

### medieval?

> `readonly` `optional` **medieval?**: `boolean`

***

### players?

> `readonly` `optional` **players?**: readonly [`SteamA2sPlayer`](SteamA2sPlayer.md)[]

Omitted when Player is skipped or unavailable; empty means the server confirmed no players.

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`players`](SteamA2sData.md#players)

***

### randomCrits?

> `readonly` `optional` **randomCrits?**: `boolean`

`false` when `tf_weapon_criticals` disables random critical hits.

***

### serverSteamId?

> `readonly` `optional` **serverSteamId?**: `string`

Server's 64-bit Steam ID as decimal text, when advertised.

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`serverSteamId`](SteamA2sData.md#serversteamid)

***

### serverType

> `readonly` **serverType**: `"dedicated"` \| `"listen"` \| `"proxy"`

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`serverType`](SteamA2sData.md#servertype)

***

### sourceTv?

> `readonly` `optional` **sourceTv?**: [`SourceTvEndpoint`](SourceTvEndpoint.md)

SourceTV relay advertised by the server; never followed as a query destination.

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`sourceTv`](SteamA2sData.md#sourcetv)

***

### tags?

> `readonly` `optional` **tags?**: readonly `string`[]

Comma-delimited A2S Info keywords split in server order, when present.

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`tags`](SteamA2sData.md#tags)

***

### vac

> `readonly` **vac**: `boolean`

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`vac`](SteamA2sData.md#vac)
