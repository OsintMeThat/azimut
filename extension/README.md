# Azimut Capture browser extension

Files map captures, places and bookmarks into
[Azimut](https://github.com/OsintMeThat/azimut). Captures retain their source
URL, timestamp, parsed coordinates when available and visible attribution.

The extension sends the screenshot and page URL. Azimut parses supported sites,
coordinates, place names and imagery dates, so URL-format fixes ship with the
app.

It supports six flows:

- On a supported map site, the popup can capture a selected area or save its
  coordinates as a place. A capture can carry a scale bar and a north arrow,
  ticked in the popup and remembered from then on; the app draws them, from the
  zoom and the pixel ratio the grab was taken at. Most of these sites write no
  rotation into their URL, so the needle waits for a bearing in the field above
  rather than pointing at a guess.
- On a 2D map, it can draw Azimut's own tools over the site: measure, media
  pins, sun and moon, a search grid, the case's own images and videos held over
  the map, and NASA FIRMS fire detections laid over whatever that map is
  showing.
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
on. Press it again to close it. Six tools share it:

| Tool | What it does |
|---|---|
| Measure | Distance along a clicked path, or the area it encloses. Same formulas and same wording as the app. |
| Points | Draws one of the case's three positions — its located media, its places, its captures — on the map, and files a new point. |
| Sun & moon | Plants a point and draws the day's sun and moon arcs around it, with a date and an hour slider. |
| Grid | Drags a box or clicks out a shape, cuts it into metric cells, and marks each cleared or flagged. The grid is saved into the case and opens in the app's own Grid Search. |
| Refs | Floats an image or a video from the case over the map, to compare against the imagery while you pan. |
| Fires | Lays NASA FIRMS thermal detections over the site: the last 24 h to 7 days, or any past day or range up to 31 days picked from a calendar drawn inside the panel. Needs a FIRMS key in Azimut's own Settings — without one the seat is greyed and says so — and stops at z14 where one mark stops meaning one detection. |

Only the open tool draws, and pressing it again puts it down: the map goes back to
being a map. What you told a tool stays in it — a measured path, a planted point,
an open sweep all come back when you pick it up again. Reference windows and the
fire layer are the exceptions: the windows are not on the map, and the fires are
ground rather than drawing, so both stay while you measure over them.

**Link the view** with the chain button in the panel's header. It puts this map on
one camera with the other linked maps: other panels on other sites, and the app's
own map tabs whose link is pressed. It is greyed until there is a second map to
link to. Pressing it brings the others to this map; from then on a pan or a zoom
here moves them, and one there moves this.

A site's map is moved by writing the view into its address bar, so Google, Bing,
Apple, Yandex, Earth and Copernicus reload to follow, and the panel comes back on
its own once the page has loaded. OpenStreetMap, Zoom Earth and Satellites.pro take
it without reloading. Only moving a map yourself leads: a map that arrived because
it was sent stays quiet.

A tab in the background waits. It keeps the last view it was sent and goes there
when you come back to it, so a site reloads once instead of once per gesture on the
map you are moving. A tab you can see follows straight away, including the front
tab of a window you are not typing in.

Each map follows as close as it goes. Zoom Earth stops at 11, Copernicus at 18,
Google at 21, and the others are not asked to stop there with it: the status line
says "as close as this map goes" instead. Street View and a tilted camera are left
where they are. Apple opens no view nearer a pole than 70.5°, so a view past it
stops there and the rest is a drag. A map already stopped at the limit is left
alone by a view asking for the same ground again, rather than reloaded once per
gesture on the map it follows. While an Apple place card is open the page
hides where the map is, and the panel waits until the card is closed.

On Firefox the panel may not come back after a reload on Apple, Earth or
Copernicus, which the extension holds no host permission for. The other panels
say so, and pressing the toolbar button on that tab puts it back.

**A reference window is scratch.** Drag it by its header, resize it from the
corner, wheel to zoom into the image, double-click the title bar to fold it away.
Nothing about it is filed, nothing comes back next visit, and the panel and its
windows step out of the frame before a capture is taken — a reference floating
over a map must never end up inside the evidence.

**Add reference** lists the case's images and videos, searched, filtered by kind
and ordered by the app rather than by this tab: what crosses is one page of a case,
never the case. A video plays in the window, with its own controls.

Two limits worth knowing. A reference has to be **under 512 MB**, and it crosses in
pieces, so a long clip opens the way it does in the app's own Satellite tab — the
window counts up while it arrives. A published thread's attachments answer to a
lower ceiling, **48 MB**, since those are pushed into the composer's page whole.
And a video is the one thing here a site can refuse: an image is decoded and
painted on a canvas, which asks the page's content policy nothing, while a video
needs a URL and some sites will not load one. When that happens the window says so.

Reference windows work where the geometric tools do not — Street View, a pitched
camera, a globe — since nothing about holding a reference up needs the ground to
be measurable, and they stay on screen while you use another tool.

**It works from what the site writes about itself.** Every one of these maps states
how far out it is: a tile level for most of them, a viewport height in metres for
Google's satellite view, a span in degrees for Apple, a camera distance and a field
of view for Google Earth. Each of those was checked in a real browser before being
believed (`docs/MAP_SITES.md`), and the drawing works from the first frame, with
nothing to calibrate. Nothing is ever measured off a drag: a drag loses pixels to
the site's own threshold and gains them to its glide, which is how Earth's marks
once ended up four times too close together.

**It starts placed, and a zoom places it better.** The coordinate in the address
bar is not under the middle of the window on most of these sites: Yandex draws it
210 px to the right of it, behind its results panel, Bing 40 px down under its
header. The app ships what its own calibration run measured, so a fresh install
draws from the right pixel on the sites whose chrome does not move
(`docs/MAP_SITES.md`). Apple's sidebar does move — it folds away in a narrow
window — so Apple starts at the middle and is measured instead.

Measuring it takes a zoom. A pan can never see the offset, because it slides along
with the map; a zoom can, since every one of these maps zooms about a point it
holds still while the centre moves underneath. So the first zoom you make measures
it, the panel remembers it for that site and that window shape, and every zoom
after checks it again. Until then the status line says "zoom once to place it",
and the tooltip on that line carries the offset being drawn from and where it came
from — which is what to read when something lands somewhere the ground is not.

**Google Earth is read like the others.** Its 2D map is Web Mercator, drawn about
the middle of the window, and `d` and `y` in its address bar give the scale. A link
written by hand, or the app's own "Open in Google Earth", has no ground height in
it, and Earth draws it nearer than it says. So until you move the map once, which
is when Earth writes the ground in, the panel shows "Move the map once so its
address bar gives the scale" and draws nothing.

Apple states a live span but a stale `z` — it carries whatever the opening
link had and never rewrites it — so the span is read and the `z` ignored. Bing
rounds: its wheel moves a third of a level and it writes one decimal, so the
fraction is worked out from the same held pixel rather than read. Whole levels are
exact everywhere, which is what a double-click lands on.

Earth's 3D mode and Google's Earth mode work with the camera **level**; pitched,
the panel refuses them, because a cell would land on the wall of the building hiding
it. One limit remains there that no measurement can remove: **relief**. A level 3D
camera still pushes a hilltop outward from the centre of the screen by its own
height, and no URL says how tall the ground is. Earth's 2D map has no such problem.

**The drawing dims while the map is still moving.** These maps glide on after you
let go and ease into a zoom. A drag is followed exactly, because the map goes where
the pointer goes; the glide and the zoom are not followed at all. The drawing comes
back once the address bar has stopped changing, which on Earth is after the last of
the several addresses it writes during one zoom. Dimmed means "not right now",
which is the honest thing for a tool whose output ends up in a case file.

**Saved points are drawn without their names.** Point at a mark to read it, click
to keep it open. Points at the same spot merge into one counted mark, the way the
app's own Saved layer merges them.

**One position is drawn at a time**, the same three the app's Saved panel offers
and in the same order: the located media the case collected, the places dropped
by hand, the captures taken of them. The panel opens on the media, and switching
position reads that position — a file carries no coordinates of its own and is
not in the index the other two come from. Filing a point goes to Places, so the
point just filed is drawn rather than swallowed.

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
with it. Only tilting the camera switches the geometric tools off.

Zoomed far out there are two cases and they get different answers. On a **flat
map drawn small** — Google and Bing below level 8 — the tools stay on: the middle
of the screen is still right, the edges drift, and the drawing is dimmed and says
so rather than disappearing. It is a look at a region's work, not a measurement;
zoom in and it is exact again. Sun & moon is the exception and is never dimmed:
it answers which way the light came from, read at its own anchor, and that is
right however far out you are.

On a **globe camera** (Earth's 3D mode more than 150 km out, and Google's Earth
mode with it) nothing is drawn: no marks, no grid, no fire picture. That view is a
perspective shot of a sphere, with no point the flat arithmetic is right about
and no edge the error stays in, so the panel says "The camera is on a globe this
far out, so zoom in" instead of dimming something nobody can judge. Come down and
everything draws again. Earth's 2D map stays flat however far out you go, so it is
never refused.

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
tools — the points, search grids, images and videos of the case you pick. Rotate it in
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

Attachments cross from the local case in small pieces. Videos can therefore
reach the app's 512 MB hand-off ceiling without one oversized browser message.

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
