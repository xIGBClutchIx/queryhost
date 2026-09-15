[**queryhost**](../README.md)

***

[queryhost](../README.md) / DayZData

# Interface: DayZData

DayZ-specific data collected from its Steam A2S endpoint.

## Properties

### allowedBuild?

> `readonly` `optional` **allowedBuild?**: `number`

***

### clientPort?

> `readonly` `optional` **clientPort?**: `number`

Game connection port advertised by the server; never followed as a query destination.

***

### dedicated?

> `readonly` `optional` **dedicated?**: `boolean`

***

### description?

> `readonly` `optional` **description?**: `string`

***

### island?

> `readonly` `optional` **island?**: `string`

Terrain identifier advertised by DayZ's optional Rules response.

***

### language?

> `readonly` `optional` **language?**: `number`

Raw numeric language flags reported by DayZ.

***

### mods?

> `readonly` `optional` **mods?**: readonly [`DayZMod`](DayZMod.md)[]

Omitted when Rules metadata is unavailable; empty means the server confirmed no mods.

***

### platform?

> `readonly` `optional` **platform?**: `"linux"` \| `"windows"`

Operating-system identifier advertised by DayZ's optional Rules response.

***

### requiredBuild?

> `readonly` `optional` **requiredBuild?**: `number`

***

### requiredVersion?

> `readonly` `optional` **requiredVersion?**: `number`

***

### rulesProtocol?

> `readonly` `optional` **rulesProtocol?**: `number`

Server-browser metadata format version, when paged metadata is available.

***

### signatures?

> `readonly` `optional` **signatures?**: readonly `string`[]

Omitted when Rules metadata is unavailable; empty means the server confirmed no keys.

***

### tags?

> `readonly` `optional` **tags?**: readonly `string`[]

Uninterpreted comma-delimited A2S Info keywords, split in server order.

***

### timeLeft?

> `readonly` `optional` **timeLeft?**: `number`

Raw numeric `timeLeft` value reported by DayZ.
