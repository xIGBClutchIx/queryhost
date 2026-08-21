[**queryhost**](../README.md)

***

[queryhost](../README.md) / ProjectZomboidData

# Interface: ProjectZomboidData

Project Zomboid-specific data collected from A2S sources.

## Properties

### description?

> `readonly` `optional` **description?**: `string`

***

### mods?

> `readonly` `optional` **mods?**: readonly `string`[]

Omitted when Rules is unavailable; empty means the server confirmed no mod IDs.

***

### players?

> `readonly` `optional` **players?**: readonly [`ProjectZomboidPlayer`](ProjectZomboidPlayer.md)[]

Omitted when Player is unavailable; empty means the server confirmed no listed players.

***

### pvp?

> `readonly` `optional` **pvp?**: `boolean`
