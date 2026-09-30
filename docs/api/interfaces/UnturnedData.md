[**queryhost**](../README.md)

***

[queryhost](../README.md) / UnturnedData

# Interface: UnturnedData

Unturned data collected from its Steam A2S query port.

## Extends

- [`SteamA2sData`](SteamA2sData.md)

## Properties

### appId?

> `readonly` `optional` **appId?**: `number`

Present only for modern Source-style Info responses.

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

### players?

> `readonly` `optional` **players?**: readonly [`SteamA2sPlayer`](SteamA2sPlayer.md)[]

Omitted when Player is skipped or unavailable; empty means the server confirmed no players.

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`players`](SteamA2sData.md#players)

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
