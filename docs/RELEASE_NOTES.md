# Azimut v0.2.9

Azimut is a local OSINT workspace: media, geolocation work, proofs and notes in
one portable case folder, on your own machine.

This release adds a table you can work in, and lets a proof argue more than one
point.

## Sheet, a new tool

A spreadsheet-style grid over the case's own CSV files.

- Each sheet is a plain `.csv` in the case folder, so it also opens in Excel or
  LibreOffice. If you edit it there while Azimut has it open, the grid tells you
  and asks whether to reload or overwrite.
- Sort, filter, rename, merge, pin or hide a column from its own heading, and
  clean up a pasted column (trim, lowercase, de-duplicate, split) after seeing
  how many cells it would change.
- Give a column a type: state, list, yes/no, number, coordinates, date or image.
  The sheet then sorts and filters it correctly, and can show it on the map, on
  the Timeline or as a progress count.
- Import an Excel workbook, one sheet per tab.
- A cell can point at a person, a place or a media item already in the case.
- Copy the rows you are looking at as a Markdown table, or save them as a CSV.

### From a sheet into the case, and back

- Turn a prepared sheet into entities, places, bookmarks and dated statements in
  one go. You see a row-by-row plan first, and nothing is written until you
  accept it.
- Or the other way round: build a worklist from what the case already holds, for
  example forty places to check with a column for your verdict.
- Geocode a column of addresses, check a column of links, or send a column of
  coordinates to the map.
- List every proof in the case, one per row, and build one proof per row out of
  columns holding links and coordinates.

## Geo Proof

- A proof can now state several points, not one. Name them, mark which one is
  the camera position, and the first row stays the proof's conclusion.
- It can also list several sources. For a link the case has nothing from, Azimut
  offers to download its files as supporting material.
- Import a published post as a proof: its pictures become the panels, its text
  is read for coordinates, and any video it links is downloaded. You approve a
  preview before anything is saved.
- New drawing options: filled boxes and ellipses with adjustable opacity, a set
  of ready-made symbols, and multi-select to recolour or move several shapes at
  once.

## Elsewhere

- Export a Graph or Timeline view as an SVG or PNG plate, with the case name,
  the question, the period and a legend around the drawing.
- The map's search box now suggests as you type, from your saved places, from
  coordinates you paste and from a list of 34,000 cities bundled with the app.
  It only calls the online geocoder once you stop typing.
- Saved views can be renamed and sorted, and each says when it was last changed.
- Select several rows in the Board and delete them in one step, undoable from
  the toast.
- Downloads behind a login explain what the site actually asked for, and offer
  to reuse your browser session.
- Removing a relation, or deleting a photo you imported into an entity, now asks
  for confirmation, because neither can be undone.

## Fixes and hardening

- A sheet no longer removes a relation you stated yourself. Clicking a filter
  dropped the entities you had linked to the sheet by hand, and promoting the
  same rows a second time dropped the sources you had added to a statement.
- A point that a batch build filed for a proof can now be taken off it, and its
  camera marker is read from that proof's own footage. Deleting the row used to
  do nothing, and the point came back the next time you opened the proof.
- A camera position marked on a coordinate written twice is kept, instead of
  being dropped with the repeated line.
- A batch proof build no longer overwrites an existing proof that happens to
  share its title; it stops and tells you about the name clash.
- Large uploads are refused by size before being read, including the proof
  composer's save.
- A malformed extension pairing token is rejected properly instead of returning
  a server error.
- Filing several downloads at once no longer fails one of them on a locked
  database, which mostly affected Windows.

## Install or upgrade

Download the ready-to-run file for Windows x86_64, Linux x86_64 or Apple
Silicon macOS and run it. Each one includes the interface, `ffmpeg` and the
fonts used for PDF export.

On Intel Macs (macOS 14 or newer), install the Python package instead:
`pipx install azimut` or `pip install azimut`.

The downloads are unsigned, so your system will warn you the first time. The
README explains the prompt for each platform.

Your existing cases open as they are. No export, migration or manual step is
needed, and older case bundles still import.
