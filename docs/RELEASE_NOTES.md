# Azimut v0.3.2

Azimut is a local OSINT workspace: media, geolocation work, proofs and notes in
one portable case folder, on your own machine.

This is the improvement release. It adds no new tool. Every change below makes a
tool you already have quicker to read, asks you fewer questions, or says more
clearly what went wrong.

## Getting around

- **Ctrl+K** (⌘K on a Mac) opens **Go to**, which finds a tool, a case or a
  document of the open case, the latest ones first.
- The browser's Back and Forward buttons work in Azimut. They walk the tools you
  opened, and inside a tool the folders, sheets, proofs, drafts and notes you went
  to.
- Back never drops work. Leaving a proof or a post with unsaved changes asks
  first, and opening another one from its list now asks too.
- Back on an open dialog closes it. Leaving Azimut with unsaved work is a
  question the browser asks.

## Timeline, Board and Graph

- An event is one line under the Timeline axis: a date, a sentence with `@`
  mentions, and its sources. **Add event** (Alt+N) opens the same line over any
  tool, with that tool's view already cited.
- The Timeline draws each date as what it is: a point for an instant, a bracket
  for a day, a month or a year, a dashed line for something that happened once
  between two dates, a bar for a period. The axis and the list read as
  one, and a picked entry shows its media without opening it.
- Every date field has the same **Clock** chip: the place's zone, UTC, this
  computer or any zone. A plain day can carry its zone too, and a new date reads
  on its place's clock, else on the case's.
- The Board reads as an index. People, places and things come first, each with
  how many events name it and when; files and work fold under their own heading.
  **Group: None** gives back the flat table.
- Details opens beside the list, on a summary of the subject.
- **Change type…** corrects a subject's type without losing a field or a link,
  and **Merge…** joins two duplicates with a preview and an Undo.
- Search finds a name whatever accents it was written with, in Latin, Greek,
  Cyrillic, Arabic and Hebrew, and right-to-left text keeps its direction.
- The Graph proposes the links the case already implies: the account a post's
  address names, and points under 300 m apart as one site. Nothing is filed
  before you review the list.
- **Case** sits on the rail, one press from any tool.

## Sheet, Files and the sidebar

- The Sheet tab opens on a home with the recent sheets and the ones the case
  could start. Close saves and comes back to it.
- The Sheet home starts two worklists from the case: the files still to
  geolocate, each done once a proof answers it, and your geolocations one row per
  point.
- Files and the sidebar act on a right-click, and **Move to…** is one dialog
  everywhere.
- Pick a work folder and new files and saved work land in it.
- Files filters by type, or by what is linked to nothing yet.
- The sidebar holds Folders, the case's To-do lists and the latest filed items.
- A folder named in a save dialog shows in every folder picker. Renaming or
  removing a folder also moves its notes and updates the Media Library filter.

## Maps

- FIRMS fires are drawn as marks that keep their size through a zoom.
- Town and village names sit over the imagery in Satellite, Detect and the point
  dialog, on by default beside Borders.
- An added layer's row folds to one line. Drag the rows into the order the map
  stacks them, and refresh every followed layer at once.
- Compare and Detect take the whole screen, as Satellite does.
- Difference reads in cyan and magenta, waits for tiles instead of failing on
  them, and says on its button whether a reading is loading or up to date.
- **Revert** takes an edited saved comparison back to its saved version.
- A busy area lists all its Sentinel passes, up to five pages, each counted on the
  request meter.

## Detect

- The analyzer builder works on the map: one satellite, one or two dates,
  checks made with pins, and **Test** says what the rules find before you save.
- Areas sit in ordered groups, and the dock can be resized.
- **What** starts with nothing picked and lists the analyzers by what they look
  for.
- Detect still reads a pass its tile calls fully cloudy, rather than skipping
  it.

## Proofs, posts and collages

- Saving a proof says what it just joined: other geolocations on the same site,
  other files the account posted there.
- A `#date` token carries a proof's date into a post. Templates in Settings →
  Templates start from a layout, preview on the open post and flag a misspelled
  token.
- A point named only by its coordinates reads as the town it is near on the
  Graph.
- A collage exports at full resolution with no setting, and its size shows
  before you save. Collages are listed with a preview.

## Clearer when something goes wrong

- A failure reads as one sentence saying what to do. The full error stays in
  the log.
- Starting Azimut a second time opens the one already running.
- If another program holds port 8477, Azimut takes the next free port, and
  Settings → Capture extension shows the address to give the extension.
- A bundle import cut off halfway is cleaned up at the next start.
- A thumbnail or job asked for while the same one runs is no longer lost.
- Settings → System shows the licence notice and texts of the bundled ffmpeg.

## Security and privacy

- The capture extension acts only for the Azimut it is paired with. Another
  local page is refused and told which address to set.
- Its hand-offs open only the posting sites and image search engines Azimut
  offers.
- Importing a settings backup made where the extension was never paired no
  longer drops this machine's pairing.
- Coordinates typed in a map's search bar or read from a Sheet cell are never
  sent to the place-name geocoder.

## Install or upgrade

Download the ready-to-run file for Windows x86_64, Linux x86_64 or Apple
Silicon macOS and run it. It includes the interface, `ffmpeg` and the PDF
fonts. The Linux file needs glibc 2.38 or newer (Ubuntu 24.04, Debian 13,
Fedora 39 or later); on an older distribution, use `pipx install azimut`.

On Intel Macs (macOS 14 or newer), install the Python package instead:
`pipx install azimut` or `pip install azimut`.

The downloads are unsigned, so your system warns you the first time. On macOS,
run `chmod +x` on the file first. The README gives the steps for each platform.

The capture extension changed. Chrome, Edge and Brave update it from Settings →
Capture extension. Firefox updates the signed add-on by itself; for a new
install, open `azimut-capture-0.3.2.xpi` from this release in `about:addons` →
gear menu → **Install Add-on From File**.

Your cases open as they are and older bundles still import. The first open
rebuilds the case's search index so names match without their accents.
