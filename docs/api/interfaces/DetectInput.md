[**queryhost**](../README.md)

***

[queryhost](../README.md) / DetectInput

# Interface: DetectInput

Input accepted by `detect()`, which identifies the game instead of taking it from the caller.

## Properties

### host

> `readonly` **host**: `string`

DNS hostname or IP literal. URL syntax is intentionally not accepted.

***

### maxProbes?

> `readonly` `optional` **maxProbes?**: `number`

Distinct protocol and port pairs to probe, from 1 through 16; defaults to 8.

***

### mode?

> `readonly` `optional` **mode?**: [`QueryMode`](../type-aliases/QueryMode.md)

Mode of the query returned for the detected game; defaults to `"full"`.

***

### port?

> `readonly` `optional` **port?**: `number`

Port the caller knows, tried both as a query port and as a game port whose conventional query
port is derived from the registry. When omitted, each game's conventional ports are probed.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Caller cancellation propagated to every outstanding probe and query.

***

### timeoutMs?

> `readonly` `optional` **timeoutMs?**: `number`

Global deadline for probing and the final query together, from 1 through 30,000 ms; defaults
to 5,000 ms.
