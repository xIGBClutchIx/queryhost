[**queryhost**](../README.md)

***

[queryhost](../README.md) / EcoData

# Interface: EcoData

Eco world facts from the dedicated server's web `/frontpage` status page.

## Properties

### access?

> `readonly` `optional` **access?**: `string`

***

### activeAndOnlinePlayers?

> `readonly` `optional` **activeAndOnlinePlayers?**: `number`

***

### adminOnline?

> `readonly` `optional` **adminOnline?**: `boolean`

***

### animals?

> `readonly` `optional` **animals?**: `number`

***

### category?

> `readonly` `optional` **category?**: `string`

***

### detailedDescription?

> `readonly` `optional` **detailedDescription?**: `string`

Long server description with Unity rich-text tags removed.

***

### discordAddress?

> `readonly` `optional` **discordAddress?**: `string`

***

### economyDescription?

> `readonly` `optional` **economyDescription?**: `string`

***

### exhaustionAfterHours?

> `readonly` `optional` **exhaustionAfterHours?**: `number`

***

### external?

> `readonly` `optional` **external?**: `boolean`

***

### gamePort?

> `readonly` `optional` **gamePort?**: `number`

Game port advertised by the server; it may differ from the queried web port.

***

### joinUrl?

> `readonly` `optional` **joinUrl?**: `string`

***

### lan?

> `readonly` `optional` **lan?**: `boolean`

***

### language?

> `readonly` `optional` **language?**: `string`

***

### laws?

> `readonly` `optional` **laws?**: `number`

***

### limitingHours?

> `readonly` `optional` **limitingHours?**: `boolean`

Whether the server limits daily play time.

***

### maxActivePlayers?

> `readonly` `optional` **maxActivePlayers?**: `number`

Active-player setting reported by the server, as Eco defines it.

***

### meteor?

> `readonly` `optional` **meteor?**: `boolean`

Whether this world has a meteor countdown.

***

### paused?

> `readonly` `optional` **paused?**: `boolean`

***

### peakActivePlayers?

> `readonly` `optional` **peakActivePlayers?**: `number`

***

### plants?

> `readonly` `optional` **plants?**: `number`

***

### players?

> `readonly` `optional` **players?**: readonly `string`[]

Omitted when the server does not list names; empty means it confirmed nobody is online.

***

### playtimes?

> `readonly` `optional` **playtimes?**: `string`

***

### skillSpecialization?

> `readonly` `optional` **skillSpecialization?**: `string`

***

### timeLeftSeconds?

> `readonly` `optional` **timeLeftSeconds?**: `number`

Time left on the meteor countdown, as reported by the server.

***

### timeSinceStartSeconds?

> `readonly` `optional` **timeSinceStartSeconds?**: `number`

***

### totalPlayers?

> `readonly` `optional` **totalPlayers?**: `number`

Players who have joined this world at any time; Eco reports no slot limit here.

***

### webPort?

> `readonly` `optional` **webPort?**: `number`

Web port advertised by the server.

***

### worldSize?

> `readonly` `optional` **worldSize?**: `string`
