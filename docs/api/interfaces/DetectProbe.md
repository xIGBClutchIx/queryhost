[**queryhost**](../README.md)

***

[queryhost](../README.md) / DetectProbe

# Interface: DetectProbe

One protocol and port pair `detect()` planned, in the order it was prioritized.

## Properties

### error?

> `readonly` `optional` **error?**: `"ABORTED"` \| `"CONNECTION_FAILED"` \| `"DNS_FAILED"` \| `"INTERNAL_ERROR"` \| `"INVALID_INPUT"` \| `"MALFORMED_RESPONSE"` \| `"RESPONSE_TOO_LARGE"` \| `"TARGET_BLOCKED"` \| `"TIMEOUT"`

Present only when `status` is `failed`.

***

### port

> `readonly` **port**: `number`

***

### protocol

> `readonly` **protocol**: [`DetectProtocol`](../type-aliases/DetectProtocol.md)

***

### status

> `readonly` **status**: [`DetectProbeStatus`](../type-aliases/DetectProbeStatus.md)
