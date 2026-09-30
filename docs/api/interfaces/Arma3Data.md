[**queryhost**](../README.md)

***

[queryhost](../README.md) / Arma3Data

# Interface: Arma3Data

Arma 3 data collected from its Steam A2S query port.

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

### battlEye?

> `readonly` `optional` **battlEye?**: `boolean`

Whether BattlEye protection is enabled, from the `b` keyword.

***

### bots

> `readonly` **bots**: `number`

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`bots`](SteamA2sData.md#bots)

***

### country?

> `readonly` `optional` **country?**: `string`

Country code from the `o` keyword.

***

### creatorDlc?

> `readonly` `optional` **creatorDlc?**: readonly [`Arma3CreatorDlc`](Arma3CreatorDlc.md)[]

Omitted when Rules metadata is unavailable; empty means no Creator DLC is loaded.

***

### dedicated?

> `readonly` `optional` **dedicated?**: `boolean`

Whether the server is dedicated, from the `d` keyword.

***

### description?

> `readonly` `optional` **description?**: `string`

Optional description appended to the metadata by some server builds.

***

### difficulty?

> `readonly` `optional` **difficulty?**: [`Arma3Difficulty`](Arma3Difficulty.md)

Omitted when Rules metadata is unavailable or the server advertises no difficulty.

***

### dlc?

> `readonly` `optional` **dlc?**: readonly [`Arma3Dlc`](Arma3Dlc.md)[]

Omitted when Rules metadata is unavailable; empty means the server requires no DLC.

***

### environment

> `readonly` **environment**: `"linux"` \| `"macos"` \| `"windows"`

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`environment`](SteamA2sData.md#environment)

***

### equalModsRequired?

> `readonly` `optional` **equalModsRequired?**: `boolean`

Whether clients must load exactly the server's mods, from the `m` keyword.

***

### filePatching?

> `readonly` `optional` **filePatching?**: `boolean`

Whether file patching is allowed, from the `f` keyword.

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

### gameType?

> `readonly` `optional` **gameType?**: `string`

Mission game type from the `t` keyword, such as `coop`, `zeus`, or `warlord`.

***

### island?

> `readonly` `optional` **island?**: `string`

Island identifier from the `y` keyword.

***

### language?

> `readonly` `optional` **language?**: `number`

Raw Bohemia language code from the `g` keyword, such as 65545 for English.

***

### loadedContentHash?

> `readonly` `optional` **loadedContentHash?**: `string`

Loaded-content hash from the `h` keyword.

***

### locked?

> `readonly` `optional` **locked?**: `boolean`

Whether the session is locked against new players, from the `l` keyword.

***

### mods?

> `readonly` `optional` **mods?**: readonly [`Arma3Mod`](Arma3Mod.md)[]

Omitted when Rules metadata is unavailable; empty means the server confirmed no mods.

***

### platform?

> `readonly` `optional` **platform?**: `"linux"` \| `"macos"` \| `"windows"`

Server operating system from the `p` keyword.

***

### players?

> `readonly` `optional` **players?**: readonly [`SteamA2sPlayer`](SteamA2sPlayer.md)[]

Omitted when Player is skipped or unavailable; empty means the server confirmed no players.

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`players`](SteamA2sData.md#players)

***

### requiredBuild?

> `readonly` `optional` **requiredBuild?**: `number`

Game build number clients must run, from the `n` keyword.

***

### requiredVersion?

> `readonly` `optional` **requiredVersion?**: `number`

Game version clients must run, from the `r` keyword (for example 218 for 2.18).

***

### rulesProtocol?

> `readonly` `optional` **rulesProtocol?**: `number`

Server-browser metadata format version, when paged Rules metadata is available.

***

### serverState?

> `readonly` `optional` **serverState?**: `number`

Bohemia session state from the `s` keyword: 0 none through 7 playing, 8 finished, 9 aborted.

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

### signatures?

> `readonly` `optional` **signatures?**: readonly `string`[]

Accepted signature key names; empty means the server confirmed none.

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

### timeLeftMinutes?

> `readonly` `optional` **timeLeftMinutes?**: `number`

Mission time remaining in minutes, from the `e` keyword.

***

### vac

> `readonly` **vac**: `boolean`

#### Inherited from

[`SteamA2sData`](SteamA2sData.md).[`vac`](SteamA2sData.md#vac)

***

### verifySignatures?

> `readonly` `optional` **verifySignatures?**: `boolean`

Whether the server verifies addon signatures, from the `v` keyword.
