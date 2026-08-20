# Project Zomboid fixtures

These synthetic packets describe a fictional server and contain no live-server data. They
exercise Source A2S Info, Player, and Rules responses independently of the Rust fixtures.

The Rules keys mirror Project Zomboid server options that the profile deliberately interprets:
`PublicDescription`, `PVP`, `PauseEmpty`, and the semicolon-delimited `Mods` list. An extra
`WorkshopItems` value proves that uninterpreted rules remain available in the raw rule map.
