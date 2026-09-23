# Azimut v0.3.1

Azimut is a local OSINT workspace: media, geolocation work, proofs and notes in
one portable case folder, on your own machine.

This release sweeps an area for what appeared, and puts maps made
elsewhere on yours.

## Detect

- **Detect** is a new tab under Map. Draw one or more areas on
  Sentinel-2 and it sweeps them at full resolution for vessels, fires and gas
  flares, construction, small spots, any surface change, burn scars, vegetation
  loss or new water. You can also copy an analyzer and tune your own.
- Ask for a small, medium or large target instead of setting thresholds. The
  areas are priced in Copernicus requests before anything is fetched.
- **Find passes** lists the dates your areas really have, with how much of them
  each pass covered and how cloudy it was. A finished run says how much it read,
  so "nothing found" and "never looked" stay apart.
- Candidates come strongest first, one at a time. **Keep as a pin** files one
  with its own evidence crop; nothing else reaches the case.
- Areas can be saved with the case. A watch keeps an analyzer, its areas and a
  date rule together, and **Run again** repeats the sweep.
- Detect needs Copernicus credentials in Settings.

## Compare

- Compare opens on a Wayback release from a year ago against today's World
  Imagery, with no key needed. **New** offers the other starting pairs.
- "Change assist" is now **Difference**. Its cloud switch uses the same
  Sentinel-2 cloud and shadow mask as Detect instead of guessing from the
  picture, so a white roof is no longer taken for a cloud.
- MNDWI and BSI join the spectral indices. An index draws its line at a stated
  change, so panning no longer moves it.
- Tone matching is off by default on a Sentinel-2 pair.
- Difference is a switch beside the four views rather than a view of its own:
  its highlights lie over side by side, swipe, fade or blink, on A, B or both.
  They can blink.
- Right-click the ground for the point menu.
- Right-click a point on the Satellite map to open Compare on its last two
  Wayback pictures or its last two Copernicus passes.
- An export frame sets what an export shows. Numbered markers and blur boxes can
  be stamped on the ground.
- On a turned map, boxes and ellipses are drawn along the screen, and any shape
  turns from the grip above it. The export frame keeps its shape when the
  camera turns, and exports upright as drawn.
- Difference's settings stay put through a read, lie over the highlights, and
  close on a click outside them.

## Layers from elsewhere

- Open a KML, KMZ, GeoJSON or GPX file as a map layer, or follow a public Google
  My Maps or map URL. It keeps its own colours and, if you ask, its own icons,
  with a legend that filters and a search that jumps to a feature. A layer lives
  in the case and travels in bundles; its features never become case entities.
- Add a **GeoConfirmed** conflict over a span of days or dates, or its whole
  history, optionally only the current view. Events carry GeoConfirmed's own
  icons, are grouped by faction, and link to their sources and geolocation.
- Narrow a dated layer (GeoConfirmed, timestamped KML, GPX waypoints) to a period
  dragged on a strip of its events or picked on a calendar.
- Added layers start switched off after a reload, so a layer heavy enough to
  crash the tab cannot do it twice.
- The map panel opens on its Layers tab. Its Saved tab shows one position at a
  time: Media, then Places, then Captures. Media draws the case's photos and
  videos where a relation, a GPS reading or a proof places them, and plays them
  beside the imagery.

## Proofs

- Turn or crop a panel or an overlay without touching its source. Annotations
  stay on the same pixels.
- Stamp numbered markers, counted per colour, and blur boxes that hide what is
  under them.
- A proof can carry one sentence, used as its notes and to write the post, and
  the date its material was taken. That date shows on the Timeline and is stated
  for the original footage, never for a frame cut from it.
- Place any point of a proof on a map instead of typing it. Each panel keeps its
  own point.

## Elsewhere

- **To-do lists** on Home: named lists of tasks with a progress count, saved with
  the case and carried in bundles.
- One date field across the app. Type a day, a month, a year, a time or a range,
  or build it from a calendar with how sure you are. It says what it understood.
- File a claim straight from Details, a Board row or a Graph node, with that
  entity already filled in.
- Send a picture to Reverse Search from a Media Library row (**Open in…**), or an
  Inspect frame as cropped, saved or not.
- A claim is called a claim everywhere. Every icon button has a tooltip, a layer
  that cannot be switched on says why, Home lists recent work first, and Coords &
  Sky opens on the point the map is showing.
- Over another map site, the extension's points tool draws one position at a
  time, like the app. Its media windows take files up to 512 MB.

## Fixes

- Geo Report's map links read as site names, in the app and in the saved
  Markdown note, instead of internal ids.
- A tab left open across an update no longer asks for interface files that are
  gone.
- A video's thumbnail no longer goes missing when the background worker reaches
  it before the file's details are written.
- The Guide describes Inspect's actual tabs, and sends you to the Layers tab for
  overlays.
- On Windows, moving the workspace or saving settings no longer fails when an
  antivirus or the search indexer briefly holds the file.
- The Wayback map no longer slows down while you pan. Its picker lists every
  release, and **Changes here** reads a point's history only when you press it.

## Install or upgrade

Download the ready-to-run file for Windows x86_64, Linux x86_64 or Apple
Silicon macOS and run it. Each one includes the interface, `ffmpeg` and the
fonts used for PDF export.

On Intel Macs (macOS 14 or newer), install the Python package instead:
`pipx install azimut` or `pip install azimut`.

The downloads are unsigned, so your system will warn you the first time. The
README explains the prompt for each platform.

The capture extension changed in this release. Chrome, Edge and Brave users
update it from Settings → Capture extension. Firefox updates the signed add-on by
itself; a new install uses `azimut-capture-0.3.1.xpi` attached to this release,
opened from `about:addons` → gear menu → **Install Add-on From File**.

Your existing cases open as they are. No export, migration or manual step is
needed, and older case bundles still import.
