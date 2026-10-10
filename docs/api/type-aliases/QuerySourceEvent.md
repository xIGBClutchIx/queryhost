[**queryhost**](../README.md)

***

[queryhost](../README.md) / QuerySourceEvent

# Type Alias: QuerySourceEvent

> **QuerySourceEvent** = \{ `source`: [`QuerySourceName`](QuerySourceName.md); `type`: `"started"`; \} \| \{ `report`: [`QuerySource`](../interfaces/QuerySource.md); `type`: `"completed"`; \}

Progress for one source of a running query, delivered through `QueryInput.onSource`.

`started` fires before a source's network work begins. `completed` carries the same report that
appears in the result's `sources`; skipped and unsupported sources complete without starting.
