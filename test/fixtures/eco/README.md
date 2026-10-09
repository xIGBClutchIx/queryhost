# Eco fixtures

`frontpage.json` is a synthetic `GET /frontpage` body built from the `Info` field names and types
that GameDig's `eco` protocol and rust-gamedig's `eco` types read. It covers Unity rich-text
tags in the server name, a confirmed empty Discord address, and keys QueryHost does not retain
(`ShelfLifeMultiplier`, `ServerAchievementsDict`, `RelayAddress`, `DistributionStationItems`).
It does not contain data from a real server.

`frontpage-0.7.json` reproduces the server-info fields an Eco 0.7.8.6 beta server sent, as posted
in [StrangeLoopGames/EcoIssues#10331](https://github.com/StrangeLoopGames/EcoIssues/issues/10331).
It covers numeric enum ordinals for `Category` and `SkillSpecializationSetting`, the descriptive
`SkillSpecialization` string, and an integer `UniqueIdentifier` beyond JavaScript's safe range.
