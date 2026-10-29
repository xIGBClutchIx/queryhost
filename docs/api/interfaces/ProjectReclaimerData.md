[**queryhost**](../README.md)

***

[queryhost](../README.md) / ProjectReclaimerData

# Interface: ProjectReclaimerData

Project Reclaimer (Halo 3) facts from the server-browser status answer.

## Properties

### blocksVpn?

> `readonly` `optional` **blocksVpn?**: `boolean`

Whether the server refuses players on a VPN, proxy, or hosting network.

***

### hostName?

> `readonly` `optional` **hostName?**: `string`

Name of the host or community running the server, separate from the server's own name.

***

### mapVariant?

> `readonly` `optional` **mapVariant?**: `string`

Forge map variant name, present when the map is a saved variant.

***

### maxPingMs?

> `readonly` `optional` **maxPingMs?**: `number`

Highest ping a joining player may have; omitted when the server sets no limit.

***

### mode?

> `readonly` `optional` **mode?**: `string`

Game type shown in the browser, such as `Capture the Flag` or `Firefight (Legendary)`.

***

### mods?

> `readonly` `optional` **mods?**: readonly [`ProjectReclaimerMod`](ProjectReclaimerMod.md)[]

Mods the server lists; omitted when it lists none.

***

### odst?

> `readonly` `optional` **odst?**: [`ProjectReclaimerOdst`](ProjectReclaimerOdst.md)

***

### players?

> `readonly` `optional` **players?**: readonly `string`[]

Connected player names; servers have been seen sending them only while players are on.

***

### ready?

> `readonly` `optional` **ready?**: `boolean`

Whether the server has finished preparing its map and can admit players.

***

### variant?

> `readonly` `optional` **variant?**: `string`

Game variant name.
