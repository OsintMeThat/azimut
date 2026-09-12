# Map sites: what their URLs say, and what they really mean

Azimut reads other people's maps twice: the **Open in…** panel writes a URL to
send you to one, and the capture extension's **map tools** draw over one from
what its address bar says. Both depend on knowing exactly what each site writes
down, so this is the record of what each one was *observed* doing — not what its
documentation claims.

**How this was established.** Every site below was driven in a real browser:
opened at a known level, dragged a known number of pixels, zoomed about a known
pixel, and read back out of the address bar after each step. The recordings are
kept in `tests/fixtures/map-sites.json` and both test suites replay them —
`tests/test_mapsites.py` that the parse still returns those views,
`frontend/src/lib/extensionMapFrame.test.js` that the arithmetic puts them back
where the browser had them.

**And it can be established again.** The gesture sequence is written down
(`frontend/calibration/protocol.mjs`) and run by `npm run calibrate:maps`, so
the day a site moves its panel or changes its URL form, the answer is a re-run
rather than an afternoon with a browser. See *Recalibrating* at the end.

## What each site writes

| Site | URL | Order | Scale |
|---|---|---|---|
| Google Maps | `google.com/maps/@47.388462,2.352785,15z` | lat, lon | `z`, tile level, up to 2 decimals |
| Google Maps (satellite) | `…/@47.388462,2.352785,3231m/data=!3m1!1e3` | lat, lon | `m`, **the viewport's height in metres** |
| Google Earth | `earth.google.com/web/@47.388462,2.352785,150a,3000d,1y,0h,0t,0r` | lat, lon | `d`, camera distance; `a` ground altitude, `h/t/r` heading, tilt, roll |
| Apple Maps | `maps.apple.com/frame?center=47.388462,2.352785&span=0.029055,0.056434&map=satellite` | lat, lon | `span`, the region in degrees (lat delta first) |
| Bing Maps | `bing.com/maps?cp=47.388462~2.352785&lvl=15.4&style=h` | lat`~`lon | `lvl`, tile level, 1 decimal |
| Yandex | `yandex.com/maps/?ll=2.352785,47.388462&z=15&l=sat` | **lon, lat** | `z`, tile level |
| Copernicus Browser | `browser.dataspace.copernicus.eu/?zoom=15&lat=47.38846&lng=2.35279` | named | `zoom`, tile level |
| Zoom Earth | `zoom.earth/maps/satellite/#view=47.388462,2.352785,11z` | lat, lon | `z`, tile level |
| Satellites.pro | `satellites.pro/plan/France_map#47.388462,2.352785,15` | lat, lon | third field, tile level |
| OpenStreetMap | `openstreetmap.org/#map=15/47.38846/2.35279` | zoom, lat, lon | `map=`, tile level first |

Every "tile level" above is the same number: 256-pixel tiles, one tile of the
world at zoom 0. That was checked, not assumed — each site was dragged a known
number of pixels and asked where it had landed, and every one of them answered
within a tenth of a percent of the level it was quoting.

## The traps

**Apple never rewrites its `z`.** Open a link with `z=15`, zoom twice, and the
address bar still says 15 while `span` has quartered. The span is the live
number; `z` is only true for the view the link opened, and is dropped the moment
a span appears (`engine/mapsites.py`, `_apple_maps`).

**Google's satellite view states metres, not a level.** `,3231m` is how tall the
viewport is on the ground. A 1000-pixel window at level 15 and latitude 47.39
covers 3233 m, which is where that number comes from — so with the window's
height it is a zoom, exact to the metre it is rounded to, and without it, it is
nothing. Passing metres where a zoom belongs is how the old "Open in Google
Satellite" link landed everyone at the same 2 km view whatever they were
looking at.

**Yandex writes longitude first.** Read `ll` as lat,lon and the pin lands in
another country.

**Zoom Earth opens its weather layer** unless the path says `/maps/satellite/`,
and that layer stops at level 11: ask for 15 and it will quietly clamp.

