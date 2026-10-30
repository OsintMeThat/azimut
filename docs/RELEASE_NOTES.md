# Azimut v0.3.3

Azimut is a local OSINT workspace: media, geolocation work, proofs and notes in
one portable case folder, on your own machine.

## In short

- **Horizon**: stand on any point and see its skyline in 3D, then lay a photo
  over it to match by hand.
- **Find**, in beta: ranks the places of an area whose relief fits a photo's
  skyline, for you to check.
- **3D map**: Satellite's imagery stands on its relief, with your layers and
  measures on it.
- **Your own map layers**: draw on any map, every edit dated, then download
  the layer or send it to My Maps.
- **Map plates**: map pages ready to publish, exported as an image, a PDF or a
  video of their days.
- **Measure**: one tool for distances, areas, range rings, view cones, a
  viewshed and the line of sight.

The details follow, tool by tool.

## Horizon

- **Horizon** draws the terrain seen from a viewpoint in 3D, with named
  summits, ridge lines, the sun and the moon, the haze, and buildings from open
  sources that say where each height comes from. Buildings are in beta.
- **Overlay** lays a photo over the view. Trace its skyline and ridges, then
  match it by hand or press **Fit**.
- A saved view reopens as it was, photo, trace and buildings included. After a
  reload, **Resume** lays back the work no save had kept yet.

## Find, in beta

- **Find** ranks the places of an area whose relief fits the skyline traced on
  a photo. The places are candidates for you to check, not an answer.
- Find opens once on a notice about the beta. The `?` guide walks a real
  search in **Search with Find**, and **Try this search** opens it in a case of
  its own, ready to press Search.
  [docs/FIND.md](https://github.com/OsintMeThat/azimut/blob/v0.3.3/docs/FIND.md)
  says where Find is strong, where it fails and how to use it well.
- **Prepare** runs four steps: Skyline, Area, Mesh and Search. What you know
  about the photo narrows the grid before the search: which way it faces, the
  ground the eye stands on, the sea in sight, the zoom, the sun on a given day.
- The grid shows on the map before, during and after a search. Brush points
  off or on, search several areas at once, or try a single point.
- A result says how far its best place can be trusted (**Solid**, **Check it**
  or **Weak**), what does not fit there and what the area scores by chance.
  **Check against decoys** tries the places again with the trace mirrored and
  upside down.
- A collage of a pan is read frame by frame, and a video's lens is measured on
  its pan.
- **Save** (Ctrl+S) keeps a search in the case without running it. Searches go
  to the Trash, travel in bundles and open from Files and the Board.
- A search runs on several cores and stays within this computer's free memory.

## 3D map and Measure

- **3D** in Satellite stands the imagery on public relief, on a globe Azimut
  draws itself. Your layers, places and measures show on it as on the flat map.
- A tilted view files as a credited capture that reopens as it was taken.
- **Measure** is one tool for lines and areas, their legs, bearings and angles.
  A line also works as range rings, a view cone, a shadow's height or a
  viewshed.
- Measure reads the ground and the line of sight under a line, flat and on the
  globe.
- Borders are OpenStreetMap lines on every map, with regions and districts in
  their own weight.

## Your own map layers

- Draw markers, lines and areas on any map, from a blank layer, a file or a My
  Maps link.
- A layer can follow the case's places, proofs and files, and takes pasted
  coordinates, map links and posts.
- Every edit is dated, so a layer reads on any day, with that day's changes
  ringed. Its days show on its time strip and, if you want, on the Timeline.
- Import your own icons in Settings: files, folders, zipped packs or SVG. A
  colour is one press away among the recent ones, or pasted as a code.
- A case key names what each colour and icon stands for.
- Compare, Detect and Horizon offer every layer from one Layers menu, and each
  case reopens on the layers its maps had on.
- A layer downloads as KMZ with its icons, KML or GeoJSON, or goes to My Maps
  as it stood on one day.

## Map plates

- A plate lays a page out round the case's maps: title, legend, scale, north,
  inset, tables, pictures and credits. Start from one of ten ready plates or
  from your own template.
- The map sits on one of ten vector grounds, a topographic one, 3D relief,
  Sentinel-2 cloudless or a dated Sentinel-2 pass.
- A look sets paper, colours and type in one press. A layer can take a role
  (held, claimed, contested, front) named in the legend, and one country can be
  lit with the rest drawn back.
- A plate plays day by day and step by step, each with its own annotations,
  framing and transition, and a step can run a case video.
- Export a PNG, a print PDF, an MP4, a GIF or an evolution sheet. The export
  runs while you work in another tool.
- A plate's layout keeps as a template, shared as a file.

## Pictures, clips and proofs

- A reference window fades a case picture or clip over any map. Step or slow a
  clip, keep a frame, pin the window to a corner or dock it in a column. The
  capture extension has the same windows over other sites' maps.
- Pictures, videos and sounds open in one full-screen viewer.
- Inspect captures the very frame on screen and lays frames, marks and sound
  along its bar.
- Collage straightens a panorama: a line drawn along something level bends the
  whole collage flat, seams kept.
- Proof marks sit free on the page or tie across panels, at one line width on
  every panel.
- Drop a Media Library card on a sidebar folder to file it there.

## Getting started

- A newcomer is welcomed and shown the four stages of a case, ending on their
  first case and the `?` guide.
- Each new version opens on its What's new.
- The `?` guide pictures every tool and opens in a tab of its own. It walks a
  geolocation to its published thread, an analyzer through Detect and a search
  through Find.
- When a release is out, the update notice downloads the file for your system
  and lists the steps to put it in place.

## Fixes and safety

- Renaming a file updates it in Horizon views, Find searches and map plates
  too.
- A bundle made by a newer Azimut is refused with the version to install.
- A settings backup merges its templates with yours, as it does icons.
- Settings → Storage shows and resets the views and sheets export folders.
- No other site can show Azimut inside a frame.
- gallery-dl runs as a program of its own, so an update from Settings applies
  without a restart.

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
install, open `azimut-capture-0.3.3.xpi` from this release in `about:addons` →
gear menu → **Install Add-on From File**.

Your cases open as they are and older bundles still import. If you go back to
0.3.2, make your bundles in 0.3.3: a bundle 0.3.2 makes of a case leaves out
its map plates and Horizon work.
