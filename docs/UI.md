# Azimut — UI & UX reference

How the interface is organized (UX) and styled (UI). This is the contract new
tools and future works follow — not a roadmap. Feature phasing lives in
[SPEC.md](SPEC.md).

## Layout anatomy

```
┌ topbar: rose+wordmark · case switcher · (spacer) · settings gear · sidebar toggle ┐
├ rail ┬ tab strip (only when the workspace has several tools) ┬ case sidebar ┤
│      │ tool canvas                                           │              │
└──────┴───────────────────────────────────────────────────────┴──────────────┘
```

## Workspace model (UX)

The rail holds a **fixed set of activity workspaces in investigation-pipeline
order**. Tools are tabs inside a workspace — **a new tool never adds a rail
entry**; it registers in `frontend/src/lib/workspaces.js`.

| Workspace | Tools today | Future tools land here |
|---|---|---|
| **Collect** | Media Library, Files, Reverse Search | Channel Monitor, Evidence Locker |
| **Examine** | Inspect (Selection / Frame / Collage / Analyze) | EXIF, OCR, Image Compare, Hints, Shadow Clock, audio |
| **Map** | Satellite, Coordinates | **one map, many modes**: Compare, Ground Imagery, Measures, Viewshed, OSM Query, Map Board |
| **Compose** | Proof Composer, Post Composer | Report Builder, GIF maker |
| *(Case)* | — sidebar covers it | v3: Notes, Relations, Timeline, Orchestrator |

Rules:

- **Max two levels** (workspace → tab), preserving SPEC principle 3.
- **`uiState.tool` is the single source of truth**; the active workspace is
  derived from it, so cross-tool handoffs (`uiState.tool = 'proof'`) never
  care about workspaces. Clicking a workspace returns to its last-used tab.
- **Deep links**: `#<tool>` (stable), `#<workspace>`, `#<workspace>/<tool>`.
- **Navigation follows the object too**: from any artifact — open in tool,
  locate on map, add to proof. The rail is for starting; objects continue.
- Settings is app plumbing: behind the topbar gear, not on the rail.

## Case sidebar

Four sections; tools list (and delete) their own saved artifacts via their
Open lists / shelves — the sidebar never duplicates a by-tool listing.
Its left edge is a drag handle (240–640 px, capped at half the window;
double-click resets, width persists).

- **Case Notes** — `notes.md`.
- **Suggestions** — tool-suggested entities; confirm or dismiss (only shown
  when non-empty).
- **My work** — every saved artifact: the analyst's nested folders (the only
  user-owned taxonomy) plus an **Unfiled** inbox for the rest. File by
  dragging a row onto a folder or from the details panel (folder field).
  Unfiling deletes nothing. The **Files** tab (Collect) opens this same tree
  as a desktop surface — small tiles, rubber-band select, drag several at once,
  right-click a file or folder for Move to Unfiled / Delete.
- **Details** — selection editor for any artifact: preview, title/notes,
  provenance (created by/at, source), the derivation chain (made-from /
  used-by), My-work folder, open-in-tool / open-file / go-to-coords, Delete
  everywhere (danger confirm). One shared body (`EntityDetails.svelte`) — the
  sidebar panel and the Media Library's info modal render the same editor.

## Visual language (UI)

Tokens live in `frontend/src/app.css`; components never hardcode colors.
Reference points: QGIS, Google Earth Pro, Resolve, Lightroom — dense, flat,
sober instruments.

- **Type**: one workhorse font (system stack); mono for data (coords, hashes,
  dates); few weights; uppercase micro-labels only as panel-section headers.
- **Palette**: neutral gray darks (`--bg-0…3`), white-alpha borders, muted
  status colors. **One accent (azimuth amber), three roles only**: the single
  primary action per view, selection (picker borders, focus rings), and 2px
  active-edge indicators on rail/tabs. Never as a background wash, never as
  decoration, no glows.
- **Shape**: radii 3/4/6px, flat panels with 1px borders, rectangular badges.
- **Motion**: none. Color-only transitions ≤0.15s; no entrance animations,
  no hover lifts. Transient functional feedback (locate-flash) is the one
  exception.
- **Copy**: no slogans or self-explanation in chrome; empty states are one
  short sentence; **no em-dashes in visible UI strings** (use `·`, `:`, or a
  period; hover tooltips are tolerated); "(one-shot mode)" style parentheses
  over dash suffixes.
- **Brand**: compass rose (`Logo.svelte`) + vector wordmark
  (`Wordmark.svelte`), both extracted from
  `frontend/src/assets/logo-source.svg`; favicon derives from the same rose.
  No other place uses brand lettering.

## Adding a tool (checklist for future work)

1. Add the component under `frontend/src/tools/`, register it in
   `App.svelte`'s `TOOLS` and in its workspace's `tools` array
   (`lib/workspaces.js`) — rail and deep links follow automatically.
2. Consume tokens and shared primitives (`.btn`, `.input`, `.card`,
   `.tool-header`); respect the accent roles above.
3. The tool owns its artifacts: list, reopen and delete them in-tool; file
   entities with provenance so Suggestions/Details work.
4. Tests accompany the tool (repo rule); pure logic goes in `lib/` with a
   `.test.js`.