**Satellites.pro answers a bare link with a country path of its own**
(`/plan/France_map#…`), keeping the fragment. `/plan/` is an OpenStreetMap road
map, not imagery, so a capture from that path is not recorded as satellite.

**Copernicus rewrites its URL on a zoom but not on a pan**, and rounds its
coordinates to five decimals (about a metre). Its 2D map is Leaflet, so
EPSG:3857; its 3D terrain viewer writes `terrainViewerSettings` into the URL,
which is what tells the tools to stand down.

**Bing rounds the zoom it writes.** Its wheel moves a third of a level and its
URL carries one decimal, so `lvl=15.3` is really 15.334 — measured, six notches
of it, in `tests/fixtures/map-sites.json`. A fortieth of a level is two and a
third percent of scale: nothing at the middle of the screen, five metres at the
edge of a 1600-pixel window at level 18. Whole levels are exact on every site
here, Bing included; the tools work the fraction out for themselves from the
pixel the zoom held still (`extension/mapmath.js`, `zoomFromAnchor`).

**Google Earth is a globe with terrain.** `d` halves for every level zoomed in,
which carries a measured scale through a zoom, but turning it into a ground
scale needs a field of view no URL states. Level and close in, the tools measure
it; pitched, they refuse.

**`d` moves when nobody zoomed.** It is the distance to the ground, and the
ground has hills in it: pan across one and Earth rewrites `d` by more than the
one percent that otherwise means the view changed scale. Which is true — closer
ground is drawn larger — so the ratio of two distances is a real correction and
is applied as one. What it must not do is throw away the drag that arrived with
it: that drag is the only way this view is ever measured, and discarding it left
the panel asking for a pan it had already been given, for ever, over any terrain
that was not flat. So a reading that carries nothing keeps the drag instead
(`extension/mapoverlay.js`).

**"Level" carries a tolerance, and has to.** These viewers write the camera they
are actually holding, at full precision, and they do not come back to a clean
zero — a turn of Earth's compass leaves a fraction of a degree of pitch behind
it. Read as pitched, that is a tool which switches itself off whenever the view
is turned, telling the analyst to level a view that already looks level. So a
pitch up to `LEVEL_TILT_DEG` is a map: a pitched camera stretches the ground away
from the centre by roughly `0.6 · tan θ` across half of Earth's 35° field, which
is two percent at the two degrees allowed and eleven at ten. Past it the panel
refuses, and it says so in the viewer's own words — these tools are 2D — rather
than in the degrees it read, which name no button anyone can press.

**Turning the compass is not zooming it.** Earth is also the one view whose
`h` an analyst drags, and a scale is pixels per degree along the *world's* axes
— so a turn changes which way the screen looks at the ground and nothing about
how big it is drawn. Every measurement therefore undoes the bearing before it
divides: a drag's travel, a zoom's held pixel, the offset a centre is solved
from (`extension/mapmath.js`, `unturn`). Read raw, a drag on a map turned 30°
measured a scale a third out, the next pan missed its prediction, and the tools
switched themselves off — which is what turning Earth used to do. What is still
refused is a single gesture that turned *and* zoomed: one offset, two bearings,
and nothing in the address bar to say which did what.

## Where each site draws its centre

The coordinate in the address bar is not under the middle of the window. Five of
the eight put it somewhere else, because their own chrome takes part of the
screen and the map is centred in what is left — and this is invisible to any
amount of scale accuracy, since a pan slides the offset along with the map.

| Site | Camera centre, 1600×1000 | Why |
|---|---|---|
| Google Maps | 800, 500 | the map fills the window; its place panel covers it without moving it |
| Apple Maps | 867, 500 | a left sidebar, and a region narrower than the window |
| Bing Maps | 800, 540 | an 81 px header above the map |
| Yandex | 1010, 510 | a 420 px results panel |
| Copernicus Browser | 1025, 500 | a 450 px panel |
| OpenStreetMap | 800, 527 | a 55 px header |
| Satellites.pro | 800, 500 | full-window Leaflet |
| Zoom Earth | 800, 500 | full window |

