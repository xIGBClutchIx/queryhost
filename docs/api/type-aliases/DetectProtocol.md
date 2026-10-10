[**queryhost**](../README.md)

***

[queryhost](../README.md) / DetectProtocol

# Type Alias: DetectProtocol

> **DetectProtocol** = `Exclude`\<[`GameProtocol`](GameProtocol.md), `"a2s-unreal"`\>

Protocol a probe speaks. Unreal Engine A2S games answer the same A2S request, so `a2s-unreal`
is probed as `a2s`.
