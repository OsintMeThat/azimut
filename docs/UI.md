# Azimut UI and UX reference

This document defines the interface structure and visual language. Feature
phasing lives in [SPEC.md](SPEC.md).

## Layout anatomy

```
┌ topbar: rose+wordmark · case switcher · (spacer) · settings gear · sidebar toggle ┐
├ rail ┬ tab strip (only when the workspace has several tools) ┬ case sidebar ┤
│      │ tool canvas                                           │              │
└──────┴───────────────────────────────────────────────────────┴──────────────┘
```

## Workspace model (UX)

The rail holds a fixed set of workspaces in investigation order. Tools register
in `frontend/src/lib/workspaces.js` and appear as tabs, never as new rail entries.

| Workspace | Tools today | Future tools land here |
|---|---|---|
| **Sources** | Media Library, Files, Reverse Search | Channel Monitor, Evidence Locker |
| **Examine** | Inspect (Selection / Frame / Collage / Analyze) | EXIF, Edit Provenance, Shot contact sheet, OCR, Image Compare, Hints, Shadow Clock, audio |
| **Map** | Satellite, Coordinates | **one map, many modes**: Compare, Imagery Wayback, Event layers, Ground Imagery, Measures, Viewshed, OSM Query, Map Board |
| **Compose** | Geo Proof, Geo Report, Notebook | Report Builder, GIF maker |
| *(Case)* | Sidebar | v2: Relations, Sheet; v4: Notes, Timeline; v5: Orchestrator |

Rules:

- Use at most two levels: workspace → tab.
- `uiState.tool` is authoritative. The active workspace is derived from it, so
  cross-tool handoffs do not need workspace logic. Each workspace remembers its
  last-used tab.
- Deep links use `#<tool>`, `#<workspace>` or `#<workspace>/<tool>`.
- Artifact actions can open a tool, locate a place or add an item to a proof.
- Settings is app plumbing: behind the topbar gear, not on the rail.

## Case sidebar

The sidebar has three zones: a fixed header, one scrolling body, and a details
drawer over both. Tools keep their own saved-artifact lists; the sidebar does not
duplicate them. Its left edge resizes from 240 to 640 px, capped at half the
window. Double-click resets the persisted width.

The sidebar defaults to collapsed in Map and open elsewhere. Open state is
remembered per workspace for the current session. Reloading restores the defaults.

- **Header** — the case name (its id is a tooltip), a **Notes** button opening
  `notes.md` in the Notebook, a search field, and one filter chip per entity type
  present, counted from the catalog summary. The chips wrap; past the fifth they
  fold behind `+N`, and the active one always shows.
- **Body** — one rule: no filter shows the tree, a query or a chip shows a flat
  result list. A filtered tree would have to badge folders with per-type counts
  the summary cannot give, so the modes are exclusive. Result rows carry their
  folder as meta, and clearing the filter restores the tree with the same folders
  still open. Search matches labels (plus folder and type in a case small enough
  to filter in memory), not note contents — the **Files** tab searches those.
  Browse order is **Suggestions** (tool-proposed entities to confirm or dismiss,
  a node only when non-empty), the analyst's nested folders, then the **Unfiled**
  inbox. `+ Folder` and `+ Note` sit above them.
- **Filing** — drag rows onto a folder, or drop them on Unfiled to unfile.
  Ctrl/cmd-click and shift-click select several rows first, and the drag carries
  all of them; folders are targets, never cargo. The tree scrolls itself when the
  pointer nears an edge mid-drag, since a native drag swallows the wheel.
  Unfiling does not delete data. The **Files** tab presents the same tree with
  tiles, multi-select and context actions.
- **Details** — a drawer over the sidebar, closed with the back arrow or Escape,
  so selecting a row never pushes the case out of view. It edits an artifact's
  preview, title, notes, provenance, derivation chain and folder, and provides
  open, locate and delete actions. The sidebar and Media Library modal share
  `EntityDetails.svelte`.

## Map

Saved work — places, captures and screenshots filed by the extension — lives in
one right-hand **Saved** panel, grouped by geography rather than by date. The
tree's depth follows the case: one country opens straight on its regions, a
worldwide case opens on continents. A filter and an
`All / Places / Captures | Proofs` switch stay pinned above it; a screenshot
counts as a capture. The first three positions filter, and `All` shows
everything: a proof usually stands on the capture it composes, so that capture
wears a dot rather than carrying a second mark. **Proofs** past the rule is a
mode — it swaps the panel to the proofs index (`GET /proofs/index`, read the first time
that position is opened) and hides places and captures so the two never stack.
A proof is placed by the coordinates written in its own spec — the composer's
coordinate field first, then the point its panels gave it — and only failing
that by every capture it composes, which is why deleting a capture does not
unpin the proofs built on it. A proof is filed in My work like any other
artifact, so the folder grouping works there too; **Locate** does not appear,
since a proof states or borrows its point and the pass has nothing to look up.
Items with
no country collect under **Unlocated**, where **Locate** looks them up a batch at
a time and can be stopped mid-pass. Its left edge resizes from 260 to 560 px,
capped at 40% of the window, and the width is remembered locally.

Branches read `English (native)` — `Russia (Россия)` — and search matches either
spelling. Proofs and posts keep the native name only.

Saving a place or a capture resolves its country as part of the save, so the item
appears already grouped. Offline it lands under Unlocated for a later Locate.

