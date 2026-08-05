# Azimut UI and UX reference

This document defines the interface structure and visual language. Feature
phasing lives in [SPEC.md](SPEC.md).

## Layout anatomy

```
┌ topbar: rose+wordmark · case switcher + Board · (spacer) · settings gear · sidebar toggle ┐
├ rail ┬ tab strip (only when the workspace has several tools) ┬ case sidebar ┤
│      │ tool canvas                                           │              │
└──────┴───────────────────────────────────────────────────────┴──────────────┘
```

## Workspace model (UX)

The rail holds a fixed set of workspaces in investigation order. Tools register
in `frontend/src/lib/workspaces.js` and appear as tabs, never as new rail entries.

| Workspace | Tools today | Future tools land here |
|---|---|---|
| **Case** (topbar) | Board | Sheet; v4: Timeline; v5: Orchestrator |
| **Sources** | Media Library, Files, Reverse Search | Channel Monitor, Evidence Locker |
| **Examine** | Inspect (Selection / Frame / Collage / Analyze) | Edit Provenance, Shot contact sheet, OCR, Image Compare, Hints, Sky Clock, audio |
| **Map** | Satellite, Coords & Sky | **one map, many modes**: Compare, Imagery Wayback, Event layers, Ground Imagery, Measures, Viewshed, OSM Query, Map Board |
| **Compose** | Geo Proof, Geo Report, Notebook | Report Builder, GIF maker |

**Case is not on the rail.** The rail reads as a sequence of stages, and the case is
not a stage: it is what every stage files into. It hangs off the case switcher in
the topbar instead, so the header answers *which case* and the rail answers *what
am I doing*. It stays a workspace in every other respect — tabs, `#case` deep
links, its own remembered sidebar — which is where Sheet and Timeline will land.
That sidebar stays closed by default, because the board already lists the same case
and two lists side by side only ask which one is real.

Rules:

- Use at most two levels: workspace → tab.
- `uiState.tool` is authoritative. The active workspace is derived from it, so
  cross-tool handoffs do not need workspace logic. Each workspace remembers its
  last-used tab.
- Deep links use `#<tool>`, `#<workspace>` or `#<workspace>/<tool>`.
- Artifact actions can open a tool, locate a place or add an item to a proof.
- Settings is app plumbing: behind the topbar gear, not on the rail.

## Board

The case as one table: a row per entity, whatever type it is. It is what makes the
hand-made vocabulary reachable — a `person`, an `account` or a `claim` had no screen
before it. One view, a table; the graph is a different question and comes as its own
view. Following a relation to a type with no tool of its own lands here, on that
row's Details.

- **New entity** offers the types an analyst creates by hand and generates the form
  from the registry. It opens on the type being filtered for, or the first of the
  chosen family. The primary field names the value being entered — **IP address**,
  **Full name**, **Handle** — never a generic **Name**. An identifier the case
  already holds is flagged with the existing row one click away: a warning, not a
  block, since merging is not shipped. What it creates opens into its own Details.
- **Add file** takes a document, scan, plan or image into the case, by the button or
  by dropping it on the list. It runs the Media Library's import, so the file is
  hashed, deduplicated, given a sidecar and a thumbnail, and filed as a `media`. One
  file opens its Details; a batch reports what landed and what was already there.
- **Search** covers the label, type, folder, notes and declared fields (ONTOLOGY §2),
  in memory on a case that fits one page and server-side past it — one predicate
  either side of that threshold.
- **Filters** narrow by family, then by type inside it, then by review state. Family
  is server vocabulary and resolves to its types on the way out.
- **A proposal is settled from its row**: confirm takes its suggested relations with
  it, dismiss is the standard delete, recoverable from the trash.
- **Sorting** is a click on any heading, reversed by a second. It orders the rows
  loaded, and says so beside the count while there are more.
- **Columns** are the four every entity has — identity, type, folder, created — plus
  the chosen type's declared fields once a single type is picked. Read-only: editing
  cells and CSV belong to the Case Sheet.
- **A row is a control**: focusable, opened with Enter, and the review clicks inside
  it never open it.

**The vocabulary explains itself on hover.** A family, a type, a verb, a rating and a
declared field each carry one clause from the registry that declares them, shown
where the word appears. No screen writes its own wording.

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
  a node only when non-empty), the analyst's nested folders, **Unfiled**, then
  **Trash** when it holds a delete. Trash shows its item count and size; each
  group can be restored or deleted permanently, and the node can be emptied.
  `+ Folder` and `+ Note` sit above the tree.
- **Filing** — drag rows onto a folder, or drop them on Unfiled to unfile.
  Ctrl/cmd-click and shift-click select several rows first, and the drag carries
  all of them; folders are targets, never cargo. The tree scrolls itself when the
  pointer nears an edge mid-drag, since a native drag swallows the wheel.
  Unfiling does not delete data. The **Files** tab presents the same tree with
  tiles, multi-select and context actions. It also exposes Trash with the same
  restore, permanent-delete and empty actions as the sidebar. Delete sends the
  current selection through the standard confirmation.
