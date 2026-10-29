[**queryhost**](../README.md)

***

[queryhost](../README.md) / QueryWarning

# Interface: QueryWarning

Non-fatal condition attached to a successful query.

## Properties

### code

> `readonly` **code**: `"PARTIAL_RESULT"` \| `"PLAYER_LIST_UNAVAILABLE"` \| `"SOURCE_BLOCKED"` \| `"SOURCE_FAILED"` \| `"SOURCE_MALFORMED"` \| `"SOURCE_TIMEOUT"`

***

### message

> `readonly` **message**: `string`

***

### source?

> `readonly` `optional` **source?**: `"a2s-info"` \| `"a2s-player"` \| `"a2s-rules"` \| `"minecraft-srv"` \| `"minecraft-slp"` \| `"minecraft-legacy-ping"` \| `"minecraft-query"` \| `"minecraft-bedrock-raknet"` \| `"minecraft-bedrock-nethernet"` \| `"fivem-info"` \| `"fivem-dynamic"` \| `"fivem-players"` \| `"redm-info"` \| `"redm-dynamic"` \| `"redm-players"` \| `"satisfactory-lightweight"` \| `"satisfactory-health"` \| `"vintage-story-query"` \| `"eco-frontpage"` \| `"project-reclaimer-status"`