The extension does not ship this table: a panel can be collapsed and a layout
can change, so it **measures** the offset instead, from the one gesture that can
see it. A zoom holds one pixel still while the centre moves underneath, which is
enough to solve for the pixel the centre is drawn at (`extension/mapmath.js`,
`centreFromZoom`). It is measured on the first zoom, remembered per site and per
window shape, and re-measured on every zoom after. The table is here as the
record of what those measurements found, and as what the tests replay.

**A zoom is one gesture and several readings.** These sites ease into a zoom
over a few hundred milliseconds and rewrite the address bar while they are doing
it: the new level lands as the wheel turns, the centre catches up when the camera
stops. Solved from the first of those readings, the offset comes out wherever the
camera was passing — Yandex measured 238 px wide of its real 210. Nothing
downstream catches it, because the reading that corrects the centre carries the
same level and so reads as a pan, and a pan cannot see the offset: it slides with
the map and cancels. So the answer is held for `FRAME_QUIET_MS`, re-solved from
every reading that arrives in the meantime, and only the one the address bar
stops on is kept. The recorder already waited for quiet rather than for a change
(`calibration/protocol.mjs`, `settle`); the panel now does too.

**A pan the site never reports measures nothing.** Copernicus rewrites its URL
on a zoom but not on a pan, and until a URL arrives the canvas carries the
difference. A zoom taken in that state would be solved against a view from
before the pan, putting the centre out by the whole of it, so it is allowed to
move the drawing and not to measure it (`mapoverlay.js`, `adrift`).

**A smaller window is not a smaller offset.** Driven again at 1200×760, Yandex's
panel was still 420 px and OpenStreetMap's header still 55, so both offsets came
back unchanged — while Apple's sidebar collapsed and its offset moved 70 px,
which is 21 m of ground at level 18. Nothing in any address bar says which of
those a site is, which is the whole argument for measuring rather than tabling
it. So an offset is filed under the window it was measured in, and the last four
window shapes are kept: reshape the window and the panel asks for another zoom,
put it back and the offset it already has comes straight back
(`extension/mapoverlay.js`, `onResize`). Until one is measured for the window in
front of the analyst, the status line says "zoom once to place it" and its
tooltip carries the offset the panel is drawing from. The drawing itself is not
dimmed: a wheel notch is a third of a level on some of these sites, so that wait
runs to several gestures, and a translucent drawing through all of them reads as
a broken tool rather than a careful one.

**The browser's own zoom is a smaller window.** At 125% the page is laid out in
fewer CSS pixels, and CSS pixels are the only unit any of this works in: the
drawing, the pointer, the offsets above. So a zoomed browser needs no case of
its own, and a screen with two or three dots to the pixel needs none either —
the ratio reaches the canvas's backing store (`extension/mapdraw.js`) and
nothing else. Both claims are held by tests rather than by this paragraph
(`extensionMapEngine.test.js`, `e2e/map-calibration.spec.js`).

**How tall the map is, is measured too.** A map centred in what its chrome
leaves is centred by exactly half of what the chrome took, so Bing's camera
sitting 40.5 px low *is* the measurement of its 81 px header. That matters for
the two views that state a size rather than a level: a span and a height in
metres are only a scale next to the number of pixels they were drawn in, so the
panel hands the app the map's height rather than the window's
(`extension/mapoverlay.js`, `mapHeight`), and re-reads the scale when the window
changes.

## What limits the accuracy

The drawing is only ever as good as the numbers the site writes, so this is
where the error actually comes from, worst first.

| Source | Size | Where it bites |
|---|---|---|
| The coordinate's own rounding | Copernicus and OpenStreetMap write five decimals (~1.1 m); Apple, Bing, Yandex and Satellites.pro six (~11 cm); Google seven | everything, evenly — it moves the whole drawing |
| A rounded zoom | Bing only, up to 2.3% until the fraction is worked out | grows outward from the middle of the screen |
| The camera centre | measured to about a tenth of a pixel, a pixel on the two sites that round their coordinates | everything, evenly |
| The site's own imagery | metres, sometimes, and not ours to fix | everything |

