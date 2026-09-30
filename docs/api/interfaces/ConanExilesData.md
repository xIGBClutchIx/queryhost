[**queryhost**](../README.md)

***

[queryhost](../README.md) / ConanExilesData

# Interface: ConanExilesData

Conan Exiles data collected from its Steam A2S query port.

## Extends

- [`SteamA2sData`](SteamA2sData.md).[`UnrealSessionData`](UnrealSessionData.md)

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

### buildId?

> `readonly` `optional` **buildId?**: `number`

Build compatibility ID from `BUILDID`; clients must match it to join.

#### Inherited from

[`UnrealSessionData`](UnrealSessionData.md).[`buildId`](UnrealSessionData.md#buildid)

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

### fullServerName?

> `readonly` `optional` **fullServerName?**: `string`

Full server name from the `OWNINGNAME` session value.

***

### game

> `readonly` **game**: `string`

Game description advertised by the server, such as a mode, mission, or product name.

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`game`](SteamA2sData.md#game)

***

### gamePort?

> `readonly` `optional` **gamePort?**: `number`

Game port the server advertises, which may differ from the queried Steam port.

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`gamePort`](SteamA2sData.md#gameport)

***

### openPublicSlots?

> `readonly` `optional` **openPublicSlots?**: `number`

Open public connection slots from `NUMOPENPUBCONN`.

#### Inherited from

[`UnrealSessionData`](UnrealSessionData.md).[`openPublicSlots`](UnrealSessionData.md#openpublicslots)

***

### players?

> `readonly` `optional` **players?**: readonly [`SteamA2sPlayer`](SteamA2sPlayer.md)[]

Omitted when Player is skipped or unavailable; empty means the server confirmed no players.

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`players`](SteamA2sData.md#players)

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

### sessionFlags?

> `readonly` `optional` **sessionFlags?**: [`UnrealSessionFlags`](UnrealSessionFlags.md)

#### Inherited from

[`UnrealSessionData`](UnrealSessionData.md).[`sessionFlags`](UnrealSessionData.md#sessionflags)

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
