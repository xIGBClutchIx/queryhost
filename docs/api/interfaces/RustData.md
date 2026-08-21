[**queryhost**](../README.md)

***

[queryhost](../README.md) / RustData

# Interface: RustData

Rust-specific data collected from A2S sources.

## Properties

### players?

> `readonly` `optional` **players?**: readonly [`RustPlayer`](RustPlayer.md)[]

Omitted when Player is skipped or unavailable; empty means the server confirmed no players.

***

### tags?

> `readonly` `optional` **tags?**: readonly `string`[]

Server-advertised tags, when the info response provides them.
