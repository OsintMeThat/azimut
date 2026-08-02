# Azimut v0.2.7

## OSINT toolkit at a glance

- **Sources:** import or download media, preserve hashes and provenance, inspect
  frames, crops, collages, panoramas and ELA, then prepare reverse-image
  searches.
- **Maps and sky:** convert coordinates, geocode places, capture and compare
  imagery, review AOI grids, and calculate local sun and moon conditions
  offline.
- **Evidence:** organise media, places, proofs and notes in portable cases with
  folders, relations, Markdown notebooks and PDF exports.
- **Publishing:** build annotated Geo Proofs and prepare evidence-linked Geo
  Reports for X, Bluesky or Mastodon without posting automatically.

## What changed in v0.2.7

### Case folders that belong to the analyst

- **A clear ownership boundary.** Azimut now keeps its managed files under the
  case's `azimut/` directory. Everything beside it belongs to the analyst and
  travels with the case bundle.
- **Readable, predictable storage.** The database and editable metadata move
  into hidden internal directories, while visible files keep the names shown in
  the app. Existing cases and older bundles migrate automatically.
- **Adopt an existing folder.** A folder created in the workspace can become a
  case in place without moving or reading the analyst's files.

### A workspace that can move safely

- **Move or adopt the workspace from Settings.** Azimut verifies every copied
  file with SHA-256 before switching through a pointer stored outside the
  workspace, and keeps the old copy until the analyst chooses to remove it.
- **External drives work too.** Move or adopt the workspace on an external
  drive. If it is disconnected, Azimut reports the missing location instead of
  starting an empty workspace.
- **No silent replacement for missing work.** If a configured workspace
  disappears, startup shows where it was expected instead of creating an empty
  replacement.
- **One Azimut per workspace.** An operating-system lock and heartbeat prevent
  two instances from writing to the same workspace. A stale or unreliable lock
  can still be overridden explicitly.

### Case Doctor

- **Read-only diagnosis first.** Case Doctor checks the database, registered
  media and files placed manually in `media/` without changing the case.
- **Explicit repairs.** Each applicable repair is offered separately, including
  restoring a missing manifest, removing or relinking missing media records and
  rebuilding a lost database with its unrecoverable data stated beforehand.

### Coords & Sky

- **Sun and moon calculations offline.** A coordinate and date now return rise,
  set, azimuth, altitude, civil and nautical twilights, moon phase and
  bright-limb angle in local time and UTC.
- **Visual day review.** The tool adds an altitude chart and compass view, while
  Satellite can draw the bodies' daily paths, hour marks and a selected bearing
  on the map.
- **Polar conditions are first-class results.** Polar day, polar night and days
  without a moonrise are reported as conditions rather than errors.

### Export finished work

- **Separate export destinations.** Notes, media and proofs can each use a
  remembered folder chosen from the new folder browser. The case's own
  `exports/` remains the default.
- **Notebook PDF export.** Export the open note or a selected batch as one PDF
  per note without opening a print dialog. Local images, entity references,
  tables, lists, code and Mermaid diagrams are preserved.
- **Portable text rendering.** Bundled fonts and text shaping cover CJK,
  Arabic, Indic and other living scripts consistently across Windows, Linux and
  macOS. Unsupported characters produce a named warning instead of disappearing.
- **Media and proof copies.** A media item or saved proof PNG can be copied to
  its destination and revealed in the system file manager. Files outside the
  case are never overwritten; concurrent name collisions atomically receive a
  numbered suffix.
- **Stable note filenames.** Notes with the same title keep distinct stable PDF
  names across batch and individual exports, including after long-title
  truncation.
- **Portable Settings backup.** Settings, keys, templates and the signature can
  travel to another machine, while absolute export paths and live download
  sessions stay behind; the UI marks the backup as private.

### Workflow and interface reliability

- **Frames sort by timecode.** Saved video frames now begin with their timecode,
  use the media title and receive stable numbering when several frames fall
  within one second. Windows-reserved filenames are handled safely.
- **Safe proof-to-report handoff.** Sending a different proof to Geo Report
  files the thread already on screen before starting the next one, while sending
  the same proof again keeps editing its existing thread.
- **Settings are easier to scan.** General, Publishing, Imagery, Templates,
  Capture extension, Storage and System now have focused sections. Export
  folders and workspace controls live together under Storage.

## Also in v0.2.6

### Portable case bundles

- **Export a complete case.** The Case switcher now exports a portable
  `.azimut.zip` snapshot containing the case database and its declared files.
  The bundle has a SHA-256 manifest, so import rejects incomplete or modified
  content rather than opening it as a plausible-looking case.
- **Import without overwriting.** Choose a bundle from the Case switcher to
  inspect its name, size, temporary-space requirement and protection state,
  then import it as a new case. Existing cases remain untouched; imported
  entities, links and confirmation state stay intact.
- **Optional password protection.** A password encrypts the complete bundle,
  including filenames. Passwords are not retained by Azimut and cannot be
  recovered. Thumbnails, deleted files and unfinished background jobs stay out
  of bundles.

### Recoverable deletion

- **Trash for case artifacts.** Deleting a note, media item, proof or related
  record now moves its registered files and recovery record to Trash. Restore
  returns the artifact and its surviving links; permanent deletion and Empty
  Trash remain explicit actions.
- **One undo point for multi-select.** Files can delete a selection together,
  with one confirmation, one Trash entry and one restore action for the whole
  operation.
- **Safer interrupted work.** Delete and restore actions record their progress
  before moving data, so opening a case resolves an interrupted action instead
  of leaving a half-deleted artifact behind.

### Reliability

- **Case-aware media refresh.** Thumbnail polling follows pending work after a
  bundle import and reloads previews when switching cases, even where relative
  file paths match.
- **Preserved confirmed locations.** Metadata backfill does not replace a
  location relation the analyst has already confirmed.
- **Predictable map opening.** A saved place without its own recorded zoom now
  keeps the map's normal starting zoom instead of unexpectedly changing it.

### Media evidence and relations

- **Automatic media enrichment.** Image imports read EXIF and a perceptual
  hash locally; video imports read container, stream and tag metadata. Details
  keeps the readable fields together, and media with stated coordinates can be
  filtered and opened on the map.
- **GPS suggestions that respect analyst work.** Parsed coordinates propose a
  linked place for review. A confirmed location always wins over a later
  backfill.
- **Shared relation vocabulary.** Details and saved-place cards can create,
  review, confirm or remove the same typed relations, with a consistent reading
  of each edge.

### Support and continuity

- **Settings backups keep presets.** Exporting and importing Settings now
  carries reusable proof and post presets with the workspace configuration.
- **Report an issue from About.** The form opens a prepared GitHub issue with
  the version, operating system and recent warnings. Workspace paths and account
  details are scrubbed before it leaves the app.
- **A working product tour.** The README walkthrough now renders on GitHub and
  PyPI instead of leaving an empty video element.

## Also in v0.2.5

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
Silicon macOS and run it. Each binary includes the browser UI, `ffmpeg`,
`ffprobe` and the fonts used for note PDFs.

Intel Macs require macOS 14 or newer and the Python package:
`pipx install azimut` or `pip install azimut`.

The binaries are unsigned. Follow the operating system prompt described in the
README on first launch.

Existing cases upgrade in place. Older case bundles remain importable, and no
manual export or migration is required.
