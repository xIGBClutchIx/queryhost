[**queryhost**](../README.md)

***

[queryhost](../README.md) / MinecraftCrossplayHint

# Interface: MinecraftCrossplayHint

Evidence that a Minecraft server also admits players from the other edition
through a bridge such as Geyser. It is inferred from data the server already
advertises, so a missing hint never proves that a server is single-edition.

## Properties

### bridge

> `readonly` **bridge**: `"geyser"`

Bridge software the evidence points to.

***

### evidence

> `readonly` **evidence**: `"query-plugins"` \| `"bedrock-sub-motd"`

Advertised data that matched: Java Query plugin names or the Bedrock sub-MOTD.
