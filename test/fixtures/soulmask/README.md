# Soulmask profile fixture

This synthetic fixture contains no real server or player data.

- `info.hex` reports the placeholder A2S Info version `1.0.0.0` that Soulmask servers advertise regardless of build.
- `players.hex` confirms one Player record.
- `rules.hex` carries the game build in the `NO_s` rule alongside another string rule.

The profile tests prove that a present `NO_s` rule replaces the placeholder Info version, while Info's version remains when Rules is skipped or unavailable. The `NO_s` convention is corroborated by GameDig's Soulmask handling in [`protocols/valve.js`](https://github.com/gamedig/node-gamedig/blob/master/protocols/valve.js).
