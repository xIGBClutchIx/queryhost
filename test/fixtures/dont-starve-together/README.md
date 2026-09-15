# Don't Starve Together profile fixture

These packets are deterministic synthetic A2S fixtures. They contain no real server or player data and are not evidence that DST assigns semantic meaning to any Rules key.

- `info.hex` exercises the Source Info fields DST can expose on a shard's Steam query port, including the 16-bit App ID field, full Steam game ID, and tags.
- `players.hex` confirms two optional Player records.
- `rules.hex` confirms that string-valued Rules remain untouched under `rawData.rules` instead of being guessed into DST fields.

Profile tests send all packets to one validated, pinned address. Port tests separately prove that DST's independently configured Steam port defaults to 27016 even when the gameplay port changes.
