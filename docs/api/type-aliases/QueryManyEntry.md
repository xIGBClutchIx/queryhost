[**queryhost**](../README.md)

***

[queryhost](../README.md) / QueryManyEntry

# Type Alias: QueryManyEntry\<G\>

> **QueryManyEntry**\<`G`\> = `{ readonly [K in G]: { index: number; input: QueryInput<K>; result: QueryResult<CanonicalGameId<K>> } }`\[`G`\]

One settled query from `queryMany()`, correlated with the input that produced it.

## Type Parameters

### G

`G` *extends* [`GameInputId`](GameInputId.md) = [`GameInputId`](GameInputId.md)
