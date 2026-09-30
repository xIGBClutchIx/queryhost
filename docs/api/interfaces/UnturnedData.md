[**queryhost**](../README.md)

***

[queryhost](../README.md) / UnturnedData

# Interface: UnturnedData

Unturned data collected from its Steam A2S query port.

## Extends

- [`SteamA2sData`](SteamA2sData.md)

## Properties

### anycastProxy?

> `readonly` `optional` **anycastProxy?**: `boolean`

Whether the host declares an anycast proxy in front of the server.

***

### appId?

> `readonly` `optional` **appId?**: `number`

Steam App ID for modern Source-style Info responses. It comes from the 64-bit game ID when
the server sends one, because the base Info field is 16 bits and truncates larger IDs.

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`appId`](SteamA2sData.md#appid)

***

### battlEye?

> `readonly` `optional` **battlEye?**: `boolean`

***

### bookmarkHost?

> `readonly` `optional` **bookmarkHost?**: `string`

***

### bots

> `readonly` **bots**: `number`

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`bots`](SteamA2sData.md#bots)

***

### cameraMode?

> `readonly` `optional` **cameraMode?**: `"first-person"` \| `"both"` \| `"third-person"` \| `"vehicle"`

***

### cheats?

> `readonly` `optional` **cheats?**: `boolean`

***

### config?

> `readonly` `optional` **config?**: `Readonly`\<`Record`\<`string`, `number` \| `boolean`\>\>

Gameplay settings changed from the mode defaults, keyed `Section.Field`.

***

### description?

> `readonly` `optional` **description?**: `string`

Full server-browser description, decoded from its Base64 chunks.

***

### descriptionHint?

> `readonly` `optional` **descriptionHint?**: `string`

Short hint shown beside the server-list description.

***

### difficulty?

> `readonly` `optional` **difficulty?**: `"normal"` \| `"hard"` \| `"easy"`

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

### gameVersion?

> `readonly` `optional` **gameVersion?**: `string`

Unturned build the server runs, from the `GameVersion` rule.

***

### goldOnly?

> `readonly` `optional` **goldOnly?**: `boolean`

Whether only Unturned Gold players may join.

***

### iconUrl?

> `readonly` `optional` **iconUrl?**: `string`

***

### links?

> `readonly` `optional` **links?**: readonly [`UnturnedLink`](UnturnedLink.md)[]

***

### modName?

> `readonly` `optional` **modName?**: `string`

Name and version of a server-side mod module, when one is loaded.

***

### modVersion?

> `readonly` `optional` **modVersion?**: `string`

***

### monetization?

> `readonly` `optional` **monetization?**: `"none"` \| `"non-gameplay"` \| `"monetized"`

Host-declared monetization; omitted when the server leaves it unspecified.

***

### networkTransport?

> `readonly` `optional` **networkTransport?**: `string`

Network transport tag, such as `def`, `sys`, or `sns`.

***

### players?

> `readonly` `optional` **players?**: readonly [`SteamA2sPlayer`](SteamA2sPlayer.md)[]

Omitted when Player is skipped or unavailable; empty means the server confirmed no players.

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`players`](SteamA2sData.md#players)

***

### pluginFramework?

> `readonly` `optional` **pluginFramework?**: `"rocketmod"` \| `"openmod"`

***

### plugins?

> `readonly` `optional` **plugins?**: readonly `string`[]

Loaded RocketMod plugin names.

***

### pvp?

> `readonly` `optional` **pvp?**: `boolean`

Whether players can damage each other; `false` means PvE.

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

### thumbnailUrl?

> `readonly` `optional` **thumbnailUrl?**: `string`

***

### vac

> `readonly` **vac**: `boolean`

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`vac`](SteamA2sData.md#vac)

***

### workshop?

> `readonly` `optional` **workshop?**: `boolean`

Whether the server requires Steam Workshop content.

***

### workshopIds?

> `readonly` `optional` **workshopIds?**: readonly `string`[]

Required Steam Workshop item IDs; omitted when Rules are unavailable or list none.