- **Details** — a drawer over the sidebar, closed with the back arrow or Escape, so
  selecting a row never pushes the case out of view. An analyst-entered entity opens
  as one compact form: typed identity, declared fields, notes, folder, connections.
  File and tool entities keep two tabs — **Info** is what the file or save reports
  about itself, **Case** is what the analyst states about it. Case uses a responsive
  field grid, one light connection list, and a collapsed **Made from & used by**
  block. A field declared as holding sentences is a box that grows, not a line. A
  suggested entity says so at the top and carries the click that confirms it.
  Save commits the entity fields; each connection has its own Add action. Because the
  two commit differently, closing the panel or following a connection asks first when
  Save has not taken what is on screen.
  A file the app has no viewer for — a document, a scan, a spreadsheet — offers
  **Show in folder** rather than a download link and no tool button: handing it to
  the browser makes a second copy in Downloads, and the analyst ends up working on a
  file the case does not know about. Following one from anywhere else does the same.
  The sidebar and Media Library modal share `EntityDetails.svelte`. Image Details
  include a closed EXIF section with the parsed capture date, GPS and every readable
  tag; Video Details use the same pattern for ffprobe container, stream and tag
  fields.
- **Delete** — deleting an artifact moves its registered files and cascade into
  Trash and shows an **Undo** toast. The confirmation uses the neutral tone and
  states what can be restored. Red is reserved for deleting a case, purging a
  trash group and emptying Trash.

## Case switcher

The switcher creates, renames, opens and deletes cases. The menu leads with the
list, since switching is what it is opened for: search on top, cases and scratch
sessions in one scrolling list, and every action in a one-line footer — **New
case** labelled, then import, open folder, export and close as icons, each with
its tooltip. The Case Doctor shield sits with those case-level actions. A case
whose database cannot be opened stays in the list with **Needs attention** and
its own Doctor button, so repairing it does not require opening it first.
Five stacked verbs no longer push the list below the fold.
**Export this case**
starts a durable job, then downloads the `.azimut.zip` through the browser.
Optional password protection downloads `.azimut.enc`; the dialog states once
that a lost password cannot be recovered.

**Import case** opens the browser's file picker for `.zip` and `.enc`, uploads
the selected bundle for a pre-flight check, and shows its case name, size,
temporary disk requirement, available space and protection state. Confirmation
always creates a new case, waits for the durable
import job, then opens it. It never replaces or merges an existing case.
Confirmed entities and relations remain confirmed in the imported case.

**Folders in the workspace** that are not cases sit at the end of the same
list, dimmed, marked **Not a case yet**. Clicking one makes it a case where it
is: nothing moves, and what was already in the folder stays in the analyst's
half. A folder holding a case that lost its manifest reads **Case to recover**
and opens the Doctor once the manifest is back. A name no case folder can carry
reads **Rename to use** and does nothing until it is renamed.

**Case Doctor** checks without writing. A healthy case gets one short result;
damage is listed one item at a time with only the repairs that apply. Database
rebuild states what cannot be recovered before the button. Removing a missing
media record takes a second click, while relinking only accepts an unregistered
file already placed in that case's `media/` folder.

## Workspace folder

Settings → Storage holds the folder. There is no native picker, so the path is
typed and **Check** reads it before anything is offered: refusals in red,
warnings in amber, and the folder Azimut would actually use when that differs
from the one typed. Two actions follow, never merged, because their outcomes
differ. **Use this folder** switches and moves nothing, and says how many cases
would stay behind. **Move everything here** copies, and while it runs the tab
shows the step and the bytes while Azimut refuses other work. Afterwards the old
folder is named, with one button to delete it. A folder set through
`AZIMUT_HOME` is shown without any of this: the variable wins every launch.

A full-screen panel replaces the app when the workspace can't be worked in, with
the same picker inside it and a different sentence for each reason. **Gone**:
where it was expected, and that nothing has been deleted or recreated.
**Held by another Azimut**: which machine and port has it, what two instances
would cost, and Reload. **Take it anyway** is there for a lock that outlived its
process, warned once and never presented as the ordinary way out.

## Export folders and backup

Settings → Storage remembers one destination each for note PDFs, media copies
and proof PNGs. **Change…** opens the shared folder browser, which lists folders
only and can create one; the case's `exports/` stays the default. Media Details,
saved proofs and Notebook use those same destinations. Files already outside a
case are never overwritten, and concurrent exports reserve distinct numbered
names.

The Settings backup carries portable settings, API keys, templates and the
signature. It leaves absolute export paths, the workspace pointer and download
sessions on the machine that created them, and the UI tells the analyst to keep
the downloaded backup private.

## Connections

Details keeps four concepts visually separate: **Relations**, **Mentions**,
**Claims**, and the collapsed lineage block. The lineage block is labelled **Made
from**, **Depends on** or **Used by** from the direction and link type; it is not a
generic History list.

