[**queryhost**](../README.md)

***

[queryhost](../README.md) / QueryInput

# Type Alias: QueryInput\<G\>

> **QueryInput**\<`G`\> = `object` & [`CanonicalGameId`](CanonicalGameId.md)\<`G`\> *extends* `"a2s"` ? `object` : `object`

Input accepted by the public `query()` entry point. Generic A2S requires its query port.

## Type Declaration

### game

> `readonly` **game**: `G`

### host

> `readonly` **host**: `string`

DNS hostname or IP literal. URL syntax is intentionally not accepted.

### mode?

> `readonly` `optional` **mode?**: [`QueryMode`](QueryMode.md)

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Caller cancellation propagated to every outstanding operation.

### timeoutMs?

> `readonly` `optional` **timeoutMs?**: `number`

Global deadline from 1 through 30,000 ms; defaults to 5,000 ms.

## Type Parameters

### G

`G` *extends* [`GameInputId`](GameInputId.md) = [`GameInputId`](GameInputId.md)
