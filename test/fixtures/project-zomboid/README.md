# Project Zomboid fixtures

These synthetic packets describe a fictional server and contain no live-server data. They
exercise Source A2S Info, Player, and Rules responses independently of the Rust fixtures.

The Rules keys mirror a live Project Zomboid 42.20 response: lowercase `description`, `pvp`, and
`mods`, numeric booleans, and the additional `modCount`, `open`, `public`, and `version` facts that
remain available in the raw rule map.
