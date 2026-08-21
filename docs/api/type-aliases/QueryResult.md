[**queryhost**](../README.md)

***

[queryhost](../README.md) / QueryResult

# Type Alias: QueryResult\<G\>

> **QueryResult**\<`G`\> = `G` *extends* [`GameId`](GameId.md) ? [`QuerySuccess`](../interfaces/QuerySuccess.md)\<`G`\> : `never` \| [`QueryFailure`](../interfaces/QueryFailure.md)\<`G`\>

Success remains correlated by game; failure needs no game-specific data correlation.

## Type Parameters

### G

`G` *extends* [`GameId`](GameId.md) = [`GameId`](GameId.md)
