[**queryhost**](../README.md)

***

[queryhost](../README.md) / SatisfactoryRawData

# Interface: SatisfactoryRawData

Parsed protocol fields retained separately from normalized Satisfactory data.

## Properties

### health?

> `readonly` `optional` **health?**: [`SatisfactoryHealth`](SatisfactoryHealth.md)

Omitted when the optional HTTPS source did not complete.

***

### serverFlags

> `readonly` **serverFlags**: `string`

***

### stateCode

> `readonly` **stateCode**: `1` \| `2` \| `3`

***

### subStates

> `readonly` **subStates**: readonly [`SatisfactorySubState`](SatisfactorySubState.md)[]
