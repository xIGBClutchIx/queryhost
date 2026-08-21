[**queryhost**](../README.md)

***

[queryhost](../README.md) / SevenDaysToDieData

# Interface: SevenDaysToDieData

7 Days to Die-specific data collected from A2S sources.

## Properties

### currentServerTime?

> `readonly` `optional` **currentServerTime?**: `string`

Raw game clock value advertised by A2S Rules.

***

### description?

> `readonly` `optional` **description?**: `string`

***

### gameMode?

> `readonly` `optional` **gameMode?**: `string`

***

### gameName?

> `readonly` `optional` **gameName?**: `string`

***

### gameWorld?

> `readonly` `optional` **gameWorld?**: `string`

***

### players?

> `readonly` `optional` **players?**: readonly [`SevenDaysToDiePlayer`](SevenDaysToDiePlayer.md)[]

Omitted when Player is unavailable; empty means the server confirmed no listed players.

***

### websiteUrl?

> `readonly` `optional` **websiteUrl?**: `string`
