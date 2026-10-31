[**queryhost**](../README.md)

***

[queryhost](../README.md) / ServerPlayers

# Interface: ServerPlayers

Player counts that are genuinely common across supported protocols.

## Properties

### max?

> `readonly` `optional` **max?**: `number`

***

### online?

> `readonly` `optional` **online?**: `number`

Players the server reports as connected. For A2S games this is A2S Info's player count
unchanged: QueryHost does not subtract bots, and Valve's engine counts bots in it, so
`online - data.bots` estimates connected humans.
