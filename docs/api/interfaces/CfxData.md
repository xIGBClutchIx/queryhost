[**queryhost**](../README.md)

***

[queryhost](../README.md) / CfxData

# Interface: CfxData\<P\>

Data shared by Cfx FXServer games and merged from their fixed JSON endpoints.

## Extended by

- [`FiveMData`](FiveMData.md)
- [`RedMData`](RedMData.md)

## Type Parameters

### P

`P` *extends* [`CfxPlayer`](CfxPlayer.md) = [`CfxPlayer`](CfxPlayer.md)

## Properties

### enhancedHostSupport?

> `readonly` `optional` **enhancedHostSupport?**: `boolean`

***

### gameType?

> `readonly` `optional` **gameType?**: `string`

***

### oneSyncEnabled?

> `readonly` `optional` **oneSyncEnabled?**: `boolean`

***

### players?

> `readonly` `optional` **players?**: readonly `P`[]

Omitted when the players endpoint is unavailable; an empty array means confirmed empty.

***

### resources?

> `readonly` `optional` **resources?**: readonly `string`[]

Omitted when the resources endpoint is unavailable; an empty array means confirmed empty.

***

### variables?

> `readonly` `optional` **variables?**: `Readonly`\<`Record`\<`string`, `string`\>\>
