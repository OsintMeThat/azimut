# Sheet fixtures

The pathologies of three real investigation binders, distilled into files a test can
read. **Synthetic and anonymous on purpose**: the binders themselves are case material,
so no name, no unit, no place and no URL from them appears here — what is kept is the
*shape* of the mess, which is the only part a parser cares about.

| File | What it is there to break |
|---|---|
| `binder-semicolon.csv` | A European export: semicolon-separated, comma decimals, a quoted cell holding a comma, `dd/MM/yyyy` dates, `#REF!` where a formula died. |
| `binder-worklist.csv` | A geolocation worklist with **no status column at all** — its progress is the fill rate of `Coordinates`, and its cells hold three coordinate formats plus `To be found`. |
| `binder-timeline.csv` | An event timeline: a bare `hh:mm` local time with no date, an hour note in prose, a multi-value equipment cell with a quantity, and mostly empty rows. |
| `binder-states.csv` | The eight words a real binder used for one status column, so a state vocabulary is tested against words nobody would invent. |

Any test asserting "the app reads the real thing" belongs here rather than against a
table written to suit the code.
