[**queryhost**](../README.md)

***

[queryhost](../README.md) / query

# Function: query()

> **query**\<`G`\>(`input`): `Promise`\<[`QueryResult`](../type-aliases/QueryResult.md)\<[`CanonicalGameId`](../type-aliases/CanonicalGameId.md)\<`G`\>\>\>

Queries one game server through its typed QueryHost profile.

Query failures resolve as a [QueryFailure](../interfaces/QueryFailure.md) with a stable error code. Input that
bypasses the declared type from JavaScript, such as an unregistered `game`, resolves with
`INVALID_INPUT` and echoes the supplied `game` value unchanged.

## Type Parameters

### G

`G` *extends* [`GameInputId`](../type-aliases/GameInputId.md)

## Parameters

### input

[`QueryInput`](../type-aliases/QueryInput.md)\<`G`\>

## Returns

`Promise`\<[`QueryResult`](../type-aliases/QueryResult.md)\<[`CanonicalGameId`](../type-aliases/CanonicalGameId.md)\<`G`\>\>\>
