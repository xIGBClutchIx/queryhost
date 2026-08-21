[**queryhost**](../README.md)

***

[queryhost](../README.md) / CanonicalGameId

# Type Alias: CanonicalGameId\<G\>

> **CanonicalGameId**\<`G`\> = `G` *extends* [`GameId`](GameId.md) ? `G` : `G` *extends* [`GameAlias`](GameAlias.md) ? [`GameAliasMap`](../interfaces/GameAliasMap.md)\[`G`\] : `never`

Canonical result identifier selected by a query input identifier.

## Type Parameters

### G

`G` *extends* [`GameInputId`](GameInputId.md)
