[**queryhost**](../README.md)

***

[queryhost](../README.md) / detect

# Function: detect()

> **detect**(`input`): `Promise`\<[`DetectResult`](../type-aliases/DetectResult.md)\>

Identifies which supported game a server runs, then queries it as that game.

Probes are derived from `GAME_REGISTRY`: each distinct protocol and port pair the registry's
conventions allow for `port` (or, without one, every game's conventional query port) is ranked
by how many games use it, with `port` read as a game port before it is read as a query port,
and at most `maxProbes` of them run, four at a time. The first probe
that answers decides the protocol; the server's advertised Steam App ID or Cfx `gamename`, or a
port only one game uses, then picks the game. The remaining probes are cancelled, and the
detected game's query reuses the probe's answer or the address it already resolved.

Every planned probe is reported in `probes`, including those skipped by the budget. Invalid
input resolves as `INVALID_INPUT`, and a host where nothing answered as `NOT_DETECTED`.

## Parameters

### input

[`DetectInput`](../interfaces/DetectInput.md)

## Returns

`Promise`\<[`DetectResult`](../type-aliases/DetectResult.md)\>

## Example

```ts
const detected = await detect({ host: "play.example.com", port: 27015 });
if (detected.ok && detected.result.ok) {
  console.log(detected.game, detected.result.server.name);
}
```
