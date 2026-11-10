# Azimut Capture browser extension

Files map captures, places and bookmarks into
[Azimut](https://github.com/OsintMeThat/azimut). Captures retain their source
URL, timestamp, parsed coordinates when available and visible attribution.

The extension sends the screenshot and page URL. Azimut parses supported sites,
coordinates, place names and imagery dates, so URL-format fixes ship with the
app.

One press on its toolbar button (or Alt+Shift+A) opens what the page is for: on a
supported map site, a panel over the map; on any other page, the case's note
beside it; on Azimut's own tab, nothing, since the press is what lets the app
capture that tab. Until the extension is paired, the button opens the pairing
instead (see Pair).

It supports seven flows:

- On a supported map site, the panel's **Capture an area** draws a selection and
  files it. A capture can carry a scale bar and a north arrow, ticked on the
  selection's own bar and remembered from then on; the app draws them, from the
  zoom and the pixel ratio the grab was taken at. Most of these sites write no
  rotation into their URL, so the needle waits for a bearing typed on that bar
  rather than pointing at a guess.
- On a 2D map, the same panel draws Azimut's own tools over the site: measure,
  points, sun and moon, a search grid, the case's own images and videos held over
  the map, and NASA FIRMS fire detections laid over whatever that map is
  showing. It lists the case's scenes still to geolocate.
- Beside any page, a panel holds a note of the case. Its Add (+), a right-click
  or Alt+Shift+S cites the page or the post, quotes the words selected on it with
  a link back to them, or puts a capture of an area of a map into the note. Its
  **Save this page** files the page as a bookmark, without downloading it.
  Alt+Shift+N opens it from any page, and the map panel's note button from a map.
- On Azimut's Google basemap, the in-app Capture button requests the current
  tab image without a screen-share prompt.
- When Post publishes, it can open X or Bluesky with the thread already
  typed and the proof attached, or open the reply box under the source post. It
  never presses Post: the composer is left filled, and publishing stays a human act.
- When Reverse Search opens an engine, it can hand the picture to the engine's
  own uploader, so the search runs on the press you already made.

## Install

Two roads, because the browsers disagree about what a permanent extension is.

### Chrome, Edge, Brave (Windows, macOS, Linux)

In Azimut → **Settings → Capture extension**, press **Install**. The app writes
the extension into a folder it owns and shows you the path. Copy that path:
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
re-attaches itself, so neither the extension nor the page needs reloading.
Your pairing survives. Even without pressing anything it lands eventually, since
Chrome re-reads unpacked extensions when it starts.

Two things worth knowing there:

- If a browser is holding the old files (Windows does this), Azimut says the
  files are staged. Close the browser and press again.
- Chrome derives an extension's identity from its folder, so if you already had
  the extension loaded from a folder of your own, that copy and this one are two
  extensions. Settings names the one to remove. Removing it loses its stored
  pairing, so paste the token again afterwards, once.

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
  extension's own options page both say so, and the answer is to update the app:
  its newer flows report that they could not run rather than misbehave.

## Map tools

The toolbar button opens a panel over the map you are on. Press it again to close
it. Its header holds the case, a dot that turns green once what it draws sits on
the ground (its tooltip says why when it does not), the note, the link and the
fold. **Capture an area** comes first, then the scenes to geolocate, then six tools:

| Tool | What it does |
|---|---|
| Measure | Distance along a clicked path, or the area it encloses. Same formulas and same wording as the app. |
| Points | Draws one of the case's three positions (its located media, its places, its captures) on the map, and files a new point. |
| Sun & moon | Plants a point and draws the day's sun and moon arcs around it, with a date and an hour slider. |
| Grid | Drags a box or clicks out a shape, cuts it into metric cells, and marks each cleared or flagged. The grid is saved into the case and opens in the app's own Grid Search. |
| Refs | Floats an image or a video from the case over the map, to compare against the imagery while you pan. |
| Fires | Lays NASA FIRMS thermal detections over the site: the last 24 h to 7 days, or any past day or range up to 31 days picked from a calendar drawn inside the panel. Needs a FIRMS key in Azimut's own Settings (without one the seat is greyed and says so), and stops at z14 where one mark stops meaning one detection. |

Only the open tool draws, and pressing it again puts it down: the map goes back to
being a map. What you told a tool stays in it: a measured path, a planted point,
an open sweep all come back when you pick it up again. Reference windows and the
fire layer are the exceptions: the windows are not on the map, and the fires are
ground rather than drawing, so both stay while you measure over them.

**Scenes to geolocate.** A case whose videos or pictures hold scenes kept in Inspect
or marked in the app, and not yet taken up by a proof, lists them under Capture,
by file as the app's To-do does: the time, the label, and whether captures were
gathered for it. The list stays open while no scene is being geolocated, and folds
to one row behind the scene's pill while one is. **Geolocate** tells the app
which scene this map is for and holds the scene's video over the map, paused on
the scene, which is marked on the bar in the colour Inspect gives it: a band for
a passage, a pin for an instant. A pill then names the scene in its colour and
counts its captures, the moment the app says one landed; its ✕ stops, and **Make the
proof** brings the Azimut tab to the front on its proof chooser, or opens one when none
is open. Nothing is written from the map.
While it lasts, the app attaches every capture filed in the case to that scene,
the panel's included, and the capture's report says "Attached to" it. A scene
started from the app shows the same pill here, and pressing the pill brings its
video up. A picture marked to geolocate reads "Whole picture" and is held over the
map as a picture, with nothing on a bar. A case with no scene to geolocate shows
nothing new.

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

**A reference window is scratch.** Drag it by its header (it settles against an
edge or into a corner it comes near), resize it from the corner, wheel to zoom
into the picture, double-click the title bar to fold it away. Its controls come up
over the picture on a hover: the fade lets the site's map show and move under it,
the details show the file's dates, source and notes, and the pin puts it in a
column on either side (stacked, centred) or in a corner, clear of the panel. Let
go in a corner, it stays there too. The site's map cannot be narrowed, so a
column covers that edge of it, and a column on the panel's side runs under it.
Nothing about it is filed, nothing comes back next visit, and the panel and its
windows step out of the frame before a capture is taken, because a reference floating
over a map must never end up inside the evidence.

**Add reference** lists the case's images and videos, searched, filtered by kind
and ordered by the app rather than by this tab: what crosses is one page of a case,
never the case. A video plays in the window in a small player of its own: frame
steps at the clip's own rate, slow motion, sound, and a frame kept as a picture.
A video held for the scene being geolocated has a pin in the scene's colour, beside
the frame steps, that goes back to where the scene starts.

Two limits worth knowing. A reference has to be **under 512 MB**, and it crosses in
pieces, so a long clip opens the way it does in the app's own Satellite tab: the
window counts up while it arrives. A published thread's attachments answer to a
lower ceiling, **48 MB**, since those are pushed into the composer's page whole.
And a video is the one thing here a site can refuse: an image is decoded and
painted on a canvas, which asks the page's content policy nothing, while a video
needs a URL and some sites will not load one. When that happens the window says so.

Reference windows work where the geometric tools do not (Street View, a pitched
camera, a globe), since nothing about holding a reference up needs the ground to
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
(`docs/MAP_SITES.md`). Apple's sidebar does move (it folds away in a narrow
window), so Apple starts at the middle and is measured instead.

