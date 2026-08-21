[**queryhost**](../README.md)

***

[queryhost](../README.md) / QueryFailure

# Interface: QueryFailure\<G\>

Failed query in which a required source could not produce a usable result.

## Extends

- `QueryResultBase`\<`G`\>

## Type Parameters

### G

`G` *extends* [`GameId`](../type-aliases/GameId.md)

## Properties

### durationMs

> `readonly` **durationMs**: `number`

Total wall-clock duration across discovery and all attempted sources.

#### Inherited from

`QueryResultBase.durationMs`

***

### error

> `readonly` **error**: [`QueryError`](QueryError.md)

***

### game

> `readonly` **game**: `G`

#### Inherited from

`QueryResultBase.game`

***

### ok

> `readonly` **ok**: `false`

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
