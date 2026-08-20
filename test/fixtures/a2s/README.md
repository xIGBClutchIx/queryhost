# A2S Info fixtures

These hex transcriptions are immutable parser evidence. Tests decode whitespace-separated byte pairs; changing existing bytes requires adding a new fixture or documenting why the old packet was invalid.

- `challenge-captured.hex` is the nine-byte challenge captured from the public DayZ server documented in John Hobbs's “DayZ Server Browsers” article on May 23, 2024.
- `source-captured-redacted.hex` is derived from that article's captured Source response. The server name, Steam ID, and keywords were replaced while the field order, field widths, counts, EDF value, port, game ID, and other protocol facts were retained.
- `source-tv.hex` is a synthetic Source response that isolates the SourceTV EDF field and the post-Orange Box macOS environment byte.
- `goldsource-mod.hex` is a synthetic legacy GoldSource response with the optional mod block. It contains no real server or player data.
- `goldsource-basic.hex` is a synthetic legacy response without a mod block and uses the pre-Orange Box macOS environment byte.

Source capture: <https://velvetcache.org/2024/05/23/dayz-server-browsers/>
