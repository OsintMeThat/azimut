# Azimut v0.3.1

Azimut is a local OSINT workspace: media, geolocation work, proofs and notes in
one portable case folder, on your own machine.

This release sweeps an area for what appeared, by day or by radar, and puts
maps made elsewhere on yours.

## Detect

- **Detect** is a new tab under Map. Draw areas and it sweeps them on Sentinel-2
  at full resolution for vessels, fires, construction, burn scars, vegetation
  loss, new water or any change.
- Radar analyzers read Sentinel-1 through cloud and at night: vessels, damaged
  buildings, new structures, floods. Settings → Imagery shows how to add the
  Sentinel-1 layer they need.
- **New analyzer** builds your own from rules on bands, indices, ground classes
  or radar. Checks on places you trust turn red when a rule stops holding. Five
  examples ship with their checks.
- **Find passes** lists the dates your areas really have, with coverage and
  cloud. The cost in Copernicus requests shows before anything is fetched.
- Candidates come strongest first. **Pin** files one in the case with its
  evidence crop and a dated claim, or open it in Compare.
- A routine keeps an analyzer, its areas and a date rule, and **Run routine**
  repeats the sweep.
- Detect needs Copernicus credentials in Settings.

## Compare

- Compare opens on Wayback a year back against today's World Imagery, with no
  key needed.
- **All dates** lists every dated picture of a point, oldest first, to set on
  either side.
- Sentinel-1 radar passes are a basemap in Satellite, Compare and Detect.
- A saved comparison stands on the map, dated A → B, and reopens in Compare.
- "Change assist" is now **Difference**, a switch over any of the four views.
  It masks clouds with Detect's Sentinel-2 mask, so a white roof no longer
  counts as one, and tone matching starts off on a Sentinel-2 pair.
- New MNDWI and BSI indices, an export frame, numbered markers and blur boxes.
- Right-click a point on the Satellite map to compare its last two Wayback
  pictures or Copernicus passes.

## One camera for the maps

- Satellite, Compare and Detect show the same ground: pan one and the others
  follow. Settings → General turns it off.
- A middle-drag turns any map or Inspect frame; a middle click puts north back.

## Layers from elsewhere

- Open a KML, KMZ, GeoJSON or GPX file as a map layer, or follow a public Google
  My Maps URL. It keeps its own colours and icons and travels in bundles.
- Add **GeoConfirmed** events over a span of dates, grouped by faction and
  linked to their sources.
- Narrow a dated layer to a period on a strip of its events or a calendar.
- A pin's card gives its coordinates to copy. Right-click the pin to compare its
  exact point or open its imagery history.
- The map panel's Saved tab shows Media, Places or Captures. Media places the
  case's photos and videos and plays them beside the imagery.

## Proofs

- Turn or crop a panel or an overlay without touching its source.
- Stamp numbered markers and blur boxes.
- A proof can carry one sentence and the date its material was taken, shown on
  the Timeline.
- Place a proof's point on a map instead of typing it.

## Inspect and Collage

- Inspect keeps one work per file, saved as you go. There are no sessions to
  open or save.
- **Collage** is a tab of its own and lays out frames from any number of files.
- The first time a case opens, its 0.3.0 Inspect sessions of one file become
  one work: the latest is kept, with the others' notes and names.

## Elsewhere

- **To-do lists** on Home, saved with the case.
- One date field across the app: type a day, a month, a year or a range, or
  pick it on a calendar with how sure you are.
- File a claim straight from Details, a Board row or a Graph node.
- Send a picture to Reverse Search from the Media Library or an Inspect frame.
- Every icon button has a tooltip.

## Security and privacy

- A case file opened in a tab, such as an SVG from a received bundle, no longer
  runs its script.
- Another website can no longer make Azimut fetch tiles or run lookups on your
  keys.
- A bundle no longer carries the exporting machine's folder paths or a database
  journal.
- A map site can no longer read or press the extension's panel.
- A key a provider refuses no longer shows in the error message.

## Fixes

- The Labels map layer is gone: CARTO's tiles now ask for a key and covered the
  map with a watermark. Borders still names places, and Roads names streets.
- Changing only the case of a name renames it on Windows and macOS, where it
  used to delete a collage or be refused.
- Two names differing only by case no longer block a bundle export on Linux.
- A proof, draft or grid with "#" in its name opens and deletes the right one.
- Renaming a file to the name of one deleted earlier no longer fails halfway.
- Notes, proofs and drafts are written whole, so an interrupted save keeps the
  previous version.
- The Wayback map no longer slows down while you pan, and its picker lists every
  release.
- A video's thumbnail no longer goes missing on import.
- Geo Report's map links read as site names instead of internal ids.
- On Windows, moving the workspace or saving settings no longer fails when an
  antivirus briefly holds the file.
- A tab left open across an update no longer asks for files that are gone.

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
install, open `azimut-capture-0.3.1.xpi` from this release in `about:addons` →
gear menu → **Install Add-on From File**.

Your cases open as they are and older bundles still import. The Inspect merge
above is the only change to them.
