# Azimut v0.2.8

## OSINT toolkit at a glance

- **Sources:** import or download media, preserve hashes and provenance, inspect
  frames, crops, collages, panoramas and ELA, then prepare reverse-image
  searches.
- **Maps and sky:** convert coordinates, geocode places, capture and compare
  imagery, review AOI grids, and calculate local sun and moon conditions
  offline.
- **Evidence:** organise media, places, proofs and notes in portable cases with
  folders, relations, Markdown notebooks and PDF exports.
- **Analysis:** read the same case as a table, as a drawing or on a time axis,
  with statements, sources and confidence kept apart.
- **Publishing:** build annotated Geo Proofs and prepare evidence-linked Geo
  Reports for X, Bluesky or Mastodon without posting automatically.

## What changed in v0.2.8

The case stops being only a pile of files. Everything it holds is a typed
entity, and three surfaces now read the same case: a table, a drawing and a
time axis.

### Board

- **A row per entity, whatever its type.** A person, an account or a statement
  had no screen before.
- **One filter bar:** a search, a **+ Filter** menu and a removable chip per
  term. Every value offered comes from the case, with its count.
- **Search+ names the field that matched** under the row, so a vehicle found by
  its plate is not an unexplained result. Totals read against the whole case.
- **New entity builds its form from the type registry** and flags an identifier
  the case already holds, with the existing row one click away.
- **Board and Graph share one filter and one family of saved views.** Timeline
  keeps its own, because tracks and a clock are not something a table can draw.

### Graph

- **Lenses decide what the drawing is about.** Nodes cluster, and every edge
  states its direction and its verb.
- **Expand, Collapse and Hide are explicit acts**, with `Ctrl+Z` on the drawing
  and no writes to the case.
- **A question worked out in the Board is drawn here.** The filter travels
  rather than the rows it matched.
- **Sources fold onto the edge they stand for**, and derivation, support, source
  and account counts sit on the node.

### Timeline

- **A windowed UTC axis**, read 200 entries at a time, with a density histogram
  keeping the whole chronology visible underneath.
- **Any zone's clock**, named rather than offered as an offset, plus daylight
  under the ruler for a place the case has saved.
- **Date quality is drawn, not flattened:** points, bars, reduced dates over the
  period their precision covers, dashed edges for approximate ones.
- **Tracks** come from editable presets or a Search+ question, with colours,
  folds, reordering and grouping.
- **Dates can be created and edited on the axis**, and two entries measured
  without turning a coarse date into an exact one.
- **Views keep a reading.** Live autosaves its window, clock and tracks; a
  Snapshot freezes up to 5,000 rows and opens read-only.
- **Undated work stays visible**, and the date a fact entered Azimut never
  masquerades as the date of the fact.

### One period, four surfaces

- **A window travels.** Timeline hands its period to Board, Graph and a
  session-only map layer, which state it with the way back and a Clear.
- **Fact time never mixes with filing time.** The window narrows the page, the
  totals and a saved view alike, and leaves the "when was this filed" filters
  alone.

### Statements, sources and confidence

- **Relations, Mentions, Claims and lineage stay separate** in Details, under
  one validated verb registry.
- **How sure and how reliable are two controls that never merge**, with the
  source's Admiralty grade stated beside the name it belongs to.
- **Sources, Supports and Contradictions read from the right end**, and
  statements about a row add up before they list.
- **A guided editor dates a statement**, from a year to a bounded or zoned
  range, choosing precision, certainty and timezone separately. The raw syntax
  is still accepted.

### Storage

- **Cases upgrade to SQLite schema 17 when they open**, including the derived
  time projection Case Doctor checks.
- **A case bundle exported by v0.2.7 still imports** and lands on the current
  schema.

## Install or upgrade

Download the ready-to-run asset for Windows x86_64, Linux x86_64 or Apple
Silicon macOS and run it. Each binary includes the browser UI, `ffmpeg`,
`ffprobe` and the fonts used for note PDFs.

Intel Macs require macOS 14 or newer and the Python package:
`pipx install azimut` or `pip install azimut`.

The binaries are unsigned. Follow the operating system prompt described in the
README on first launch.

Existing cases upgrade in place when they open. Older case bundles remain
importable, and no manual export or migration is required.
