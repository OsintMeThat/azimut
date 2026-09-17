# Compare Detect — working notes

Scratch notes for whoever picks this up next, not a project doc. Delete it when
the work lands in a release. What is *done* is described in
[UI.md](UI.md) and [SPEC.md](SPEC.md); only what is open or surprising is here.

## Decisions taken

- **Two computing modes, one column.** `Difference` (the old Change assist) reads
  the pixels on screen; `Detect` sweeps a drawn area at native resolution. They
  sit right of a rule in the mode dock, and share one docked column beside the
  stage. There is no "Assist" button and no cross-link between panels: the dock
  is the only switch. `lib/map/compare.js` carries the grouping.
- **No machine-learning model, and not as a fallback.** At Sentinel-2's 10 m a
  pixel a 30 m vessel is three pixels: there is no shape to recognise, and a
  detector trained on shapes would do worse than the physics. Every method reads
  a band product (`sentinel.DETECT_PRODUCTS`) and says what it measured.
- **Detect is Copernicus-only.** Every method measures reflectance, which Wayback
  pictures have already stretched away. Recipes and watches saved against Wayback
  or a picture method still load: `colour`, `brightness` and `smoke` map to
  `surface`, `water_objects` to `vessels`, and a Wayback source comes back undated.
- **Thresholds come from real scenes.** Calibrated on Bab-el-Mandeb (glint, rough
  sea), Singapore Strait (dense anchorage, cumulus), Gibraltar, Dover Strait
  (empty sea), Rumaila flares, California and Cerrado wildfires, Jebel Ali roofs,
  Egypt's new capital (seven months), Rondônia (dry season) and irrigated desert.
  What each taught is next to the constant it set, in `engine/analyzers.py`:
  - `vessels` needs near *and* short-wave infrared contrast against its own ring
    of sea. Wave crests match hulls in B08 and not in B11. Non-water over 5 ha is
    land. Sen2Cor calls hulls cloud, so classified cloud under 5 ha is ignored.
  - `hotspots` is Murphy et al. 2016 on B8A, which shares B12's grid.
  - `structure` is every band moving the same way with NDVI held; `spots` is a
    change whose wider neighbourhood mostly held, measured against a ring with a
    hole punched in it (`SPOT_GUARD`, `SPOT_RING`) — a median box the size of the
    target read a 90 m mark in the Yemeni desert at 3.5% where it had moved 7%;
    burn scars must end dark, because dry soil also has a negative NBR.
  - The global shift between dates is removed but capped at 3%, or a burn
    covering most of a tile erases itself.
- **Names say what an analyst looks for.** A candidate carries `margin` (how far
  past its threshold), a `strength` word and a `measure` in units; the catalogue
  words each method's reading. `signal_score` and `confidence` are gone.
- **Disk follows findings, not area.** `prune_frames` drops the frames of tiles
  that produced no candidate, which is what let `MAX_TILES` go from 256 to 4096
  (313 km a side). The trade is stated in the
  panel and in UI.md: an offline rerun now covers what the tile cache still
  holds, not the whole of a past sweep.
- **Detect leads the maps.** Inside the mode the A/B source cards are hidden and
  step 2 pushes its imagery onto the stage, so what is on screen is what a run
  would sweep. One analyzer that reads one date shows one map, and its evidence
  is one crop rather than the same picture twice.
- **Keeping is the review.** The triage is `new → kept | dismissed`, and `kept`
  is set by `promote` itself: one act files the pin, its evidence copy and the
  verdict together, so a candidate cannot be marked kept without being in the
  case or the reverse. `PATCH` refuses to re-triage a candidate whose pin still
  exists; `DELETE …/promote` is the undo, and it sends the pin to Trash. The old
  three-way relevant/ignored/to-review was two decisions where there is one.
- **An area is grabbed by its edge.** The fill of a zone no longer takes pointer
  events, so dragging inside one pans the map; a transparent wide stroke is the
  move target, and a press under four pixels selects without moving anything.
  Screen positions all go through `project()`, which reads the camera revision,
  so handles and boxes cannot be left behind by a pan.
- **Detect's drawing stays in Detect.** Areas and candidate layers render only
  in the mode that explains them. A kept candidate is a pin and shows wherever
  case work shows, which is the honest way for a result to outlive the mode.
- **Difference reads the same sky as Detect.** `skyMask` in
  `lib/map/changeDetect.js` is the browser's copy of `analyzers.sky`: the same
  cloud classes, the same 5 ha floor, the same unsure edge and the same cast
  away from the sun, turned by the map's bearing because a view can be. Both
  sides of that port were calibrated on cumulus over the Beauce and over the
  Kakhovka reservoir bed, which is what turned up the water rule below. The
  browser gets the bytes from `change-*` frames whose alpha must stay the data
  mask, because a canvas premultiplies it.
- **A band frame is fetched by an act, then held.** Run and the cloud switch are
  the two acts; a pan is not. Each frame is asked for with 20% of the view as
  margin and kept in `changeCapture`, so a reading that follows the camera keeps
  working inside that margin and reports `needsFetch` past it, leaving the last
  reading up and marked out of date. The switch itself runs the reading: leaving
  an unfiltered mask on screen under an "on" switch is how the first version of
  this read as broken. There is no live/manual switch any more — the reading
  always follows the camera, and the only question left is whether a request is
  spent, which only Run and the cloud switch ever do.
