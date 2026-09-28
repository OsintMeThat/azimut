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

## The Case workspace

| File | What it is there to break |
|---|---|
| `case-workspace-0.3.1.json` | How the Board, Graph and Timeline read a case left the way a 0.3.1 analyst leaves one: saved readings of each surface, Live and Snapshot, in both Timeline modes, with Media tracks, hides and pins; dated, undated and unplaced Claims; a kept Detect pin and a proof date; Notebook mentions, a promoted Sheet row and galleries. Ids are written `type:label` and the moment of the build is scrubbed. |

Written by `tests/caseworkspace.py`, never by hand, and compared by
`tests/test_case_workspace_fixture.py`; `frontend/src/lib/caseWorkspaceFixture.test.js`
reopens its saved views through the parsers the three surfaces use. A change that
means to alter a reading rewrites it with `AZIMUT_WRITE_GOLDEN=1 uv run pytest
tests/test_case_workspace_fixture.py`, and the diff is that change's account of what
reads differently.

## Search folding

| File | What it is there to break |
|---|---|
| `fold_cases.json` | What a search folds and what it keeps, one line per case: Latin, Greek and Cyrillic accents, Arabic harakat and the tatweel, Hebrew points go; a Devanagari sign, a dakuten, the Hebrew maqaf and the punctuation of an email, a network or a handle stay. |

Written by hand. Read by `tests/test_textfold.py` against `engine/textfold.py` and by
`frontend/src/lib/textFold.test.js` against `lib/textFold.js`, so the server's index
and the browser's in-memory search cannot fold one text two ways.