Measuring it takes a zoom. A pan can never see the offset, because it slides along
with the map; a zoom can, since every one of these maps zooms about a point it
holds still while the centre moves underneath. So the first zoom you make measures
it, the panel remembers it for that site and that window shape, and every zoom
after checks it again. Until then the status line says "zoom once to place it",
and the tooltip on that line carries the offset being drawn from and where it came
from, which is what to read when something lands somewhere the ground is not.

**Google Earth is read like the others.** Its 2D map is Web Mercator, drawn about
the middle of the window, and `d` and `y` in its address bar give the scale. A link
written by hand, or the app's own "Open in Google Earth", has no ground height in
it, and Earth draws it nearer than it says. So until you move the map once, which
is when Earth writes the ground in, the panel shows "Move the map once so its
address bar gives the scale" and draws nothing.

Apple states a live span but a stale `z` (it carries whatever the opening
link had and never rewrites it), so the span is read and the `z` ignored. Bing
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
position reads that position, because a file carries no coordinates of its own and is
not in the index the other two come from. Filing a point goes to Places, so the
point just filed is drawn rather than swallowed.

**The case stays in step, in every window onto it.** Save a point in the app and
it appears here; mark a cell here and it appears in the app's own Grid Search and
in any other map you have the panel open on. Nothing needs reloading and nothing
needs pressing: the app says what changed and each side re-reads that much.

A grid swept from two places at once both lands, because what travels is the
cells you marked and never a copy of the grid, so two sweeps of different cells
keep each other's work, and the same cell twice is simply the last mark. A grid
discarded elsewhere closes here and says so.

Street View and a pitched 3D camera have no ground plane to measure on, so the
geometric tools are off there, and the panel says which view it wants back: the
map rather than Street View, 2D rather than 3D. A degree or two is not pitched:
these viewers never come back to a clean zero, and a view that looks level is
treated as level. Placing a point
still works wherever geometry is off, anchored on the point the address bar
names (where the camera stands), and the panel says so.

**Turning the map is fine.** Drag Google Earth's compass and the drawing turns
with it. Only tilting the camera switches the geometric tools off.

Zoomed far out there are two cases and they get different answers. On a **flat
map drawn small** (Google and Bing below level 8), the tools stay on: the middle
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

## Notes panel

The toolbar button, pressed on any page that is not a map, opens a note of the
case beside the page: Chrome's side panel, Firefox's sidebar. **Alt+Shift+N**
opens it from any page, maps included, and so does the note button in the map
panel's header in Chrome. Firefox opens its sidebar only from a press on the
browser itself, so there the button says to use the shortcut or Firefox's own
sidebar. The browser's own close button folds it away, and it opens on the same
note next time. In Firefox it is also under View → Sidebar.

