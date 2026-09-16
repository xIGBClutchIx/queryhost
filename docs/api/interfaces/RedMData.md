[**queryhost**](../README.md)

***

[queryhost](../README.md) / RedMData

# Interface: RedMData

RedM-specific data merged from its fixed JSON endpoints.

## Extends

- [`CfxData`](CfxData.md)\<[`RedMPlayer`](RedMPlayer.md)\>

## Properties

### enhancedHostSupport?

> `readonly` `optional` **enhancedHostSupport?**: `boolean`

#### Inherited from

[`CfxData`](CfxData.md).[`enhancedHostSupport`](CfxData.md#enhancedhostsupport)

***

### gameType?

> `readonly` `optional` **gameType?**: `string`

#### Inherited from

[`CfxData`](CfxData.md).[`gameType`](CfxData.md#gametype)

***

### oneSyncEnabled?

> `readonly` `optional` **oneSyncEnabled?**: `boolean`

#### Inherited from

[`CfxData`](CfxData.md).[`oneSyncEnabled`](CfxData.md#onesyncenabled)

***

### players?

> `readonly` `optional` **players?**: readonly [`RedMPlayer`](RedMPlayer.md)[]

Omitted when the players endpoint is unavailable; an empty array means confirmed empty.

#### Inherited from

[`CfxData`](CfxData.md).[`players`](CfxData.md#players)

***

### resources?

> `readonly` `optional` **resources?**: readonly `string`[]

Omitted when the resources endpoint is unavailable; an empty array means confirmed empty.

#### Inherited from

[`CfxData`](CfxData.md).[`resources`](CfxData.md#resources)

***

### variables?

> `readonly` `optional` **variables?**: `Readonly`\<`Record`\<`string`, `string`\>\>

#### Inherited from

[`CfxData`](CfxData.md).[`variables`](CfxData.md#variables)
