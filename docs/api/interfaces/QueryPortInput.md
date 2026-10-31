[**queryhost**](../README.md)

***

[queryhost](../README.md) / QueryPortInput

# Interface: QueryPortInput

Port fields that decide a query's destination, as accepted by `query()`.

## Properties

### port?

> `readonly` `optional` **port?**: `number`

Game or service port players connect to; defaults to the game's `defaultPort`.

***

### queryPort?

> `readonly` `optional` **queryPort?**: `number`

Explicit query destination; always wins over the derived port when present.
