[**queryhost**](../README.md)

***

[queryhost](../README.md) / QuerySuccess

# Interface: QuerySuccess\<G\>

Successful query with normalized and game-specific data.

## Extends

- `QueryResultBase`\<`G`\>

## Type Parameters

### G

`G` *extends* [`GameId`](../type-aliases/GameId.md)

## Properties

### data

> `readonly` **data**: [`GameDataMap`](GameDataMap.md)\[`G`\]

Data whose type is selected by the literal `game` identifier.

***

### durationMs

> `readonly` **durationMs**: `number`

Total wall-clock duration across discovery and all attempted sources.

#### Inherited from

`QueryResultBase.durationMs`

***

### game

> `readonly` **game**: `G`

#### Inherited from

`QueryResultBase.game`

***

### ok

> `readonly` **ok**: `true`

***

### partial

> `readonly` **partial**: `boolean`

True when the profile produced a usable result but requested enrichment remained incomplete.

***

### rawData?

> `readonly` `optional` **rawData?**: [`GameRawDataMap`](GameRawDataMap.md)\[`G`\]

Untouched protocol fields, kept separate from normalized data.

***

### server

> `readonly` **server**: [`ServerInfo`](ServerInfo.md)

***

### sources

> `readonly` **sources**: readonly [`QuerySource`](QuerySource.md)[]

Source-by-source provenance, including skipped and failed optional work.

#### Inherited from

`QueryResultBase.sources`

***

### warnings

> `readonly` **warnings**: readonly [`QueryWarning`](QueryWarning.md)[]

#### Inherited from

`QueryResultBase.warnings`
