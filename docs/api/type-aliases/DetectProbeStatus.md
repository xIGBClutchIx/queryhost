[**queryhost**](../README.md)

***

[queryhost](../README.md) / DetectProbeStatus

# Type Alias: DetectProbeStatus

> **DetectProbeStatus** = `"matched"` \| `"answered"` \| `"failed"` \| `"cancelled"` \| `"skipped"`

Outcome of one probe. `matched` answered and decided the result; `answered` also answered but
finished after the match; `cancelled` started and was stopped because another probe matched;
`skipped` never ran because the probe or time budget was spent first.
