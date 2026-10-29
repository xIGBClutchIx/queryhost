[**queryhost**](../README.md)

***

[queryhost](../README.md) / QueryError

# Interface: QueryError

Stable public failure information; implementation exceptions are never exposed here.

## Properties

### code

> `readonly` **code**: `"ABORTED"` \| `"CONNECTION_FAILED"` \| `"DNS_FAILED"` \| `"INTERNAL_ERROR"` \| `"INVALID_INPUT"` \| `"MALFORMED_RESPONSE"` \| `"RESPONSE_TOO_LARGE"` \| `"TARGET_BLOCKED"` \| `"TIMEOUT"`

***

### message

> `readonly` **message**: `string`

***

### source?

> `readonly` `optional` **source?**: `"a2s-info"` \| `"a2s-player"` \| `"a2s-rules"` \| `"minecraft-srv"` \| `"minecraft-slp"` \| `"minecraft-legacy-ping"` \| `"minecraft-query"` \| `"minecraft-bedrock-raknet"` \| `"minecraft-bedrock-nethernet"` \| `"fivem-info"` \| `"fivem-dynamic"` \| `"fivem-players"` \| `"redm-info"` \| `"redm-dynamic"` \| `"redm-players"` \| `"satisfactory-lightweight"` \| `"satisfactory-health"` \| `"vintage-story-query"` \| `"eco-frontpage"` \| `"project-reclaimer-status"`
