[**queryhost**](../README.md)

***

[queryhost](../README.md) / ServerInfo

# Interface: ServerInfo

Common server information shared across games.

Optional properties are omitted when a source cannot confirm them. Missing data is never
replaced with a misleading zero, `false`, or empty value.

## Properties

### map?

> `readonly` `optional` **map?**: `string`

***

### name?

> `readonly` `optional` **name?**: `string`

***

### password?

> `readonly` `optional` **password?**: `boolean`

***

### players?

> `readonly` `optional` **players?**: [`ServerPlayers`](ServerPlayers.md)

***

### queryRttMs?

> `readonly` `optional` **queryRttMs?**: `number`

Round-trip time for the primary query exchange, not ICMP latency.

***

### version?

> `readonly` `optional` **version?**: `string`
