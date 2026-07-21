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
| **Examine** | Inspect (Selection / Frame / Collage / Analyze) | EXIF, OCR, Image Compare, Hints, Shadow Clock, audio |
| **Map** | Satellite, Coordinates | **one map, many modes**: Compare, Ground Imagery, Measures, Viewshed, OSM Query, Map Board |
| **Compose** | Geo Proof, Geo Report, Notebook | Report Builder, GIF maker |
| *(Case)* | Sidebar | v4: Notes, Relations, Timeline; v5: Orchestrator |

Rules:

- Use at most two levels: workspace → tab.
- `uiState.tool` is authoritative. The active workspace is derived from it, so
  cross-tool handoffs do not need workspace logic. Each workspace remembers its
  last-used tab.
- Deep links use `#<tool>`, `#<workspace>` or `#<workspace>/<tool>`.
- Artifact actions can open a tool, locate a place or add an item to a proof.
- Settings is app plumbing: behind the topbar gear, not on the rail.

## Case sidebar

The sidebar has four sections. Tools keep their own saved-artifact lists; the
sidebar does not duplicate them. Its left edge resizes from 240 to 640 px, capped
at half the window. Double-click resets the persisted width.

The sidebar defaults to collapsed in Map and open elsewhere. Open state is
remembered per workspace for the current session. Reloading restores the defaults.

- **Case Notes** opens `notes.md` in the Notebook. Filed notes open there too.
- **Suggestions** lists tool-proposed entities for confirmation or dismissal and
  stays hidden when empty.
- **My work** contains nested analyst folders and an **Unfiled** inbox. Rows can
  be filed by drag-and-drop or through Details. Unfiling does not delete data.
  The **Files** tab presents the same tree with tiles, multi-select and context
  actions.
- **Details** edits an artifact's preview, title, notes, provenance, derivation
  chain and folder. It also provides open, locate and delete actions. The sidebar
  and Media Library modal share `EntityDetails.svelte`.

## Notebook

The Notebook places a GitHub-flavored Markdown editor beside its preview. The
resizable split is stored locally, and Preview-only hides the editor. A note
with a remote inline image warns that its host is contacted on every open;
adding the image to the Case keeps it local. Markdown
help covers supported syntax, image layout and aligned text. The Preview toolbar
opens an A4 print view that keeps local images and omits remote media.

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
- **Brand**: compass rose (`Logo.svelte`) + vector wordmark
  (`Wordmark.svelte`), both extracted from
  `frontend/src/assets/logo-source.svg`; favicon derives from the same rose.
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
