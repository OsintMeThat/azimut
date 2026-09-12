# Azimut Capture browser extension

Files map captures, places and bookmarks into
[Azimut](https://github.com/OsintMeThat/azimut). Captures retain their source
URL, timestamp, parsed coordinates when available and visible attribution.

The extension sends the screenshot and page URL. Azimut parses supported sites,
coordinates, place names and imagery dates, so URL-format fixes ship with the
app.

It supports six flows:

- On a supported map site, the popup can capture a selected area or save its
  coordinates as a place.
- On a 2D map, it can draw Azimut's own tools over the site: measure, media
  pins, sun and moon, a search grid, and the case's own images and videos held
  over the map.
- On another page, it can save the URL and title as a bookmark without
  downloading the page.
- On Azimut's Google basemap, the in-app Capture button requests the current
  tab image without a screen-share prompt.
- When Geo Report publishes, it can open X or Bluesky with the thread already
  typed and the proof attached. It never presses Post: the composer is left
  filled, and publishing stays a human act.
- When Reverse Search opens an engine, it can hand the picture to the engine's
  own uploader, so the search runs on the press you already made.

## Install

Two roads, because the browsers disagree about what a permanent extension is.

### Chrome, Edge, Brave (Windows, macOS, Linux)

In Azimut → **Settings → Capture extension**, press **Install**. The app writes
the extension into a folder it owns and shows you the path. Copy that path —
pasting it into the browser's picker works everywhere, and the folder is hidden
under `.azimut/`, so navigating to it is the harder road.

Open `chrome://extensions`, enable **Developer mode** (top right), click
**Load unpacked**, then paste the path (`Ctrl+L` on Linux, `Cmd+Shift+G` on
macOS, the filename box on Windows). Leave the folder where it is: Chrome loads
it from there on every start, and it is what the update button rewrites.

Settings also offers the plain **.zip** for anyone who would rather place the
files themselves. It works the same, minus the update button: Azimut can only
rewrite the folder it owns.

### Firefox

Firefox refuses an unsigned extension and drops an unpacked one when it closes,
with no preference to turn either off outside the developer channels. So it gets
a signed package instead: download `azimut-capture-<version>.xpi` from the
[latest release](https://github.com/OsintMeThat/azimut/releases/latest), open
`about:addons`, and use the gear menu → **Install Add-on From File**. It survives
restarts, and it updates itself.

The file is signed by Mozilla but listed nowhere: signing and distribution are
separate, so the add-on is validated and installable without being published on
addons.mozilla.org.

## Update

**Chrome, Edge, Brave**: Settings → **Capture extension** → **Update**, once the
button lights up. Azimut rewrites the folder and the extension restarts and
re-attaches itself, so nothing needs reloading — not the extension, not the page.
Your pairing survives. Even without pressing anything it lands eventually, since
Chrome re-reads unpacked extensions when it starts.

Two things worth knowing there:

- If a browser is holding the old files (Windows does this), Azimut says the
  files are staged. Close the browser and press again.
- Chrome derives an extension's identity from its folder, so if you already had
  the extension loaded from a folder of your own, that copy and this one are two
  extensions. Settings names the one to remove. Removing it loses its stored
  pairing, so paste the token again afterwards — once.

**Firefox**: nothing to press. A signed package is sealed, so Azimut cannot
rewrite it and the Update button does not apply. Firefox reads Azimut's update
manifest about once a day and replaces the add-on itself; your pairing survives.
Settings says as much when it detects a copy the browser manages.

Two consequences of the browser owning that update, and both are named rather
than hidden:

- Azimut can tell you the add-on is behind the moment you open it, since it ships
  the extension and knows the version offline. Firefox applies it within the day,
  or at once from `about:addons` → **Check for Updates**. Nothing can ask Firefox
  to check earlier: it does not implement the API that would.
- Firefox updates the add-on without knowing which Azimut sits beside it, so an
  app left un-updated can end up paired with a newer add-on. Settings and the
  extension's own options page both say so, and the answer is to update the app —
  its newer flows report that they could not run rather than misbehave.

## Map tools

**Draw tools over this map**, in the popup, opens a panel over the site you are
on. Press it again to close it. Five tools share it:

| Tool | What it does |
|---|---|
| Measure | Distance along a clicked path, or the area it encloses. Same formulas and same wording as the app. |
| Points | Draws the case's saved work on the map, and files a new point. |
| Sun & moon | Plants a point and draws the day's sun and moon arcs around it, with a date and an hour slider. |
| Grid | Drags a box or clicks out a shape, cuts it into metric cells, and marks each cleared or flagged. The grid is saved into the case and opens in the app's own Grid Search. |
| Refs | Floats an image or a video from the case over the map, to compare against the imagery while you pan. |

Only the open tool draws, and pressing it again puts it down: the map goes back to
being a map. What you told a tool stays in it — a measured path, a planted point,
an open sweep all come back when you pick it up again. Reference windows are the
exception, because they are not on the map: they stay while you measure.

**A reference window is scratch.** Drag it by its header, resize it from the
corner, wheel to zoom into the image, double-click the title bar to fold it away.
Nothing about it is filed, nothing comes back next visit, and the panel and its
windows step out of the frame before a capture is taken — a reference floating
over a map must never end up inside the evidence.

**Add reference** lists the case's images and videos, searched, filtered by kind
and ordered by the app rather than by this tab: what crosses is one page of a case,
never the case. A video plays in the window, with its own controls.

Two limits worth knowing. A file has to be **under 24 MB** to be handed over, which
is the same ceiling a published thread's attachments answer to. And a video is the
one thing here a site can refuse: an image is decoded and painted on a canvas,
which asks the page's content policy nothing, while a video needs a URL and some
sites will not load one. When that happens the window says so.

Reference windows work where the geometric tools do not — Street View, a pitched
camera, a globe — since nothing about holding a reference up needs the ground to
be measurable, and they stay on screen while you use another tool.

**It works from what the site writes about itself.** Every one of these maps states
how far out it is: a tile level for most of them, a viewport height in metres for
Google's satellite view, a span in degrees for Apple. Each of those was checked in a
real browser before being believed — driven at two window sizes, dragged a known
number of pixels, read back out of the address bar (`docs/MAP_SITES.md`) — and the
drawing works from the first frame, with nothing to calibrate.

**Zoom once and it knows where the map's middle is.** The coordinate in the address
bar is not under the middle of the window on most of these sites: Yandex draws it
210 px to the right of it, behind its results panel, Bing 40 px down under its
header. A pan can never see that offset, because it slides along with the map — but
a zoom can, since every one of these maps zooms about a point it holds still while
the centre moves underneath. So the first zoom you make measures it, the panel
remembers it for that site and that window shape, and every zoom after checks it
again. Until then the panel says "zoom once to place it" in its status line. The
number it settled on is in the tooltip of that line, which is where to read it
when something lands somewhere the ground is not.

**Each pan is a check.** The panel predicts where the map will land and compares
that with what the address bar says. When the prediction drifts, geometry switches
off and the panel says why instead of drawing something wrong.

**Where the URL is not enough.** Earth states no level and no flattening, only a
camera distance, so there the map itself is the authority: pan once and it is
measured. Apple states a live span but a stale `z` — it carries whatever the opening
link had and never rewrites it — so the span is read and the `z` ignored. Bing
rounds: its wheel moves a third of a level and it writes one decimal, so the
fraction is worked out from the same held pixel rather than read. Whole levels are
exact everywhere, which is what a double-click lands on.

Earth and 3D mode work with the camera **level**; pitched, the panel refuses them,
because a cell would land on the wall of the building hiding it. One limit remains
there that no measurement can remove: **relief**. A level camera still pushes a
hilltop outward from the centre of the screen by its own height, and no URL says how
tall the ground is. Flat country is exact; mountains are not, and the further from
the centre of the screen, the more so.

**Google Earth asks for one drag before it draws.** Its address bar states no
scale of any kind, so the map itself is the only authority and a drag is the
question: across *and* down, since a scale is two numbers, and letting go only
once the map has stopped, because these viewers glide on and report where they
landed rather than where you let go. The panel says exactly that until it has
its answer. One drag is the whole cost — zooming, turning and panning after it
are free.

**The drawing dims while the map is still moving.** These maps glide on after you
let go and ease into a zoom, and they say so nowhere — the address bar is rewritten
once, at the end. A drag is followed exactly, because the map goes where the pointer
goes; the glide and the zoom are not followed at all. Dimmed means "not right now",
which is the honest thing for a tool whose output ends up in a case file.

**Saved points are drawn without their names.** Point at a mark to read it, click
to keep it open. Points at the same spot merge into one counted mark, the way the
app's own Saved layer merges them.

**The case stays in step, in every window onto it.** Save a point in the app and
it appears here; mark a cell here and it appears in the app's own Grid Search and
in any other map you have the panel open on. Nothing needs reloading and nothing
needs pressing: the app says what changed and each side re-reads that much.

A grid swept from two places at once both lands, because what travels is the
cells you marked and never a copy of the grid — so two sweeps of different cells
keep each other's work, and the same cell twice is simply the last mark. A grid
discarded elsewhere closes here and says so.

Street View and a pitched 3D camera have no ground plane to measure on, so the
geometric tools are off there, and the panel says which view it wants back: the
map rather than Street View, 2D rather than 3D. A degree or two is not pitched:
these viewers never come back to a clean zero, and a view that looks level is
treated as level. Placing a point
still works wherever geometry is off, anchored on the point the address bar
names — where the camera stands — and the panel says so.

**Turning the map is fine.** Drag Google Earth's compass and the drawing turns
with it, keeping the scale it had: what was measured is pixels per degree, and
degrees do not care which way the screen is facing. Only tilting the camera
switches the geometric tools off. One gesture that turns *and* zooms at the same
time asks for a pan again, because nothing in the address bar says which of the
two moved the scale.

Zoomed far out, where these sites start drawing a globe, the tools stay on: the
middle of the screen is still right, the edges drift, and the drawing is dimmed
and says so rather than disappearing. It is a look at a region's work, not a
measurement — zoom in and it is exact again. Sun & moon is the exception and is
never dimmed: it answers which way the light came from, read at its own anchor,
and that is right however far out you are.

Where a site's own panel can be collapsed mid-session, the offset moves with it, and
the drawing is out by that much until the next zoom measures it again. Resizing the
window or changing the browser's zoom asks for that zoom too: some of these panels
keep their width and some of them do not, and no address bar says which. The last
four window shapes are kept per site, so going back to one you have already
measured places the drawing again without asking.

## Pair (external sites only)

1. Azimut → **Settings → Capture extension** → copy the pairing token.
2. Extension options (right-click the toolbar icon → Options) → paste the
   token → **Save & test**.

The token allows this extension to file captures through the local Azimut
server, to read back the media and proofs a thread attaches, and — for the map
tools — the saved points, search grids, images and videos of the case you pick. Rotate it in
Settings to revoke existing pairings.

## Fill the composer

Geo Report's **Publish** opens the site's full composer, types each post of the
thread and attaches its pictures. Nothing is posted: the composer is left filled
and the button is yours.

There is one switch and it is in the app — **Settings → Publishing → Let the
extension fill the composer**, on by default. Nothing to set here.

The filling runs in the page's own world, which is the only place a composer
accepts what it is given. That needs Firefox 128 or later; on an older Firefox
this one flow reports that it could not run, and everything else works as before.

If the site has changed its markup, or a file is too large to hand over, it
fills what it can and says so. Each post is read back after it is typed, and one
the composer will not take cleanly is left empty rather than half-written. The
whole thread is on your clipboard either way, which is what Publish did before
this existed.

## Open a reverse-search engine

Reverse Search's engine buttons open Google Lens, Yandex, Bing or TinEye with
the case picture already in the page's own uploader, so the engine searches
without you pasting or dragging anything.

This is the one flow where the page acts on what it is given: an engine searches
the moment it holds a picture. That is what the button was pressed for, and it
still takes that press — nothing is sent to an engine you did not open.

The switch is in the app — **Settings → General → Let the extension open the
engine with the image**, on by default. Nothing to set here.

If the engine has changed its markup, or the image is too large to carry, the
buttons do what they always did: copy it, or save it for you to drag in. The
image is on your clipboard either way.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Reads the current URL and captures the tab only after you click the extension. |
| `scripting` | Shows the area-selection overlay, draws the map tools panel, fills a composer you allowed, and hands an image to an engine you opened. |
| `storage` | Stores the local app URL, pairing token and last-used case. |
| `notifications` | Reports an area capture after the popup closes. |
| `http://127.0.0.1/*`, `http://localhost/*` | Connects to the local Azimut app. |
| `https://x.com/*`, `https://twitter.com/*`, `https://bsky.app/*` | Types a prepared thread into the composer, when Azimut asks. Never reads those pages, never posts. |
| `https://lens.google.com/*`, `https://www.google.com/*`, `https://yandex.com/*`, `https://www.bing.com/*`, `https://tineye.com/*` | Gives a prepared image to the engine's uploader, when Azimut asks. Never reads those pages. `www.google.com` is there because Lens redirects to it. |

The in-app Capture button may require one initial toolbar click for a new tab.
Browsers require that gesture before allowing a tab screenshot. The extension
does not request `<all_urls>`, history access or remote-server access.