At level 18 a pixel is 0.3 m and at 17 it is 0.6 m, which puts the app's own
share of the error under a metre at the zooms anyone pins a building down at.
`frontend/src/lib/extensionMapFrame.test.js` holds that as a gate: every
recorded site, inside one metre of ground at level 18.

What none of this covers is relief on a 3D camera, and no measurement can: a
level camera still pushes a hilltop outward from the centre of the screen by its
own height, and no URL says how tall the ground is.

## Zoomed out, where the map becomes a globe

Google and Bing stop drawing a flat map somewhere around level 8 and start
drawing a globe, and Earth is a globe from the start; their URLs go on quoting a
zoom either way, so the zoom is the only warning there is.

Out there the drawing is **kept, dimmed, and labelled** rather than refused. A
globe and a Mercator agree at the point they are anchored on and part company
away from it, so the middle of the screen is right and the edges drift — which
is exactly the trade worth making for a look at a whole region's marks at once,
with the zoom that makes it exact one gesture away. The panel says "drifts at
the edges out here" and the canvas drops to just over half strength, so nothing
about it reads as placed.

Two things it does not do out there: it never *measures* anything from a view
that far out — the camera centre and the rounded-zoom correction are both taken
in close, where the site is drawing the flattening it names — and it never stops
refusing a pitched or panoramic camera, which has no ground plane at all.

## Recalibrating

Everything above is a measurement of nine sites nobody here controls, and it
ages. Run it again when a site's drawing looks displaced, when its URL form
changes, or every few months on principle.

```
cd frontend && npm run calibrate:maps     # drives the sites, headed
python scripts/build_map_fixture.py       # parses what they wrote, solves the camera
npm test && python -m pytest tests/test_mapsites.py
```

The whole matrix is ten runs — the nine sites, Google twice for its satellite
view — across seven windows and two browsers: about an hour of driving, plus
whatever each consent wall asks of you. It is merged by key, so `--sites yandex`
an afternoon later costs a minute.

The run is **headed and slow on purpose**. It opens each site at the same point
in the Cher, drags it a fifth of the window, and zooms about two pixels in the
right half — clear of every panel these sites have ever had — then reads the
address bar after each step. It clicks no consent wall: when a site puts one up
the run says which site it is waiting on and waits for you, and `--profile`
keeps the answer for next time. A site whose address bar barely moved is named
on the spot, while the browser is still open and you can see what it is showing.

| The matrix | What it is there for |
|---|---|
| chromium, firefox | two engines, so nothing rests on one's wheel or drag behaviour |
| 1600×1000, 1500×950, 1200×760, 900×600 | a responsive panel moves with the window; a fixed one does not |
| 100% and 125% browser zoom | fewer CSS pixels in the same window, and a device ratio that must not reach the geometry |

1500×950 at 125% and 1200×760 at 100% are the same 1200×760 CSS viewport from
two different device ratios, and the recordings say so. That pair is the whole
device-independence claim, made once and kept.

**When something fails.** The build names it and keeps the rest:

| It says | What moved | Where to fix it |
|---|---|---|
| *is not a map URL any more* | the site changed its URL form | `engine/mapsites.py`, then re-run |
| *no zoom moved a level the URL stated* | its wheel step changed | `NOTCHES` in `calibration/protocol.mjs` |
| *its two zooms solved centres N px apart* | the map eased the zoom, or the site is no longer drawing the flattening it is named with | drive it by hand and watch; `_PROJECTIONS` if the shape has changed |
| *the camera solved outside the map's own canvas* | the layout changed under the solve | look at the site before trusting the number |

What the protocol itself is worth is not taken on trust either: `npm run test:e2e
-- map-calibration` drives the same sequence against a map whose header and side
panel we chose, on both engines and at two window sizes, and the solve has to
come back with the layout that was built in.