Ordinary relations render through one component wherever they appear. Two lines carry
the neighbour's name, then what the edge states and how sure of it. A suggested row
can be confirmed; any row can be removed. Where a pair supports several verbs or both
directions, the reading is selectable. An older out-of-matrix row stays visible and
removable but cannot be restated. Past six rows the list hides the rest behind one
click, suggestions first. The registry's headings only appear where a list runs
several actions together.

**How sure, and how reliable, are two controls that never merge.** The rating sits
beside the verb, offering the levels the API serves plus *Not assessed* to clear it.
Unrated is the normal state, so it stays colourless until it holds a level, and a
ruled-out row is dimmed and kept rather than struck out. The source's Admiralty grade
sits on the line above, with the name it belongs to, stated rather than offered: it is
edited in that source's own panel. An ungraded source shows nothing.

**Add relation** searches only relation targets, **Add mention** the mention action.
Hovering either button lists the accepted target types; media-specific rules use the
current file kind. A filed relation cannot be reworded into a mention, and a mention
has no verb menu or rating. A Claim has its own **About**, **At** and **Cites**
editor; its confidence is edited with the Claim fields, and those three connectors
carry no rating of their own.

## Sources

The Media Library toolbar keeps explicit maintenance actions beside Import:
**Thumbnails** repairs missing previews; **Enrich** queues local image
EXIF/perceptual-hash and video metadata backfill for files not processed by the
current version. A **GPS** toggle beside the type and folder filters narrows the
list to the files whose own metadata states a position, and appears only in a case
that holds some; how many is in its tooltip, not in its label. Those rows carry
one pin glyph — coordinates in the tooltip, not in the title — and clicking it
flies the map there. Thumbnail polling follows all pending case jobs, including
files beyond the loaded page after a case import. Thumbnail failures are scoped
to their case, so switching cases always reloads previews even when relative
paths match. Enrich respects an existing confirmed GPS relation during backfill.

The row action for an image, a video or an audio file opens it; for anything the
app cannot display it opens the folder the file sits in, so the original is opened
in whatever program owns it rather than copied into Downloads.

Every media row and card shows the file's human-readable stem, without its
extension and without a second title line. Editing that name in Details renames
the file; the backend returns the portable stem after replacing forbidden
characters or resolving a case-insensitive collision. Downloads keep dates and
remote ids in provenance instead of appending them to the visible name.

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

Editing a place or a capture (**Edit** on any row) sets its title, note, relation
and My-work folder in one dialog, and is the only place a new folder is created
from the map.

Map controls sit in two clusters. **Tools** (measure, sun & moon, grid search,
reference image) float top-left. A tool with settings opens its panel beside that
cluster, never beneath it, because beneath it is where Leaflet's own controls
live. **View** — fullscreen, OSM labels, saved work — continues the zoom column
beneath `+`/`−`, because none of them changes what you are doing, only what you
see.

**Sun & moon** draws one date's path from an anchored point: the arc each body
sweeps while it is up, hour ticks along it, and the bearing at an hour you drag.
Only azimuths are drawn, since a plan view cannot state an altitude. Height reads
instead from where the body's own mark sits on its ray: the anchor stands for the
zenith and the arc for the horizon, so a high sun rides close to you. The mark
names its altitude on hover, carries the moon's phase, and is absent while the
body is under the horizon. The anchor is a point and not the map centre, so panning
leaves the path alone. Coords & Sky opens the same mode with its own point, date
and time, and hands over no computed value.

The saved-work layer is off by default and session-only: places draw as outlined
pins, captures and screenshots as filled ones, items at the same spot collapse
into one counted mark, and clicking any mark opens a card
with its preview, provider, dates and note. A mark whose capture carries proofs
wears a dot up-left; its card names the count and offers **Show proofs**, which
switches the panel and the layer to the proofs view. In that view the card opens
the proof in Geo Proof and lists the saved posts written from it. Two post titles
fit directly in the card; additional posts expand in place, and selecting one
opens its draft in Geo Report. Hovering a card, a tree row or a search result
lights the others.

A card also holds the point's relations. The Saved index carries their count only,
so a stack of five marks is never five requests: a lone mark opens its relations
straight away — clicking a place to see which photos claim it is the point of the
gesture — and a stack waits to be asked. A point enrichment proposed from a file's
metadata is marked `suggested` in both the card and the tree, so a camera's reading
never passes for analyst work. The Save-place dialog carries the matching write:
one **Relate to…** field says why the point is being saved while the analyst still
knows.

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
aligned text. The toolbar exports the open note, or a checked selection, as one
server-rendered PDF per note without a print dialog. Local images and
browser-rendered Mermaid diagrams travel with it; remote images are omitted.
Homonymous notes keep stable suffixes even when exported separately, and the
shared destination defaults to the case's `exports/` folder.

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
