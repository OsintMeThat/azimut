# Fixtures

## Sheet fixtures

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

## Map sites

| File | What it is there to break |
|---|---|
| `map-sites.raw.json` | The observation: every URL nine map sites wrote about themselves after a known gesture, with the window they were driven in. Nothing in it has been parsed. |
| `map-sites.json` | The same run, parsed by `engine/mapsites.py` and solved for where each site draws its camera. Apple's stale `z`, Google's satellite height in metres, Yandex's longitude-first order, and the five sites that draw their centre somewhere other than the middle of the window. |

Read from both sides: `tests/test_mapsites.py` checks the parse still returns those
views, `frontend/src/lib/extensionMapFrame.test.js` that the extension's arithmetic
puts them back where the browser had them. `docs/MAP_SITES.md` is the prose version.

Neither file is written by hand. `npm run calibrate:maps` drives the sites again and
rewrites the raw one; `python scripts/build_map_fixture.py` turns that into the other.
The protocol both follow is `frontend/calibration/protocol.mjs`, and it is itself tested
against a map whose layout is known (`frontend/e2e/map-calibration.spec.js`).
