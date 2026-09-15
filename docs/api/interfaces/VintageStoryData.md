[**queryhost**](../README.md)

***

[queryhost](../README.md) / VintageStoryData

# Interface: VintageStoryData

Vintage Story-specific fields disclosed by a server query answer.

## Properties

### gameMode?

> `readonly` `optional` **gameMode?**: `string`

World play style or game mode advertised by the server.

***

### motd?

> `readonly` `optional` **motd?**: `string`

Server message of the day; omitted when the server only confirms liveness.

***

### response

> `readonly` **response**: `"liveness"` \| `"status"`

Whether the server returned only stock liveness or the richer status schema.
