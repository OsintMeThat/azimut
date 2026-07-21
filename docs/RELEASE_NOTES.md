# Azimut v0.2.1

## OSINT toolkit at a glance

- **Sources:** import or download media, record hashes and provenance, inspect frames, crops, collages, panoramas and ELA, then prepare reverse-image searches.
- **Maps:** convert coordinates, geocode places, capture attributed imagery, compare providers, rotate and measure maps, save references and review AOI grids.
- **Evidence:** organise media, places, proofs and notes in portable cases with folders, links, Markdown notebooks and PDF output.
- **Publishing:** build annotated Geo Proofs and prepare evidence-linked Geo Reports for X, Bluesky or Mastodon without posting automatically.

## What changed

- **Scalable cases.** Existing JSON graph data migrates to per-case SQLite the next time a case opens. The original graph is retained as `case.pre-migrate-v2.json`, while media, notes and proofs stay as ordinary files. Closed case folders remain portable.
- **Faster casework.** The sidebar loads a bounded catalog on demand, and video thumbnails use a durable one-worker queue so large cases stay responsive.
- **Case Notebook.** Edit tabbed Markdown notes, insert local media and linked evidence, keep broken-reference markers visible, and open a print-ready PDF view.
- **Sharper tools.** Geo Proof, Geo Report, Inspect and Satellite have cleaner canvas workflows. Chromium and Firefox browser tests cover real Konva and Leaflet gestures.
- **Stronger releases.** Builds use the locked release toolchain, smoke-test the launched binary and require bundled `ffmpeg` and `ffprobe`. The relaunch helper now works across Windows, Linux and macOS.

## Install or upgrade

Download the ready-to-run asset for Windows, Linux x86_64 or Apple Silicon macOS from this release and run it. Each binary includes the browser UI, `ffmpeg` and `ffprobe`; no Python or system FFmpeg is needed. Intel Macs are supported through `pipx install azimut` or `pip install azimut`.

Existing cases open in place. Their graph migrates automatically on first open; no manual export or import is required.
