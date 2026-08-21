[**queryhost**](../README.md)

***

[queryhost](../README.md) / FiveMData

# Interface: FiveMData

FiveM-specific data merged from its fixed JSON endpoints.

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

> `readonly` `optional` **players?**: readonly [`FiveMPlayer`](FiveMPlayer.md)[]

Omitted when the players endpoint is unavailable; an empty array means confirmed empty.

***

### resources?

> `readonly` `optional` **resources?**: readonly `string`[]

Omitted when the resources endpoint is unavailable; an empty array means confirmed empty.

***

### variables?

> `readonly` `optional` **variables?**: `Readonly`\<`Record`\<`string`, `string`\>\>
