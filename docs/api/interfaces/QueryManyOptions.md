[**queryhost**](../README.md)

***

[queryhost](../README.md) / QueryManyOptions

# Interface: QueryManyOptions

Batch-wide controls for `queryMany()`. Each input keeps its own deadline and signal.

## Properties

### concurrency?

> `readonly` `optional` **concurrency?**: `number`

Queries allowed in flight at once, from 1 through 64; defaults to 8.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Stops the batch: no further input is started, and queries already in flight resolve with
`ABORTED`. Every input not yet started is still read and yields its own `ABORTED` failure
entry (with `durationMs` 0 and no sources), so each input produces exactly one entry. Those
inputs are read only as fast as the consumer iterates, so with an unbounded input iterable,
stop iterating once the signal aborts.
