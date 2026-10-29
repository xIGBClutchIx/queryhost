[**queryhost**](../README.md)

***

[queryhost](../README.md) / ProjectReclaimerMod

# Interface: ProjectReclaimerMod

A mod a Project Reclaimer server lists in its server-browser status.

## Properties

### customization?

> `readonly` `optional` **customization?**: `boolean`

Whether the mod supplies character customization.

***

### id

> `readonly` **id**: `string`

Content identifier of the mod.

***

### maps?

> `readonly` `optional` **maps?**: readonly [`ProjectReclaimerModMap`](ProjectReclaimerModMap.md)[]

***

### required?

> `readonly` `optional` **required?**: `boolean`

Whether a player must have the mod to join.

***

### shared?

> `readonly` `optional` **shared?**: `boolean`

Whether the server sends the mod's files to joining players that lack them.

***

### sizeBytes?

> `readonly` `optional` **sizeBytes?**: `number`

***

### title?

> `readonly` `optional` **title?**: `string`
