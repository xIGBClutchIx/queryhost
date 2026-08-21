# Rust profile fixture

This synthetic fixture is deterministic evidence for the first complete game profile. It contains no real server or player data.

- `info.hex` is a Source-format A2S Info response for a Rust server with common fields and comma-separated keywords.
- `players.hex` confirms two A2S Player records, including a negative score and fractional connection durations.
- `rules.hex` confirms four raw string rules. The profile keeps these names and values unchanged under `rawData.rules`.

Profile tests route all three packets through the same validated, pinned address. The fixture proves common-field merging, Rust-specific tags and players, raw-rule namespacing, source provenance, and the distinction between unavailable and confirmed-empty optional data.
