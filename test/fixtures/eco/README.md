# Eco fixtures

`frontpage.json` is a synthetic `GET /frontpage` body built from the `Info` field names and types
that GameDig's `eco` protocol and rust-gamedig's `eco` types read. It covers Unity rich-text
tags in the server name, a confirmed empty Discord address, and keys QueryHost does not retain
(`ShelfLifeMultiplier`, `ServerAchievementsDict`, `RelayAddress`, `DistributionStationItems`).
It does not contain data from a real server.
