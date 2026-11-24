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
| `map-site-hosts.json` | Which addresses are maps at all: one per site, and the near misses (Google search, Bing search, Yandex images, a `/maps` path on another host). Written by hand, and read by both copies of the hosts: `engine/mapsites.py` and the extension's `mapsites.js`, which decides inside a toolbar press. |

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

## Inspect's scenes

| File | What it is there to break |
|---|---|
| `inspect-work-one-moment.json` | A file's scenes to geolocate, each holding one moment (an instant, a passage, the whole video, one with captures, one abandoned), saved, written by the server and saved again. A scene may now hold several moments (`more`), and one holding one must still be written byte for byte as before. |

Written by the steps of `tests/onemoment.py` on the code from before `more`, compared by
`tests/test_scene_moments.py` with the moment of writing scrubbed. `AZIMUT_WRITE_GOLDEN=1`
rewrites it, and only a change meant to alter how every work is written should.

## Search folding

| File | What it is there to break |
|---|---|
| `fold_cases.json` | What a search folds and what it keeps, one line per case: Latin, Greek and Cyrillic accents, Arabic harakat and the tatweel, Hebrew points go; a Devanagari sign, a dakuten, the Hebrew maqaf and the punctuation of an email, a network or a handle stay. |

Written by hand. Read by `tests/test_textfold.py` against `engine/textfold.py` and by
`frontend/src/lib/textFold.test.js` against `lib/textFold.js`, so the server's index
and the browser's in-memory search cannot fold one text two ways.

## Proof templates

| File | What it is there to break |
|---|---|
| `proof-templates-0.3.3.json` | A `templates.json` as 0.3.3 writes it: one house style that uses every key the editor holds without showing (a dragged logo's offsets and ratios, a handle's opacity, a stack direction kept under free layout) and one written before most keys existed. Read by `tests/test_templates_api.py`, which saves both back byte for byte, and by `frontend/src/components/ProofTemplateEditor.render.test.js`, which opens them in the editor and saves them untouched. |
| `post-templates-0.3.3.json` | A `templates.json` as 0.3.3 writes its thread layouts: one using every token of the time with two boilerplate posts and no media post, one bare. Neither carries a `kind` or a `reply`. Read by `tests/test_templates_api.py`, which saves both back byte for byte, and by `frontend/src/components/PostTemplateEditor.render.svelte.test.js`, which opens them as Geolocation templates. |

## Note styles

| File | What it is there to break |
|---|---|
| `note-styles.json` | What each note style carries when nobody changed it: the sources list, how its sources are written, the five annexes and how strictly its links are checked. Written from `engine/notelook.py` (`PROFILES`), the one place Azimut decides it. |

Read by `tests/test_notes_profiles.py` against `PROFILES` and by
`frontend/src/lib/notes/look.test.js` against `STYLE_DEFAULTS`, so the Look and Settings
never show a default the documents do not print.

## A note's own sources

| File | What it is there to break |
|---|---|
| `own-sources.json` | Which notes have a list of sources of their own: a heading named Sources or References at any level, numbered, bold or with a colon, and the near misses (*Sources of funding*, a quoted or listed heading, one in code, a setext one). Written by hand. |

Read by `tests/test_notes_profiles.py` against `notes_markdown.own_sources` and by
`frontend/src/lib/notes/look.test.js` against `ownSources`, so the Look never says a note
ends on its own section while the document prints the generated list.

## Footnotes

| File | What it is there to break |
|---|---|
| `footnotes.json` | Where a line marks a footnote (`^[words]`) and the words of each: brackets that balance around a link or a `[sic]`, an escaped `\^[` or `\]`, code inside and around, one never closed, one nested, an empty one. Written by hand. |

Read by `tests/test_notes_footnotes.py` against the parser and `notetext.footnote_spans`, and
by `frontend/src/lib/notes/footnotes.test.js` against `findFootnotes`, so the Notebook draws a
letter exactly where every document prints one.

## Collage seams

| File | What it is there to break |
|---|---|
| `collage-seams.json` | Where stitched pieces meet: a pan of three frames at three heights with a picture laid by hand among them, and a frame drawn three times larger over one whose corners its warp left empty. Each stitched piece's cell, and points naming the piece the saved picture shows there, the one plain stacking showed and the cell's owner. |

Written by `tests/seamscene.py`, which works each point out from the rule one at a time, and
compared by `tests/test_collage_seams.py`, which also composes the pictures and reads the
colours back. `frontend/src/lib/seams.test.js` checks the canvas hides the same parts of each
piece. `AZIMUT_WRITE_GOLDEN=1` rewrites it, and only a change meant to move a seam should.
