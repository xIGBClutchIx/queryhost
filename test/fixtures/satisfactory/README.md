# Satisfactory fixtures

`lightweight.hex` is a deterministic version-1 Server State Response assembled from the field
layout in Coffee Stain's shipped `CommunityResources/DedicatedServerAPIDocs.md`, mirrored by the
[Official Satisfactory Wiki](https://satisfactory.wiki.gg/wiki/Dedicated_servers/Lightweight_Query_API).
It covers a
playing, modded server, known and future substate IDs, and a UTF-8 server name. The cookie is
`0x0102030405060708`.

`health.json` follows the current lower-camel response casing emitted by the Dedicated Server
HTTPS API for an authentication-free `HealthCheck` request. Both fixtures are synthetic and do not
contain data from a real server.
