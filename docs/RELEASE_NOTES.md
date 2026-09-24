# Azimut v0.3.1

Azimut is a local OSINT workspace: media, geolocation work, proofs and notes in
one portable case folder, on your own machine.

This release sweeps an area for what appeared, by day or by radar, and puts
maps made elsewhere on yours.

## Detect

- **Detect** is a new tab under Map. Draw one or more areas on
  Sentinel-2 and it sweeps them at full resolution for vessels, fires and gas
  flares, construction, small spots, any surface change, burn scars, vegetation
  loss or new water.
- Five radar analyzers read Sentinel-1 through cloud and at night: vessels, any
  change, damaged or razed buildings, new structures and vehicles, and floods.
  They use a Sentinel-1 layer you add to your Copernicus configuration, and
  Settings → Imagery walks you through it.
- **New analyzer** builds your own from up to six rules on a band, an index, a
  ground class or radar, and shows on the map what each rule keeps as you change it.
  Checks are places you trust, pinned as "should be found" or "should stay
  empty", and they turn red when a rule stops holding. Five examples ship with
  their checks: Lahaina, Grünheide, Kakhovka, Dubai and Fujairah.
- Ask for a small, medium or large target instead of setting thresholds. The
  areas are priced in Copernicus requests before anything is fetched.
- **Find passes** lists the dates your areas really have, with how much of them
  each pass covered and how cloudy it was. A finished run says how much it read,
  so "nothing found" and "never looked" stay apart.
- Candidates come strongest first, one at a time, sized along their footprint.
  **Pin** files one with its own evidence crop and a claim dated by the passes
  that found it; **Keep** leaves it in the run. Nothing else reaches the case.
- A candidate opens in Compare on the passes that found it.
- Areas can be saved with the case. A routine keeps an analyzer, its areas and a
  date rule together, and **Run routine** repeats the sweep.
- Detect needs Copernicus credentials in Settings.

## Compare

- Compare opens on a Wayback release from a year ago against today's World
  Imagery, with no key needed. **New** offers the other starting pairs.
- **All dates** lists every dated picture of the point and narrows down, a
  question at a time, between which two a change appeared.
- Sentinel-1 radar passes are a basemap in Satellite, Compare and Detect, named
  by day, UTC time and direction.
- A saved comparison stands on the map beside the captures, dated A → B, and
  reopens in Compare.
- "Change assist" is now **Difference**. Its cloud switch uses the same
  Sentinel-2 cloud and shadow mask as Detect instead of guessing from the
  picture, so a white roof is no longer taken for a cloud.
- MNDWI and BSI join the spectral indices. An index draws its line at a stated
  change, so panning no longer moves it.
- Tone matching is off by default on a Sentinel-2 pair.
- Difference is a switch beside the four views rather than a view of its own:
  its highlights lie over side by side, swipe, fade or blink, on A, B or both.
  They can blink.
- Right-click the ground, or a shape drawn on it, for the point menu. A drag
  inside a box, an ellipse or a polygon moves the map; a shape is picked by its
  outline.
- Right-click a point on the Satellite map to open Compare on its last two
  Wayback pictures or its last two Copernicus passes.
- An export frame sets what an export shows. Numbered markers and blur boxes can
  be stamped on the ground.
- On a turned map, boxes and ellipses are drawn along the screen, and any shape
  turns from the grip above it. The export frame keeps its shape when the
  camera turns, and exports upright as drawn.
- Difference's settings stay put through a read, lie over the highlights, and
  close on a click outside them.

## One camera for the maps

- Satellite, Compare and Detect show the same ground: pan one and the others are
  there when you switch. A link carries it to other windows. A Detect review and
  an open saved comparison keep their own view, and Settings → General turns
  the sharing off.
- A middle-drag turns any map, or an Inspect frame, about the point you grabbed,
  in 15° steps with Ctrl. A middle click or Shift+↑ puts north back.

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

## Inspect and Collage

- Inspect keeps one work per file, saved as you go, with its frames on a strip.
  There are no sessions to open or save. **Save to case** is still the only step
  that files a frame or an adjusted video as media.
- **Collage** is a tab of its own. It lays out frames and images from any number
  of files, and the picture it exports is case media.
- The file name in Inspect's header renames the media itself.
- The first time a case opens, its 0.3.0 Inspect sessions of one file become one
  work: the latest is kept, and the others' notes and names are carried into it.

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

## Security and privacy

- A case file opened in a tab, such as an SVG or a web page from a received
  bundle, is shown without running its script.
- A web page open in your browser can no longer make Azimut fetch tiles or run
  lookups on your keys: a request from another site is refused.
- A bundle no longer carries folder paths of the machine that exported it, nor
  the database journal of a save in progress.
- Over another map site, the extension's panel is out of that site's reach: it
  can neither read the panel nor press its buttons.
- A key a provider refuses no longer appears in the error message.
- A followed map layer received in a bundle reads its source only when you press
  Refresh, and a refresh never asks an icon host again. Stored icons are checked
  before they are shown.
- Home and the Guide say what the startup check asks: GitHub for a new release,
  PyPI for the downloaders.

## Fixes

- Changing only the case of a collage, comparison, draft or proof name renames it
  on Windows and macOS, where it used to delete the collage or be refused.
- Two names that differ only by case can no longer sit side by side on Linux and
  block a bundle export. When an export does refuse, it names both files.
- A layer, proof, draft or grid with "#" in its name opens and deletes itself, not
  the one whose name stops before it.
- A proof date or description cleared in Details stays cleared.
- A layer refresh keeps a legend or title change made while it was reading, and a
  layer deleted meanwhile stays deleted.
- Undoing a Detect pin takes its evidence picture to the Trash with it.
- A routine whose area is in the Trash asks for the area back first. One whose
  area is gone for good still opens and says so.
- A new comparison no longer picks up the kept images of a deleted one with the
  same name.
- A damaged KMZ or a deeply nested GeoJSON is refused with a reason instead of a
  server error.
- Notes, proofs, drafts and layer settings are written whole, so a save cut
  short keeps the previous version.
- The tile cache clears tiles older than 30 days at startup, including those
  Detect read.
- Copies of 0.3.0 Inspect sessions stay out of bundles and go with their file
  once it leaves the Trash.
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
fonts used for PDF export. The Linux file needs glibc 2.38 or newer (Ubuntu
24.04, Debian 13, Fedora 39 or later); on an older distribution, install with
`pipx install azimut`.

On Intel Macs (macOS 14 or newer), install the Python package instead:
`pipx install azimut` or `pip install azimut`.

The downloads are unsigned, so your system will warn you the first time. On
macOS, make the file executable with `chmod +x` before opening it. The README
gives the steps for each platform.

The capture extension changed in this release. Chrome, Edge and Brave users
update it from Settings → Capture extension. Firefox updates the signed add-on by
itself; a new install uses `azimut-capture-0.3.1.xpi` attached to this release,
opened from `about:addons` → gear menu → **Install Add-on From File**.

Your existing cases open as they are. Apart from Inspect sessions becoming one
work per file, nothing changes in them, no export or manual step is needed, and
older case bundles still import.
