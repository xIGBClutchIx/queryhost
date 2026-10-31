[**queryhost**](../README.md)

***

[queryhost](../README.md) / listGames

# Function: listGames()

> **listGames**(): readonly [`GameDefinition`](../interfaces/GameDefinition.md)\<keyof [`GameDataMap`](../interfaces/GameDataMap.md)\>[]

Lists game definitions in the stable order defined by [GAME\_IDS](../variables/GAME_IDS.md). The array and every
definition in it are frozen and shared between calls.

## Returns

readonly [`GameDefinition`](../interfaces/GameDefinition.md)\<keyof [`GameDataMap`](../interfaces/GameDataMap.md)\>[]