The panel is Azimut's own note, the one the app shows, not a copy. What you type
there is in the case at once, and the bar at its top picks the note: Case notes,
or one of the case's own. The case is the extension's case: the one last picked in
the map panel or filed into, else the one Azimut has open. Picking a case in the
map panel opens its note in the panel, and a case picked in the panel is the one
the map panel and the right-click items file into next.

**Save this page**, over the note, files the page in front into that case as a
bookmark: a saved link, with nothing downloaded. It reads the tab as Add does, so
a tab the browser keeps from the extension asks for the same permission first.

While a note is open, three items join the right-click menu on every web page:

| Item | What lands in the note |
|---|---|
| Cite this page | A chip for the case's item at that address, or a bookmark filed for it. Nothing is downloaded. It reads **Cite this post** on a post on X, Bluesky, Telegram, Instagram, TikTok, Facebook or Reddit. |
| Quote the selection | The words as they are, linked to the passage itself, then the page's chip. The link opens the page scrolled to the words and highlights them (Chrome, and Firefox 131 or later). |
| Capture into the note | The area selection the map panel's Capture draws: the rectangle you drag is filed into the case the way Capture files one, then put in as a picture. Esc, on the page or in the panel, puts nothing. |

The note's **Add (+)** offers the same three first, under *From this tab*: *This
map* on a map site, *This page* (or *This post*), and *The passage selected* with
its first words, greyed until words are selected. Under them sit the note's own
additions, such as *A source…*. **Alt+Shift+S** captures the map in front into the
note too. The note's toast says what went in, and its Undo takes it out again.

Two limits, and both are rules rather than bugs:

- **Add needs one permission, asked once.** A browser opens a tab to an extension
  only when you point the extension at it: a right-click item, the toolbar button
  or its shortcut. A press in a side panel is none of those. So the first time Add
  needs the page in front, it asks the browser to let Azimut read every site, and
  the browser shows its own prompt. Where the browser will not ask from inside the
  note (Firefox), the panel shows *Allow* on a line above the note instead. With
  it, Add works on every page. Without it, the right-click items and Alt+Shift+S
  still work everywhere. The extension's options say when it is given and take it
  back. It is optional, so installing or updating the extension never asks for it.
- **Captures are for maps**, as everywhere in Azimut. On another page, Capture into
  the note says "Captures are for map sites. Cite this page instead."

The extension reads a page only when you add from it, right-click it or press the
shortcut, and hands its address, title and selected words to the local app. The app names the source from the address
alone and fetches nothing. Citing and quoting need no pairing, since the panel is
the app's own page; a capture does, like every capture.

## Pair (external sites only)

Until it is paired, the toolbar button opens the pairing:

1. Azimut → **Settings → Capture extension** → copy the pairing token. Pressed on
   Azimut's own tab, the pairing's **Open it** goes straight there.
2. Paste the token → **Pair**. A token the app turns down is not kept, so the
   button goes on offering the pairing until one is taken.

Once paired, the pairing offers what the press was for (the tools on a map, the
note anywhere else), and the button opens that from then on. The extension's
options (right-click the toolbar icon → Options) change the address or the token
later.

The token allows this extension to file captures through the local Azimut
server, to read back the media and proofs a thread attaches, and, for the map
tools, the points, search grids, images, videos and scenes to geolocate of the
case you pick. Rotate it in
Settings to revoke existing pairings.

## Fill the composer

Post's **Publish** opens the site's full composer, types each post of the
thread and attaches its pictures. Nothing is posted: the composer is left filled
and the button is yours.

**Reply under the source** opens the source post's own page instead, presses its
reply button and fills the reply box that opens, the thread under it. Only an X
status or a Bluesky post address is taken, and nothing on the page is read but
where that button is. Without the extension, X still opens its own reply page with
the first post typed and the proof on your clipboard; Bluesky has no such page, so
there the post is copied for you to paste.

There is one switch and it is in the app: **Settings → Publishing → Let the
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
still takes that press: nothing is sent to an engine you did not open.

The switch is in the app: **Settings → General → Let the extension open the
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
| `notifications` | Reports an area capture once it is filed, and says why the tools or the note could not open. |
| `contextMenus` | Adds Cite, Quote and Capture to the right-click menu while a note is open in the panel. Firefox reads it as `menus`. |
| `sidePanel` | Shows the notes panel in Chrome. Firefox has its own key for it, `sidebar_action`, and each browser ignores the other's with a warning. |
| `http://127.0.0.1/*`, `http://localhost/*` | Connects to the local Azimut app. |
| `https://x.com/*`, `https://twitter.com/*`, `https://bsky.app/*` | Types a prepared thread into the composer, when Azimut asks. Never reads those pages, never posts. |
| `https://lens.google.com/*`, `https://www.google.com/*`, `https://yandex.com/*`, `https://www.bing.com/*`, `https://tineye.com/*` | Gives a prepared image to the engine's uploader, when Azimut asks. Never reads those pages. `www.google.com` is there because Lens redirects to it. |

The in-app Capture button may require one initial toolbar click for a new tab.
Browsers require that gesture before allowing a tab screenshot. The extension
does not request `<all_urls>`, history access or remote-server access.
