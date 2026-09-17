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
  detector trained on shapes would do worse than the physics. So the two new
  Copernicus methods read reflectance:
  - `vessels` — CFAR on B08. Water absorbs near-infrared almost completely, so a
    hull is an outlier against the sea *around it*; the background comes from a
    ring with its middle punched out (`analyzers.local_contrast`), which is what
    makes one threshold work on a calm lagoon and a sunlit swell alike.
  - `hotspots` — the published short-wave test: B12 above an absolute floor and
    high against B11 and B08. Cloud is bright in B12 too but bright in its
    neighbours as well, so its ratios sit at one, and that is what rejects it.
  Both ride on `sentinel.band_frame`, which already existed for spectral
  indices. No new dependency: numpy and opencv-python-headless were already in.
- **Preset names state what is measured, never what it means.** "Vessels on
  water" is a claim about infrared contrast; "Boats" would have claimed
  recognition. `signal_score` is signal strength and `confidence` stays null.
- **Disk follows findings, not area.** `prune_frames` drops the frames of tiles
  that produced no candidate, which is what let `MAX_TILES` go from 256 to 4096
  (313 km a side on Sentinel, 4.9 km on Wayback). The trade is stated in the
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
- **"Watch" is the UI word for a follow-up.** The entity type id stays
  `analysis-follow-up`; renaming storage for a word nobody reads is not worth a
  migration.

## Still open

1. **No tile halo.** `detect` runs per tile with no overlap; components crossing
   a seam are merged afterwards by their boxes (`merge`), which can overmerge and
   can split a target whose halves each fall under `min_area`. Needs boundary
   tests before multi-tile results can be called robust.
2. **Promotion saves one evidence part.** `promote` calls `preview_bytes(...)`
   with the default `part=0`, so a candidate spanning several tiles promotes only
   its first before/after. The promoted place also carries `evidence` as an
   attribute rather than a formal link to the filed media.
   `PREVIEW_EDGE`/`PREVIEW_MARGIN` decide how far the crop is enlarged; the zoom
   is a whole number and nearest-neighbour on purpose, and that is worth keeping
   whatever else changes there.
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
   covers a 110 km granule, not the area drawn. Wayback release dates are
   publication dates, not acquisition dates. Both distinctions are in the UI
   copy — keep them.
6. **The picture cloud test is a guess and must stay opt-in.** Bright and
   colourless is equally a cloud, a white roof, a gravel pad and fresh snow, and
   nothing in a rendered image separates them. That is why it lives in its own
   `guess_clouds` rather than riding on `ignore_clouds`, which means Sentinel-2's
   scene classification and is on by default. Wiring the two together would
   silently change what every saved colour recipe finds.
7. **No measured benchmark.** Sequential bounded tiles are an argument about
   memory, not a measurement, and no accuracy check against real imagery exists.
   The detector tests use synthetic frames: they prove the method does what it
   claims on a controlled input, not that it finds ships in the Bosphorus.

## Verification at handover

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
