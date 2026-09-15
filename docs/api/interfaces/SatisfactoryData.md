[**queryhost**](../README.md)

***

[queryhost](../README.md) / SatisfactoryData

# Interface: SatisfactoryData

Satisfactory-specific facts from its dedicated-server status APIs.

## Properties

### health?

> `readonly` `optional` **health?**: `"healthy"` \| `"slow"`

Omitted in summary mode, while loading, or when the optional HTTPS source fails.

***

### modded

> `readonly` **modded**: `boolean`

***

### serverNetCl

> `readonly` **serverNetCl**: `number`

Dedicated server network changelist.

***

### state

> `readonly` **state**: [`SatisfactoryServerState`](../type-aliases/SatisfactoryServerState.md)