- **Water is only water when both dates say so.** Sen2Cor reads a deep cloud
  shadow as water — a fifth of the Ukrainian scene — and a cast that spares
  water found 0.3% of the shadow instead of 13.7%. Where a second pass exists,
  `sky(…, other)` asks it; a single-date method (`vessels`) still spares water,
  which is the sea it works on.
- **Matching tones is off on Sentinel-2.** The default is `auto`: nothing on
  Sentinel-2, a histogram on Esri releases. Two L2A passes are corrected and
  rendered by one formula, so a match can only eat real change — it erased the
  Cerrado burn, 74% of a tile, leaving 0.3% highlighted where 71% had been. Esri
  releases carry two renderings and a median tone shift of 15 levels between
  them, a quarter of the pairs past 25, so there a match still earns its place.
  Cloud is left out of the estimate either way.
- **A spectral index is thresholded, not split.** Otsu always finds a line, and
  after the cloud came out it found one in the noise: 19% of a clear Amazon week
  highlighted at the floor. Both modes now draw the line at a stated index
  change, 0.25 at the default sensitivity.
- **The picture cloud guess is gone.** "Bright and colourless, near-black"
  marked 94% of Gibraltar and 100% of Dover as shadow — sea and forest — and
  caught a fifth of the real cloud in Amazonia. The filter now appears on a
  Sentinel-2 pair only, where a classification exists.
- **"Watch" is the UI word for a follow-up.** The entity type id stays
  `analysis-follow-up`; renaming storage for a word nobody reads is not worth a
  migration.

## Still open

1. **The tile halo is 32 px.** Products are read with `PAD` pixels of the
   neighbours, enough for the vessel ring and a coastline, and a candidate
   crossing a seam is merged and previewed as one stitched picture. Clouds more
   than 306 m past the edge still cast no shadow into the tile.
2. **The promoted place carries `evidence` as an attribute** rather than a
   formal link to the filed media. `PREVIEW_EDGE`/`PREVIEW_MARGIN` decide how far
   the crop is enlarged; the zoom is a whole number and nearest-neighbour on
   purpose, and that is worth keeping whatever else changes there.
3. **Preserved frames are trusted by filename.** `frame` reuses any
   `runs-*.assets/<key>.png` it finds without checking the recorded `sha256`
   against the bytes. The key is derived from the source and tile, not the
   content, so an imported bundle could supply the file. Verify before reading.
4. **Polygon validation** catches empty and zero-area geometry, not every
   self-crossing.
5. **Coverage is sampled, not clipped.** `sentinel.acquisitions` measures how
   much of the drawn areas a pass reaches by testing a few hundred points inside
   the rings against the granule footprints, so a share is accurate to about a
   percent and `FULL_COVER = 0.98` is what counts as whole. It answers about the
   granule footprints, which is where imagery exists — not about cloud inside
   them, for which the scene's own figure is the only number on offer and it
   covers a 110 km granule, not the area drawn. The distinction is in the UI
   copy; keep it.
6. **`CLP`/`CLM` are not read.** On Copernicus Data Space they were zeros for
   some acquisitions, a thick cloud included. If they become reliable they would
   help thin cloud edges, but over desert they also flagged dark fields.
7. **Calibration is visual, not a benchmark.** The scenes above were reviewed by
   eye in true colour and SWIR, with no AIS or fire perimeter as ground truth.
   Small boats and whitecaps stay hard to part at the Small size, and seasonal
   urban shadows read as construction between February and September.
8. **A size band drops what it finds, silently.** A candidate outside
   `min_area`/`max_area` is found and then filtered, so a mark between two bands
   reads as "nothing found". The bands are now written under the buttons and
   **All** sets neither bound; what is still missing is a count of what the band
   dropped, which would turn "nothing" into "three, all larger than Small".
9. **Thin veils the classification misses still highlight.** A haze that neither
   Sen2Cor nor its unsure class calls cloud leaves change around it. The
   published multitemporal test (MAJA: blue reflectance rising against the other
   date) was tried and dropped: on the Amazon pair it grew the mask from 33% to
   48% of the scene for no drop in what was highlighted, and it would cost a
   band and split the two modes' masks apart.
10. **A cloud smaller than 5 ha in a zoomed-in view is not masked.** The floor is
   ground area, so a small cumulus crossing a close view is ignored the same way
   a white roof is. Detect has the same floor on a fixed grid, where it is the
   right call; here the view can be anything.

## Verification at handover (Detect)

- Backend: `2813 passed` (`pytest -q tests/ -p no:randomly`, 17 min).
  One caveat: under `pytest-randomly`'s default ordering a single unrelated test,
  `test_updates.py::test_the_extension_version_moves_only_when_the_extension_does`,
  failed once. It passes standalone, in its own file group, and in deterministic
  order. Nothing in this work touches `extension/` or `extinstall`. Worth finding
  the polluting test, separately.
- Frontend: `262 files, 5036 tests`, no unhandled errors.
- Browser: `e2e/compare.spec.js`, 8 passed on Chromium and Firefox.
- `ruff check src/ tests/`, `mypy` on the changed modules, `svelte-check`: clean.
- `npm run build`: clean, with the existing MapLibre chunk-size warning.

No commit, PR, tag or wheel has been produced for this work.
