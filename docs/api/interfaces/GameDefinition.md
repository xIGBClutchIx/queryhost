[**queryhost**](../README.md)

***

[queryhost](../README.md) / GameDefinition

# Interface: GameDefinition\<G\>

Static metadata for one supported game profile.

## Type Parameters

### G

`G` *extends* [`GameId`](../type-aliases/GameId.md) = [`GameId`](../type-aliases/GameId.md)

## Properties

### capabilities

> `readonly` **capabilities**: `Readonly`\<`Record`\<[`GameCapability`](../type-aliases/GameCapability.md), [`SupportLevel`](../type-aliases/SupportLevel.md)\>\>

***

### defaultPort

> `readonly` **defaultPort**: `number`

Default game or service port supplied by users.

***

### defaultQueryPort?

> `readonly` `optional` **defaultQueryPort?**: `number`

Conventional query port corresponding to `defaultPort` when the protocol uses a separate
destination. QueryHost preserves this offset for custom game ports.

***

### id

> `readonly` **id**: `G`

***

### name

> `readonly` **name**: `string`
