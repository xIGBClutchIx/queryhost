[**queryhost**](../README.md)

***

[queryhost](../README.md) / queryMany

# Function: queryMany()

> **queryMany**\<`G`\>(`inputs`, `options?`): `AsyncGenerator`\<[`QueryManyEntry`](../type-aliases/QueryManyEntry.md)\<`G`\>, `void`, `undefined`\>

Queries many game servers with bounded concurrency, yielding each result as it settles.

Entries arrive in completion order; `index` gives each input's position. Every input started
yields exactly one entry, and a failed target is a [QueryFailure](../interfaces/QueryFailure.md) entry rather than a
rejected batch. Inputs are read lazily, and no query starts until iteration begins.
Stopping iteration early cancels the queries still in flight and waits for their cleanup.

## Type Parameters

### G

`G` *extends* [`GameInputId`](../type-aliases/GameInputId.md)

## Parameters

### inputs

`Iterable`\<[`QueryInput`](../type-aliases/QueryInput.md)\<`G`\>\>

### options?

[`QueryManyOptions`](../interfaces/QueryManyOptions.md)

## Returns

`AsyncGenerator`\<[`QueryManyEntry`](../type-aliases/QueryManyEntry.md)\<`G`\>, `void`, `undefined`\>

## Throws

TypeError or RangeError, synchronously, when `inputs` is not iterable or `options` is
invalid. Invalid individual inputs resolve as `INVALID_INPUT` entries instead.

## Example

```ts
for await (const { input, result } of queryMany(servers, { concurrency: 4 })) {
  console.log(input.host, result.ok ? result.server.players : result.error.code);
}
```
