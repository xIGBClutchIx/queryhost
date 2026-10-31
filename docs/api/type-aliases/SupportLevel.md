[**queryhost**](../README.md)

***

[queryhost](../README.md) / SupportLevel

# Type Alias: SupportLevel

> **SupportLevel** = *typeof* [`SUPPORT_LEVELS`](../variables/SUPPORT_LEVELS.md)\[`number`\]

Whether a profile can return a capability's data:

- `supported`: returned whenever the profile's required source answers.
- `conditional`: returned only when server configuration, server build, or an optional source
  allows it; otherwise the field is omitted.
- `unsupported`: never returned by this profile.
