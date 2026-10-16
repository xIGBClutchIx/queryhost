# Minecraft Bedrock fixtures

`pong.hex` is a synthetic RakNet unconnected-pong response with a fixed timestamp and server GUID. It exercises UTF-8 text, player counts, the unsigned decimal server identifier, game mode, and advertised IPv4 and IPv6 ports.

The pong values were constructed from the public RakNet advertisement layout and contain no live-server or personal data.

## NetherNet status

`nethernet.json` preserves the status fields returned by `GET /v1/join` on the
user-provided public Bedrock server `185.156.47.231:19132` on 2026-10-16.
The response was queried through QueryHost's pinned HTTP transport after RakNet
timed out. It advertised protocol 2193 and version 1.26.52.

Wire contract: <https://mojang.github.io/bedrock-protocol-docs/guides/nether-net-onboarding-guide/#capability-check-and-server-info>.
