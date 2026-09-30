[**queryhost**](../README.md)

***

[queryhost](../README.md) / Arma3Dlc

# Interface: Arma3Dlc

One official Arma 3 DLC the server advertises as required content.

## Properties

### appId?

> `readonly` `optional` **appId?**: `number`

Steam App ID of a recognized DLC.

***

### flag

> `readonly` **flag**: `number`

Bit set in the server's 16-bit DLC mask.

***

### hash

> `readonly` **hash**: `number`

Unsigned 32-bit short hash advertised by the server.

***

### name?

> `readonly` `optional` **name?**: `string`

Known DLC name; omitted for a mask bit QueryHost does not recognize.
