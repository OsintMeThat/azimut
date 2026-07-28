# Azimut v0.2.5

## OSINT toolkit at a glance

- **Sources:** import or download media, use an existing login when a post
  requires it, record hashes and provenance, inspect frames, crops, collages,
  panoramas and ELA, then prepare reverse-image searches.
- **Maps:** convert coordinates, geocode places, capture attributed imagery,
  compare providers, rotate and measure maps, save references and review AOI
  grids.
- **Evidence:** organise media, places, proofs and notes in portable cases with
  folders, links, Markdown notebooks and PDF output.
- **Publishing:** build annotated Geo Proofs and prepare evidence-linked Geo
  Reports for X, Bluesky or Mastodon without posting automatically.

## What changed in v0.2.5

Mostly additions, with two fixes.

- **Diagrams in case notes.** A ```` ```mermaid ```` fence in a Notebook note
  renders as a diagram, in the preview and in the exported PDF, so a movement
  timeline or a chain of inference stays in the case instead of moving to an
  external drawing tool. The library loads the first time a note holds a
  diagram, never on open, and it draws offline.
- **Sentinel-2 cloud ceiling.** Cloudy passes now render by default, and a
  slider sets the ceiling. The tiles, the date calendar and "most recent" all
  follow the same number. Previously a configuration instance could apply its
  own cloud filter, so a date the calendar offered came back as an empty tile
  and read as a coverage gap.
- **New logo.** The mark is redrawn as a cartographic north arrow, split on the
  north-south axis, and stays legible at favicon size on both themes. The app
  icon, the favicon, the extension icons and the Windows `.exe` icon are all
  generated from one geometry definition.
- **Windows thumbnail fix.** Several downloads finishing at once could raise a
  path error instead of retrying, because the thumbnail directory was resolved
  before it existed. It is created first now.

## Also in v0.2.4

- **Saved work on the map.** Places, captures and filed screenshots can be
  browsed by geography or case folder, searched in English or the local name,
  previewed and shown on the map. Proofs appear at their own coordinates or at
  the captures they use.
- **Case organisation.** The sidebar adds search, type and status filters,
  multi-select filing and a details drawer. Files adds Small, Large and List
  views with sortable columns and complete folder browsing.
- **Named work.** Inspect, Geo Proof and Geo Report name their documents in the
  header and keep that name when saved or renamed. Inspect's save dialog can
  name a batch and attach one note.
- **Faster browsing.** Media and Files now query a SQLite browse index. Search,
  folder filters and Media category counts cover the complete case instead of
  only the first 200 items. Files requests thumbnail metadata only for paths it
  can display.
- **Better pickers and proofs.** Inspect, Reverse Search, Geo Proof and Notebook
  pickers can search and browse folders. Geo Proof supports coloured panel
  frames, layer controls and pasted overlays stored with that proof.
- **Capture extension.** A map point can be saved as a place, and any page can
  be saved as a bookmark. Map captures keep their source metadata and
  attribution.
- **Case-switch fix.** Saved Satellite items and Media thumbnail state are
  cleared before a different case loads, so data from the previous case no
  longer remains until refresh.
- **Release and security hardening.** Release builds use pinned, SHA-256-checked
  ffmpeg archives and extract only the expected tools. Images above 100 MP are
  rejected before decode. SQLite schema 4 adds the media browse index and
  upgrades existing cases automatically.

The read-only GitHub release check still runs on startup by default. It can be
disabled in Settings, and offline failures remain silent.

## Install or upgrade

Download the ready-to-run asset for Windows x86_64, Linux x86_64 or Apple
Silicon macOS and run it. Each binary includes the browser UI, `ffmpeg` and
`ffprobe`; no Python or system FFmpeg is needed.

Intel Macs require macOS 14 or newer and the Python package:
`pipx install azimut` or `pip install azimut`.

The binaries are unsigned. Follow the operating system prompt described in the
README on first launch.

Existing cases upgrade in place. No manual export or import is required.
