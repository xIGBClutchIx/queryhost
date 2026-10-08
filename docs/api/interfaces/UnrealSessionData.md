[**queryhost**](../README.md)

***

[queryhost](../README.md) / UnrealSessionData

# Interface: UnrealSessionData

Session facts Unreal Engine's Steam integration advertises in A2S keywords and Rules. Each is
present only when the server sends it; Rules take precedence over keywords.

## Extended by

- [`InsurgencySandstormData`](InsurgencySandstormData.md)
- [`HumanitZData`](HumanitZData.md)
- [`ArkSurvivalEvolvedData`](ArkSurvivalEvolvedData.md)
- [`ConanExilesData`](ConanExilesData.md)
- [`DayOfDragonsData`](DayOfDragonsData.md)
- [`SoulmaskData`](SoulmaskData.md)
- [`IcarusData`](IcarusData.md)
- [`AbioticFactorData`](AbioticFactorData.md)

## Properties

### buildId?

> `readonly` `optional` **buildId?**: `number`

Build compatibility ID from `BUILDID`; clients must match it to join.

***

### openPublicSlots?

> `readonly` `optional` **openPublicSlots?**: `number`

Open public connection slots from `NUMOPENPUBCONN`.

***

### sessionFlags?

> `readonly` `optional` **sessionFlags?**: [`UnrealSessionFlags`](UnrealSessionFlags.md)
