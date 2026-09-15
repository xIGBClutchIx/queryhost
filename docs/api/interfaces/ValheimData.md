[**queryhost**](../README.md)

***

[queryhost](../README.md) / ValheimData

# Interface: ValheimData

Valheim-specific data available from its direct Steam-backend A2S endpoint.

## Properties

### backend

> `readonly` **backend**: `"steam"`

A successful direct A2S response proves that the queried endpoint uses Steam discovery.

***

### networkVersion?

> `readonly` `optional` **networkVersion?**: `string`

Game build advertised through Valheim's A2S keyword field, when present.

***

### players?

> `readonly` `optional` **players?**: readonly [`ValheimPlayer`](ValheimPlayer.md)[]

Omitted when Player is unavailable; empty means the server confirmed no connections.