A globe/folder switch beside the filter regroups the same set by My-work folder:
the case's whole folder tree, empty folders included, with unfiled items under
**Unfiled**. The filter and the kind switch keep working, counts cover the whole
subtree, and the mode is remembered locally. Only there are rows draggable —
dropping one on a folder files it, dropping it on **Unfiled** unfiles it.

The `…` button beside the filter opens the same set at full width, with previews,
search across title, note, place and provider, and three sorts. It is a modal, so
it works over a fullscreen map. Folder browsing lives in the panel, not here.

Editing a place or a capture (**Edit** on any row) sets its title, note and
My-work folder in one dialog, and is the only place a new folder is created from
the map.

Map controls sit in two clusters. **Tools** (measure, grid search, reference
image) float top-left. **View** — fullscreen, OSM labels, saved work — continues
the zoom column beneath `+`/`−`, because none of them changes what you are doing,
only what you see. The saved-work layer is off by default and session-only:
places draw as outlined pins, captures and screenshots as filled ones, items at
the same spot collapse into one counted mark, and clicking any mark opens a card
with its preview, provider, dates and note. A mark whose capture carries proofs
wears a dot up-left; its card names the count and offers **Show proofs**, which
switches the panel and the layer to the proofs view. In that view the card opens
the proof in Geo Proof and lists the saved posts written from it. Two post titles
fit directly in the card; additional posts expand in place, and selecting one
opens its draft in Geo Report. Hovering a card, a tree row or a search result
lights the others.

## Geo Proof

A proof is composed of panels: case images, each carrying its source. Two things
in the composer are not panels.

**Overlays.** Ctrl+V, a drop on the canvas, or `+ Add overlay` put an image
straight into the proof. It lands in the `Overlays` section of the side column,
sits above the panels and the legend, and is moved,
resized from its corners and framed like anything else on the canvas — you can
annotate it too. It claims no source: no media is filed, no entity, no
`derived-from` edge. The file lives in `proofs/<name>.assets/` under its own
content hash, travels with a rename, and goes when the proof does. A proof needs
a panel first, since the panels are what give the document its size — moving an
overlay never resizes the export.

**Frames.** Any panel or overlay takes a coloured border, its own colour and
thickness, drawn inset so the layout does not shift. A frame is decoration: it
stays out of the legend, which is still built from annotation colours alone.

## Notebook

The Notebook places a GitHub-flavored Markdown editor beside its preview. The
resizable split is stored locally, and Preview-only hides the editor. A note
with a remote inline image warns that its host is contacted on every open;
adding the image to the Case keeps it local. A ```mermaid fence is drawn as a
diagram, always light so it prints, and keeps its source with a note when the
syntax fails. Markdown help covers supported syntax, diagrams, image layout and
aligned text. The Preview toolbar opens an A4 print view that keeps local images
and diagrams and omits remote media.

Case Notes stays pinned while filed notes open in session tabs. Paste, drop or
pick case media to insert it; the reference menu links case entities. Deleted
references remain as broken markers. External captures and bookmarks open their
source page. Internal captures restore their Satellite view and provider. A saved
Geo Report exposes an `OPEN` action for its new note.

## Visual language (UI)

Tokens live in `frontend/src/app.css`. The interface follows the dense, flat
instrument style of QGIS, Google Earth Pro, Resolve and Lightroom.

- **Type**: system font for interface copy, monospace for coordinates, hashes and
  dates, and uppercase micro-labels only for panel sections.
- **Palette**: neutral gray darks (`--bg-0…3`), white-alpha borders, muted
  status colors. Azimuth amber is reserved for the primary action, selection and
  2 px active-edge indicators. It is not a decorative background or glow.
- **Theme**: dark by default, with a light daylight palette toggled from the
  foot of the rail. Both are the same tokens: `:root` holds dark, a
  `:root[data-theme='light']` block flips the colour tokens, and `lib/theme.js`
  stamps `data-theme` on `<html>` (remembered in `localStorage`, applied in
  `index.html` before first paint). The amber accent and the annotation palette
  stay fixed across themes. Surfaces over imagery remain dark through
  `.dark-surface`. New chrome must use tokens; hardcoded light colours are limited
  to text on dark image scrims.
- **Shape**: radii 3/4/6px, flat panels with 1px borders, rectangular badges.
- **Motion**: none. Color-only transitions ≤0.15s; no entrance animations,
  no hover lifts. Transient functional feedback (locate-flash) is the one
  exception.
- **Copy**: no slogans or self-explanation in chrome. Empty states use one short
  sentence. Visible UI strings use `·`, `:` or a period instead of em dashes.
- **Brand**: north arrow (`Logo.svelte`) + drawn wordmark (`Wordmark.svelte`),
  both defined in the components themselves. The arrow repeats in
  `public/favicon.svg` and in the plated PNG/ICO icons that
  `packaging/icons/render_icons.py` redraws; move those together.
  No other place uses brand lettering.

## Adding a tool (checklist for future work)

1. Add the component under `frontend/src/tools/`. Register it in `App.svelte`
   and the workspace's `tools` array in `lib/workspaces.js`.
2. Consume tokens and shared primitives (`.btn`, `.input`, `.card`,
   `.tool-header`); respect the accent roles above.
3. The tool owns its artifacts: list, reopen and delete them in-tool; file
   entities with provenance so Suggestions/Details work.
4. Tests accompany the tool (repo rule); pure logic goes in `lib/` with a
   `.test.js`.
