[**queryhost**](../README.md)

***

[queryhost](../README.md) / resolveQueryPort

# Function: resolveQueryPort()

> **resolveQueryPort**(`game`, `ports?`): `number` \| `undefined`

Returns the port `query()` sends its required source to for `game` and the given ports, using
the same registry convention: an explicit `queryPort` wins; otherwise the game port (or the
game's `defaultPort`) maps to the fixed query port, the port shifted by the conventional offset,
or the port itself for games without a separate query port.

Returns `undefined` when a given port is not an integer from 1 through 65535, when the game has
no default port and no `port` is given (generic `a2s`, whose destination is always `port`), or
when the offset moves a custom game port
outside that range; `query()` rejects those inputs as `INVALID_INPUT`. Minecraft: Java Edition
may still follow DNS SRV to another port when no explicit `port` is given, and its explicit
`queryPort` applies only to the optional UDP Query source.

Pure and browser-safe: it reads only [GAME\_REGISTRY](../variables/GAME_REGISTRY.md).

## Parameters

### game

[`GameInputId`](../type-aliases/GameInputId.md)

### ports?

[`QueryPortInput`](../interfaces/QueryPortInput.md) = `{}`

## Returns

`number` \| `undefined`

## Example

```ts
resolveQueryPort("rust"); // 28017
resolveQueryPort("rust", { port: 28_100 }); // 28102
resolveQueryPort("palworld", { port: 8_300 }); // 27015 (fixed)
resolveQueryPort("a2s"); // undefined: generic A2S has no default
```
