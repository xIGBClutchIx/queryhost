[**queryhost**](../README.md)

***

[queryhost](../README.md) / QuerySource

# Interface: QuerySource

Provenance report for one attempted, skipped, or unavailable source.

## Properties

### rttMs?

> `readonly` `optional` **rttMs?**: `number`

Source-specific exchange time when an exchange completed.

***

### source

> `readonly` **source**: `"a2s-info"` \| `"a2s-player"` \| `"a2s-rules"` \| `"minecraft-srv"` \| `"minecraft-slp"` \| `"minecraft-legacy-ping"` \| `"minecraft-query"` \| `"minecraft-bedrock-raknet"` \| `"minecraft-bedrock-nethernet"` \| `"fivem-info"` \| `"fivem-dynamic"` \| `"fivem-players"` \| `"redm-info"` \| `"redm-dynamic"` \| `"redm-players"` \| `"satisfactory-lightweight"` \| `"satisfactory-health"` \| `"vintage-story-query"` \| `"eco-frontpage"` \| `"project-reclaimer-status"`

***

### status

> `readonly` **status**: `"ok"` \| `"timeout"` \| `"blocked"` \| `"malformed"` \| `"unsupported"` \| `"not-requested"` \| `"failed"`
