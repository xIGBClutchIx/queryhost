[**queryhost**](../README.md)

***

[queryhost](../README.md) / QueryInput

# Interface: QueryInput\<G\>

Input accepted by the public `query()` entry point.

## Type Parameters

### G

`G` *extends* [`GameInputId`](../type-aliases/GameInputId.md) = [`GameInputId`](../type-aliases/GameInputId.md)

## Properties

### game

> `readonly` **game**: `G`

***

### host

> `readonly` **host**: `string`

DNS hostname or IP literal. URL syntax is intentionally not accepted.

***

### mode?

> `readonly` `optional` **mode?**: [`QueryMode`](../type-aliases/QueryMode.md)

***

### port?

> `readonly` `optional` **port?**: `number`

Primary game or service port; the profile default is used when omitted.

***

### queryPort?

> `readonly` `optional` **queryPort?**: `number`

Explicit protocol query port, overriding the profile convention derived from `port`.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Caller cancellation propagated to every outstanding operation.

***

### timeoutMs?

> `readonly` `optional` **timeoutMs?**: `number`

Global deadline from 1 through 30,000 ms; defaults to 5,000 ms.
