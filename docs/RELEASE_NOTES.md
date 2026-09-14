# Azimut v0.3.0

Azimut is a local OSINT workspace: media, geolocation work, proofs and notes in
one portable case folder, on your own machine.

This release rebuilds the map and gives it much more to show, and lets the
capture extension draw Azimut's own tools over other map sites.

## A new map

The Satellite map now runs on MapLibre. Your providers, captures and map rotation
work as before, including the Google basemap.

- The screen is laid out again: modes in one rail, layers in the right panel,
  imagery in the map corner, and your position in a status line underneath.
- Right-click the ground to copy that point in every format, look it up, save it,
  measure from it, read the sun and moon there, open its imagery history, or open
  it on another map site.
- **Esri Wayback** is a basemap now. Pick any World Imagery release, or list only
  the releases that brought a new picture of the point you are looking at. The
  chip gives the date the picture was taken, which is often long before the
  release.
- Stack overlays that need no key: borders, roads, railways, power lines, sea
  marks and GPS traces. Add NASA FIRMS fire detections (with a free FIRMS key in
  Settings) and VIIRS night lights for a day you pick. FIRMS detections remain
  visible as enlarged squares when you zoom past their native detail.
- Filter the pins drawn on the map by kind and by folder.
- Open the map in several tabs. The view is in the address, two tabs can share one
  camera, and a point saved or a grid swept in one appears at once in the others.
- A capture can carry a scale bar and a north arrow.
- Trace a place's uncertainty as a shape around its pin, for a quay or a treeline
  that a circle describes badly.

## Capture extension

- On a 2D map site, the extension can now draw Azimut's tools over the page:
  measure, the case's saved points, sun and moon, a search grid that opens in the
  app afterwards, NASA FIRMS fires, and floating windows holding the case's own
  pictures and videos.
- The scale is read from what each site writes in its address bar, checked site by
  site in a real browser. On a view the tools cannot work with, such as Street View
  or a tilted 3D camera, they switch off and say which view they need.
- Geo Report fills the X or Bluesky composer with the whole thread, one box per
  post with its pictures attached. Posting stays your click.
- Reverse Search puts the picture straight into the Lens, Yandex, Bing or TinEye
  uploader, so one press runs the search.
- On Chrome, Edge and Brave, updating the extension is a button in Settings.
  Firefox gets a signed add-on that updates itself, and Settings tells you when
  your copy is out of step with the app.
- Mastodon is no longer a Geo Report target. A draft saved for it opens on X.

## Elsewhere

- The app opens on **Home**: what is left to do in the case, what was filed
  recently, and the case's points on a small map. With no case open, it explains
  what Azimut is and helps you start one.
- A **Guide** with one section per tool and a few worked examples. The `?` in the
  top bar opens it on the tool you are using.
- New case folders keep the name you typed, spaces, accents and non-Latin scripts
  included, instead of a lowercase ASCII version of it.
- The Media Library no longer lists satellite captures and extension screenshots by
  default. Satellite's Saved panel is where they live, and the library's switch
  still shows them.
- Auto-stitch sizes the collage canvas to the panorama instead of shrinking it to
  fit, and you can set the canvas size by hand.
- In Geo Proof, a shape you just drew stays selected so you can restyle it straight
  away. The stamp tool stays in hand for marking several things in a row.
- Sheets are listed newest first.

## Fixes

- Thumbnails and metadata enrichment no longer stop for the rest of the session
  when the background worker dies unexpectedly.
- Naming a proof's first point, or marking it as the camera position, is now saved
  when its coordinate field was left empty.

## Install or upgrade

Download the ready-to-run file for Windows x86_64, Linux x86_64 or Apple
Silicon macOS and run it. Each one includes the interface, `ffmpeg` and the
fonts used for PDF export.

On Intel Macs (macOS 14 or newer), install the Python package instead:
`pipx install azimut` or `pip install azimut`.

The downloads are unsigned, so your system will warn you the first time. The
README explains the prompt for each platform.

Firefox users install the signed `azimut-capture-0.3.0.xpi` attached to this
release. Chrome, Edge and Brave users install or update the extension from
Settings → Capture extension.

Your existing cases open as they are. No export, migration or manual step is
needed, and older case bundles still import.
