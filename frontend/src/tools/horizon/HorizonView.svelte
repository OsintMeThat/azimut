<script>
  /**
   * What the eye sees, drawn from the terrain round it.
   *
   * The picture is drawn on the GPU from terrain meshes and their satellite
   * pictures (lib/horizon/mesh/scene.js), and redrawn only when something
   * changed, once a frame at most, so a drag or a wheel turn never waits on
   * anything but the screen. Placing the eye loads the ground all round behind
   * a progress; after that, turning never waits, and a zoom sharpens what it
   * shows as its tiles come. Everything read off the picture is
   * laid over it in the page, positioned by the same camera arithmetic the
   * shader uses (lib/horizon/camera.js): the azimuth ruler with the heading
   * caret, the elevation scale and the level line, the summit names set in the
   * sky, the marks, and the reading that follows the pointer.
   *
   * Gestures, as in a street-level viewer: the landscape follows the hand when
   * dragged, the wheel narrows or widens the lens about the point under the
   * pointer, Shift and a drag turns the frame about a pivot as the hand goes
   * round it, Alt and the wheel raises or lowers the eye. A click that did not
   * drag reads the ground there, which the map then shows. A line at the
   * bottom says so until the first drag.
   *
   * A photo or a video laid over the view (state/overlay.svelte.js) is drawn
   * on the GPU too, and a drag and the wheel move what the band's hands say
   * (`overlay.moves`): the terrain under the photo (the wheel is then the
   * lens), the photo over the terrain (the view turns and widens the lens the
   * other way, so the ground under the hand stays put), or both, the photo
   * held to the terrain: nothing that would part them is taken then, no roll,
   * lens, height or walk. The arrows and + and − follow the same choice.
   * While the skyline is being traced or rubbed out, a drag draws and the
   * wheel looks closer at both. Space or the middle button and a drag moves
   * both whatever is chosen, Space and the wheel looks closer at both, and
   * Shift and a click sets the pivot on the photo. With the photo's corners
   * out (W), over a grid that shows what they do, a corner pulled slants the
   * photo, an edge stretches or squeezes it, and a drag inside it moves it;
   * outside it, a drag moves as chosen.
   *
   * The heading caret has two small arrows either side, a tenth of a degree a
   * press (a degree with Shift), for the last nudge a drag overshoots.
   */
  import { onDestroy, onMount, untrack } from 'svelte';
  import { repeatPress } from '../../lib/repeatPress.js';
  import { createScene } from '../../lib/horizon/mesh/scene.js';
  import { focal, rayFor, seenLens, toScreen, turnAbout, turnBetween, verticalFov } from '../../lib/horizon/camera.js';
  import { inSight, skylineAt } from '../../lib/horizon/panorama.js';
  import {
    azimuthTicks,
    elevationTicks,
    faceTowards,
    headingText,
    levelLine,
    parseHeading,
  } from '../../lib/horizon/geometry.js';
  import { labelAt, mergePeaks, placeLabels } from '../../lib/horizon/labels.js';
  import {
    heightStep,
    heightText,
    edgeMiddles,
    edgeMoved,
    grownPhoto,
    insideCorners,
    loupeMoved,
    NO_LOUPE,
    photoAt,
    screenAt,
    slidPhoto,
    strokeFrom,
    fitRuns,
  } from '../../lib/horizon/overlay.js';

  import { pointerReading, summitReading } from '../../lib/horizon/readings.js';
  import { formatDistance } from '../../lib/measure.js';
  import { MAP_LIGHT, shadowKeep } from '../../lib/horizon/sky.js';
  import { areaLens, areaWithin, exportScale, layersIn, stripLaid, turnCamera } from '../../lib/horizon/viewExport.js';
  import { RIDGE_STEPS } from './state/horizon.svelte.js';
  import { detailsShown, pressTool, putAway, toolForKey, toolHint, traceLegend } from '../../lib/horizon/traceTools.js';
  import PictureControls from './PictureControls.svelte';

  let {
    /** The tab's view state (state/horizon.svelte.js). */
    view,
    units = 'metric',
    /** The light over the view (lib/horizon/sky.js `skyLight`): the sun's, the moon's, the night's. */
    sky = MAP_LIGHT,
    /** A sun or moon track to draw: `[{ azimuth, altitude, label? }]` per body. */
    tracks = [],
    /** The chosen time, "09:30", which labels the sun where it stands. */
    clock = '',
    /** Who made the picture: terrain, imagery, names. */
    credits = '',
    /** Whether a Copernicus key is set, and how to ask for the setup when it is not. */
    copernicus = false,
    onsetup = () => {},
    /** A photo or a video laid over the view (state/overlay.svelte.js), or null. */
    overlay = null,
    /** The buildings round the eye (state/buildings.svelte.js), or null. */
    buildings = null,
    /** How each point of each stroke lies on the terrain (lib/horizon/overlay.js `traceFit`), or null: the trace then shows in one colour. */
    fit = null,
    /**
     * The terrain's skyline over the photo, as runs across its frame with how
     * far it may be off (lib/horizon/overlay.js `terrainLine`): drawn as a line
     * beside the trace, and as a band while the details show.
     */
    terrain = [],
  } = $props();

  /** Where this browser remembers that the gesture lines were understood, without and with a photo. */
  const HINT_KEY = 'azimut.horizon.hint';
  const PHOTO_HINT_KEY = 'azimut.horizon.photoHint';
  /** What the gestures do over a photo, by what a drag moves: said to a screen reader, and on the line under the photo. */
  const GESTURES = {
    terrain: 'drag to move the terrain under it, wheel to zoom the terrain, Shift and drag to roll, Alt and wheel to change the height',
    photo: 'drag to move the photo over the terrain, wheel to make the photo bigger or smaller, Shift and drag to roll the terrain',
    both: 'drag to move photo and terrain together, wheel to look closer',
  };
  const HINTS = {
    terrain: 'Drag to move the terrain under the photo · Wheel to zoom it · Space+drag to move both · Shift+drag to roll',
    photo: 'Drag to move the photo over the terrain · Wheel to make it bigger or smaller · Space+drag to move both',
    both: 'Drag to move photo and terrain together · Wheel to look closer · Click to read the ground',
  };
  /** How far either side of the heading caret and its arrows the ruler keeps its labels out. */
  const CARET_CLEAR = 76;

  let box = $state();
  let canvas = $state();
  let scene = null;
  let unsupported = $state('');
  /** What the ground all round still waits for (mesh/scene.js `progressOf`), whether the eye has landed, or failed to. */
  let progress = $state({ phase: 'landing', share: 0 });
  let landed = $state(false);
  let failed = $state(false);
  let size = $state({ width: 0, height: 0 });
  let pointer = $state(null);
  /** The height the wheel just set, said beside the pointer for a moment: `{ text, x, y }`. */
  let heightNote = $state(null);
  let dragging = $state(false);
  let controls = $state({ width: 0, height: 0 });
  let hinted = $state(remembered(HINT_KEY));
  /** An export drawing its own camera: `{ text }` on the veil over the view, or null. */
  let exporting = $state(null);
  let photoHinted = $state(remembered(PHOTO_HINT_KEY));
  let frame = 0;

  function remembered(key) {
    try {
      return globalThis.localStorage?.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  function understood(key) {
    if (key === HINT_KEY) hinted = true;
    else photoHinted = true;
    try {
      globalThis.localStorage?.setItem(key, '1');
    } catch {
      // the line comes back next time, which is all a refused storage costs
    }
  }

  const laid = $derived(Boolean(overlay?.source));
  /**
   * How the ground is drawn sits in the view's corner, a photo laid or not; it
   * steps away while the pen, the rubber or the photo's corners are out, which
   * want the whole photo under the hand.
   */
  const controlsShown = $derived(
    Boolean(view.observer) && !(laid && (overlay.tracing || overlay.erasing || overlay.warping || overlay.linking || overlay.cutting || overlay.distancing || overlay.clearing || overlay.keying))
  );
  /** The loupe over the photo while it shows anything but the whole photo, which the camera is then seen through. */
  const loupe = $derived(laid && view.camera.projection === 'camera' && loupeMoved(overlay.loupe) ? overlay.loupe : null);

  const camera = $derived({ ...view.camera, width: size.width, height: size.height, ...(loupe ? { loupe } : {}) });
  /** What the middle of the screen faces, which the heading caret says: the lens's own heading without a loupe. */
  const facing = $derived(seenLens(camera));

  // -- drawing ----------------------------------------------------------------

  let shownPicture = null;
  let shownFrame = -1;
  /** What the renderer draws the view with, as the tab stands. */
  function drawOptions() {
    const raised = buildings?.on ? buildings.drawOptions(view.placed?.lat) : null;
    return {
      // switched off, the buildings stay built in the scene and are drawn nowhere
      ...(raised ?? { buildings: 'none' }),
      ground: view.ground,
      // buildings drawn as edges are traced by the lines
      lines: view.lines || raised?.buildings === 'outline',
      sky,
      shaded: view.shaded,
      keep: shadowKeep(view.shadowDepth),
      visibility: view.visibility ?? 0,
      near: view.near,
      jump: RIDGE_STEPS[view.ridges],
      photo: laid ? overlay.shown : 1,
      bend: laid && overlay.bend ? [overlay.bend, overlay.bendShape.across, overlay.bendShape.down] : [0, 1, 1],
    };
  }

  function draw() {
    frame = 0;
    // an export draws its own camera meanwhile, under its veil
    if (!scene || exporting) return;
    // the photo, or the video's frame on show once it has one
    const picture = laid ? overlay.picture : null;
    const ready = !picture || !('readyState' in picture) || picture.readyState >= 2;
    if (picture !== shownPicture || (picture && overlay.frame !== shownFrame)) {
      if (ready) {
        shownPicture = picture;
        shownFrame = overlay?.frame ?? -1;
        scene.setPhoto(picture ?? null);
      }
    }
    if (!(size.width > 0)) return;
    const now = scene.draw(camera, drawOptions());
    // said in whole percents, so the page is not redrawn for every tile
    if (now.phase !== progress.phase || Math.floor(now.share * 100) !== Math.floor(progress.share * 100)) progress = now;
    landed = scene.landed;
    failed = scene.failed;
  }

  function redraw() {
    if (scene && !frame) frame = requestAnimationFrame(draw);
  }

  $effect(() => {
    // read everything a frame depends on, then draw on the next one
    void [view.shadowDepth, view.ground, view.lines, view.ridges, view.visibility, view.near, view.shaded, camera, sky];
    void [overlay?.picture, overlay?.frame, overlay?.shown, overlay?.bend];
    void [buildings?.on, buildings?.settings];
    redraw();
  });

  // the ground laid round the eye once it rests somewhere, and the imagery it is drawn in
  $effect(() => {
    const placed = view.placed;
    if (placed) scene?.place(placed, placed.far);
  });
  $effect(() => {
    const imagery = view.imagery;
    scene?.setImagery(imagery);
  });
  // the buildings' tiles and how unknown heights are drawn, raised in the scene's frame
  $effect(() => {
    const tiles = buildings?.sceneTiles ?? null;
    scene?.setBuildings(tiles);
  });
  $effect(() => {
    const shown = Boolean(buildings?.on);
    scene?.setBuildingsShown(shown);
  });
  $effect(() => {
    const options = buildings?.sceneOptions;
    if (options) scene?.setBuildingOptions(options);
  });
  // the turn the app marched says what nearer ground hides, which is not sharpened
  $effect(() => {
    const turn = view.panorama;
    scene?.setOccluder(turn);
  });
  // what came back empty is asked again when the analyst asks to try again
  let tried = null;
  $effect(() => {
    const retries = view.retries;
    const again = tried !== null && retries !== tried;
    tried = retries;
    if (again) untrack(() => scene?.retry());
  });

  onMount(() => {
    try {
      scene = createScene(canvas, {
        onChange: redraw,
        onRefused: (refusal) => view.imageryRefused(refusal.message),
      });
      if (!scene) unsupported = 'This view needs WebGL2, which this browser does not offer.';
    } catch (failure) {
      unsupported = failure.message;
    }
    const fit = () => {
      const width = box.clientWidth;
      const height = box.clientHeight;
      const density = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * density));
      canvas.height = Math.max(1, Math.round(height * density));
      size = { width, height };
    };
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    fit();
    if (view.placed) scene?.place(view.placed, view.placed.far);
    if (buildings) {
      scene?.setBuildingOptions(buildings.sceneOptions);
      scene?.setBuildingsShown(buildings.on);
      scene?.setBuildings(buildings.sceneTiles);
    }
    scene?.setImagery(view.imagery);
    scene?.setOccluder(view.panorama);
    redraw();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      scene?.dispose();
      scene = null;
    };
  });

  /**
   * The view as it shows, no wider than `width`, as a PNG: the preview the
   * saved work lists show. The GPU keeps its last frame, so it is read as is;
   * null before the eye has landed.
   */
  export async function snapshot(width = 640) {
    if (!canvas || !landed || !canvas.width || !canvas.height) return null;
    const scale = Math.min(1, width / canvas.width);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(canvas.width * scale));
    out.height = Math.max(1, Math.round(canvas.height * scale));
    const context = out.getContext('2d');
    if (!context) return null;
    context.imageSmoothingQuality = 'high';
    context.drawImage(canvas, 0, 0, out.width, out.height);
    return new Promise((resolve) => out.toBlob((blob) => resolve(blob), 'image/png'));
  }

  /**
   * The camera an export is drawn through, in CSS pixels: the view's frame
   * with no loupe (the photo's frame when one is laid), the screen as it
   * shows (`screen`, through the loupe), or the whole turn.
   */
  function exportCamera(kind) {
    if (kind === 'turn') return view.panorama ? turnCamera(view.panorama, { mode: view.observer?.mode }) : null;
    if (!(size.width > 0 && size.height > 0)) return null;
    if (kind === 'screen') return { ...camera };
    return { ...view.camera, width: size.width, height: size.height };
  }

  /** What an export writes over its picture, placed for `through`: names, ticks, the trace, the marked point. */
  function layersFor(through, kind) {
    const labels = placeLabels(seenPeaks, through, { skylineY: skylineOf(through) });
    const ticks = azimuthTicks(through);
    const trace =
      kind === 'view' && laid && overlay.traceShown
        ? overlay.strokesShown.map((stroke) => stroke.map((p) => ({ x: p.u * through.width, y: p.v * through.height })))
        : [];
    const target = view.target && !view.target.busy && !view.target.error ? toScreen(through, view.target.azimuth, view.target.angle) : null;
    const marked = target?.visible && target.x >= 0 && target.x <= through.width && target.y >= 0 && target.y <= through.height
      ? { x: target.x, y: target.y, visible: Boolean(view.target.visible) }
      : null;
    return { labels, ticks, trace, target: marked };
  }

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  /** How long an export's turned camera (`through`) is drawn at most for its ground to sharpen. */
  const TURNED_WAIT_MS = 4000;

  function copyOf(source) {
    const out = document.createElement('canvas');
    out.width = source.width;
    out.height = source.height;
    out.getContext('2d')?.drawImage(source, 0, 0);
    return out;
  }

  /** An area of a drawn canvas, given in CSS pixels of a picture drawn `scale` times as big. */
  function cutOf(source, area, scale) {
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(area.width * scale));
    out.height = Math.max(1, Math.round(area.height * scale));
    out.getContext('2d')?.drawImage(source, area.x * scale, area.y * scale, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  // -- an area of the view to capture ------------------------------------------------

  /** The area being chosen: what answers once it is (`{ answer }`), and the box drawn so far, in CSS pixels. */
  let choosing = $state(null);
  let chosen = $state(null);

  /**
   * Ask for an area of the view: a box dragged over it, answered as
   * `{ x, y, width, height }` in CSS pixels, or null when Escape gives up.
   */
  export function chooseArea() {
    choosing?.answer(null);
    return new Promise((answer) => {
      chosen = null;
      choosing = { answer };
      box?.focus({ preventScroll: true });
    });
  }

  function endChoosing(area) {
    const asked = choosing;
    choosing = null;
    chosen = null;
    asked?.answer(area);
  }

  /**
   * The view drawn for an export: through `kind`'s camera (the view's frame,
   * the screen as it shows, or the whole turn), at up to twice the screen's
   * pixels, under a veil that says so. It is drawn until the ground it shows
   * is sharp (or `wait` ms), then once per entry of `variants` (renderer
   * options over the tab's own: `{ photo: 1 }` the photo alone, `{ photo: 0 }`
   * the terrain alone), each copied before the next is drawn, and the screen
   * comes back as it was. A variant's `through` turns the export's camera into
   * the one it is drawn with (a piece of a cut collage, lib/horizon/cutView.js),
   * drawn until its ground is sharp too. An `area` of the screen (CSS pixels) is cut out of
   * each; `note` is what the veil says meanwhile. Answers `{ frames, layers, camera, scale, lens, turned }`, `lens` what the
   * picture faces and how wide it is (`areaLens`), `turned` each variant's own
   * `{ camera, layers }` when it had a `through` (else null), or null when there is no
   * view to draw.
   */
  export async function exportPicture({ kind = 'view', variants = [{}], area = null, wait = kind === 'turn' ? 25000 : 12000, note = '' } = {}) {
    if (!scene || !canvas || !landed || exporting) return null;
    const through = exportCamera(kind);
    if (!through) return null;
    const scale = exportScale(through.width);
    const before = { width: canvas.width, height: canvas.height };
    const text = note || (kind === 'turn' ? 'Drawing the whole turn…' : 'Drawing the export…');
    exporting = { text };
    try {
      canvas.width = Math.round(through.width * scale);
      canvas.height = Math.round(through.height * scale);
      const options = drawOptions();
      const started = performance.now();
      // the ground sharpens for this camera: drawn each frame until nothing is left to come
      for (;;) {
        const now = scene.draw(through, options);
        if (!now.phase || performance.now() - started > wait) break;
        exporting = { text: now.phase === 'sharpening' ? `${text.replace('…', '')} · sharpening…` : text };
        await nextFrame();
      }
      const cut = area ? areaWithin(area, through) : null;
      const frames = [];
      const turned = [];
      for (const { through: turn, ...change } of variants) {
        const at = turn ? turn(through) : through;
        let now = scene.draw(at, { ...options, ...change });
        // a turned camera may reach ground the export's own did not sharpen
        for (const begun = performance.now(); turn && now.phase && performance.now() - begun < TURNED_WAIT_MS; ) {
          await nextFrame();
          now = scene.draw(at, { ...options, ...change });
        }
        // a strip piece laid turned is drawn with no roll: turned back about its middle here
        const drawn = stripLaid(canvas, at, scale);
        frames.push(cut ? cutOf(drawn, cut, scale) : copyOf(drawn));
        const own = turn ? layersFor(at, kind) : null;
        turned.push(own ? { camera: at, layers: cut ? layersIn(own, cut) : own } : null);
      }
      const whole = { x: 0, y: 0, width: through.width, height: through.height };
      const layers = layersFor(through, kind);
      return {
        frames,
        layers: cut ? layersIn(layers, cut) : layers,
        camera: through,
        scale,
        lens: through.projection === 'panorama' ? null : areaLens(through, cut ?? whole),
        turned,
      };
    } finally {
      canvas.width = before.width;
      canvas.height = before.height;
      exporting = null;
      draw();
    }
  }

  // -- reading the picture ----------------------------------------------------

  const shown = $derived(Boolean(size.width && landed));

  /** The buildings' question before a download, or how their download or raising goes. */
  const buildingNote = $derived(buildings?.banner ?? null);
  /** Where the buildings' heights come from and that they can be wrong, noted under the view while they show. */
  const buildingCaveat = $derived(buildings?.caveat ?? null);

  /** What the view says while its ground loads: the whole turn first, then its pictures, the shadows, the lens. */
  const loadingText = $derived.by(() => {
    const percent = `${Math.floor(progress.share * 100)}%`;
    if (progress.phase === 'landing') return `Loading the view all round · ${percent}`;
    if (progress.phase === 'imagery') return `Laying the imagery all round · ${percent}`;
    if (progress.phase === 'shadows') return 'Casting shadows…';
    if (progress.phase === 'sharpening') return 'Sharpening…';
    return '';
  });

  /** The ground under a pixel (`distance` null for the sky), or null before the eye has landed. */
  function groundAt(x, y) {
    if (!view.observer) return null;
    return scene?.groundAt(camera, x, y) ?? null;
  }

  const inFrame = (at) => at.visible && at.x >= 0 && at.x <= size.width && at.y >= 0 && at.y <= size.height;

  const ticks = $derived(shown ? azimuthTicks(camera, { clear: CARET_CLEAR }) : []);
  const level = $derived(shown ? levelLine(camera) : null);
  const scale = $derived(shown ? elevationTicks(camera) : []);

  /** The skyline's height over a column of a camera's frame, for the names set above it. */
  function skylineOf(through) {
    return (x) => {
      const panorama = view.panorama;
      if (!panorama) return null;
      const { azimuth } = rayFor(through, x, through.height / 2);
      const elevation = skylineAt(panorama, azimuth);
      if (!Number.isFinite(elevation)) return null;
      const at = toScreen(through, azimuth, elevation);
      return at.visible ? at.y : null;
    };
  }
  const skylineY = (x) => skylineOf(camera)(x);

  /** The trace's details out: the terrain's margin, the cuts and the pairs' letters (lib/horizon/traceTools.js). */
  const detailsOn = $derived(laid && detailsShown(overlay));
  /** The terrain's skyline on screen, while the trace shows; the pen and the rubber want the photo's own edge bare. */
  const terrainPaths = $derived(
    laid && shown && !overlay.traceHidden && !overlay.tracing && !overlay.erasing ? terrain.map((run) => onScreen(run)) : []
  );
  /**
   * The band the terrain's skyline may be off by, while the details show, as
   * polygons over the columns where it is a pixel wide or more: wide over a
   * near ridge, nothing over a far one.
   */
  const bandShapes = $derived.by(() => {
    if (!detailsOn || !shown || overlay.traceHidden) return [];
    const shapes = [];
    for (const run of terrain) {
      let upper = [];
      let lower = [];
      const close = () => {
        if (upper.length > 1) shapes.push([...upper, ...lower.reverse()].join(' '));
        upper = [];
        lower = [];
      };
      for (const p of run) {
        const high = p.high == null ? null : screenAt(shownLoupe, p.u, p.high, size);
        const low = p.low == null ? null : screenAt(shownLoupe, p.u, p.low, size);
        if (!high || !low || low.y - high.y < 1) {
          close();
          continue;
        }
        upper.push(`${high.x.toFixed(1)},${high.y.toFixed(1)}`);
        lower.push(`${low.x.toFixed(1)},${low.y.toFixed(1)}`);
      }
      close();
    }
    return shapes;
  });
  /** What the lines over the photo mean, named under the view while the trace shows. */
  const legend = $derived(
    shown && laid && overlay.traceShown && !overlay.traceHidden && overlay.strokes.length
      ? traceLegend(overlay, { coloured: Boolean(fit), terrain: terrainPaths.length > 0, ridgeLines: Boolean(view.lines), level: Boolean(level) })
      : []
  );

  /**
   * Summits the picture shows, one per top, worked out once per picture rather
   * than per frame: in sight, and not lost in the haze past the visibility.
   */
  const seenPeaks = $derived.by(() => {
    if (!view.peaksOn || !view.panorama) return [];
    const reach = view.visibility ?? Infinity;
    return mergePeaks(view.peaks.filter((peak) => peak.distance <= reach && inSight(view.panorama, peak)));
  });

  /** The corner the picture controls cover, which no name may. */
  const reserved = $derived(
    controls.width && controlsShown
      ? [{ left: size.width - controls.width - 18, top: 0, right: size.width, bottom: controls.height + 18 }]
      : []
  );

  /** Their names in the sky, none hiding another (lib/horizon/labels.js). */
  const peakLabels = $derived(shown ? placeLabels(seenPeaks, camera, { skylineY, reserved }) : []);
  const labelKey = (label) => `${label.peak.lat},${label.peak.lon}`;

  const targetAt = $derived.by(() => {
    const target = view.target;
    if (!target || target.busy || target.error || !size.width) return null;
    const at = toScreen(camera, target.azimuth, target.angle);
    return inFrame(at) ? at : null;
  });

  const pointedAt = $derived.by(() => {
    const pointed = view.pointed;
    if (!pointed || !size.width) return null;
    const at = toScreen(camera, pointed.azimuth, pointed.elevation);
    return at.visible ? at : null;
  });

  /**
   * Sun and moon tracks: solid while the body clears the ridges, dashed while
   * a ridge hides it, cut where they leave the frame, go behind the camera,
   * dip under the sea-level horizon, or jump across the strip's seam.
   */
  const trackPaths = $derived.by(() => {
    if (!size.width) return [];
    return tracks.map((track) => {
      const parts = [];
      const marks = [];
      let line = [];
      let clear = null;
      const close = () => {
        if (line.length > 1) parts.push({ clear, points: line.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') });
        line = [];
      };
      for (const point of track.points) {
        if (point.gap) {
          close();
          continue;
        }
        const at = toScreen(camera, point.azimuth, point.altitude);
        const inside = at.visible && at.x > -size.width && at.x < size.width * 2 && Math.abs(at.y) < size.height * 3;
        const last = line.at(-1);
        if (!inside || (last && Math.abs(last.x - at.x) > size.width / 2)) {
          close();
          if (!inside) continue;
        }
        if (clear !== null && point.clear !== clear && line.length) {
          // carry the shared point over so the two styles meet
          const joint = line.at(-1);
          close();
          line.push(joint);
        }
        clear = point.clear;
        line.push(at);
        if (point.label && inFrame(at)) marks.push({ ...at, label: point.label });
      }
      close();
      const now = track.now ? toScreen(camera, track.now.azimuth, track.now.altitude) : null;
      return {
        id: track.id,
        body: track.body,
        parts,
        marks,
        now: now && inFrame(now) ? { ...now, clear: track.now.clear } : null,
      };
    });
  });

  /**
   * The marked point and the sun when the lens has turned away from them: an
   * arrow at the edge they lie past, which turns the view to them.
   */
  const away = $derived.by(() => {
    if (!shown) return [];
    const items = [];
    const target = view.target;
    if (target && !target.busy && !target.error && !targetAt) {
      items.push({
        id: 'target',
        label: 'Marked point',
        azimuth: target.azimuth,
        elevation: target.angle,
        hidden: !target.visible,
      });
    }
    const sun = tracks.find((track) => track.body === 'sun')?.now;
    const sunShown = trackPaths.find((track) => track.body === 'sun')?.now;
    if (sun && sun.altitude > -1 && !sunShown) {
      items.push({ id: 'sun', label: 'Sun', azimuth: sun.azimuth, elevation: sun.altitude });
    }
    const placed = [];
    for (const item of items) {
      const turn = turnBetween(view.camera.heading, item.azimuth);
      const side = turn < 0 ? 'left' : 'right';
      const at = toScreen(camera, item.azimuth, item.elevation);
      // clear of the picture controls above and the gesture line and ruler below
      let y = at.visible && Number.isFinite(at.y) ? Math.min(size.height - 96, Math.max(64, at.y)) : size.height / 2;
      if (placed.some((other) => other.side === side && Math.abs(other.y - y) < 30)) y += 32;
      placed.push({ ...item, side, y, turn: Math.round(Math.abs(turn)) });
    }
    return placed;
  });

  const turnTo = (direction) => view.look(faceTowards(camera, direction));

  // -- the reading under the pointer --------------------------------------------

  const hoverLabel = $derived(pointer && !dragging ? labelAt(peakLabels, pointer.x, pointer.y) : null);

  const readout = $derived.by(() => {
    // the height the wheel just set is said where the pointer is: one reading there at a time
    if (!pointer || dragging || !shown || heightNote || tracing || erasing) return null;
    const text = hoverLabel
      ? summitReading(hoverLabel, units)
      : pointer.ground
        ? pointerReading(pointer.ground, { fov: view.camera.fov, units })
        : '';
    if (!text) return null;
    // beside the pointer, flipped back inside near the right and bottom edges
    const wide = text.length * 6.6 + 16;
    const x = pointer.x + 14 + wide > size.width ? pointer.x - 14 - wide : pointer.x + 14;
    const y = pointer.y + 14 + 22 > size.height - 26 ? pointer.y - 14 - 22 : pointer.y + 14;
    return { text, x: Math.max(4, x), y: Math.max(4, y) };
  });

  // -- gestures -----------------------------------------------------------------

  const CLICK_SLOP = 4;
  let press = null;

  function local(event) {
    const rect = box.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** The hover reading asked last: an older one coming back late is dropped. */
  let hoverAsked = 0;
  /** The building under the pointer is asked of the app once the pointer rests. */
  let inspectTimer = 0;
  function inspectSoon(ground) {
    clearTimeout(inspectTimer);
    inspectTimer = setTimeout(() => buildings?.inspect(ground), 250);
  }

  /** Controls laid over the view keep their own clicks and keys. */
  const onControl = (event) => Boolean(event.target?.closest?.('.hz-control'));

  /** The stroke being drawn along the photo's skyline, in CSS pixels, while the hand is down. */
  let drawing = $state.raw([]);
  const tracing = $derived(laid && overlay.tracing);
  const erasing = $derived(laid && overlay.erasing);
  /** Pairing lines or cutting the collage: a click picks, nothing is dragged. */
  const picking = $derived(laid && (overlay.linking || overlay.cutting || overlay.distancing || overlay.clearing || overlay.keying));
  /** The photo's corners out to be pulled. */
  const warping = $derived(laid && overlay.warping);
  /** The photo held to the terrain: the view's gestures carry both, and none parts them. */
  const locked = $derived(laid && overlay.locked);
  /** What a drag and the wheel move: the terrain, the photo, or both (`overlay.moves`). */
  const moves = $derived(laid ? overlay.moves : 'terrain');
  /** How far the rubber reaches, in screen pixels, and where it is while erasing. */
  const RUBBER_PX = 12;
  let rubberAt = $state(null);
  /** Space held over a photo: a drag then moves the loupe; a tap still plays or pauses a video. */
  let spaceHeld = $state(false);
  let spaceMoved = false;
  /** Shift held: the pivot a roll turns about is shown while the pointer is over the view. */
  let shiftHeld = $state(false);
  let hovering = $state(false);
  /** The roll a Shift and drag has reached, said beside the pivot while the hand is down. */
  let rollNote = $state(null);
  /** How far from the pivot the hand must be before its angle round it is read. */
  const PIVOT_CLEAR = 24;

  const shownLoupe = $derived(loupe ?? NO_LOUPE);

  /** The point a roll turns about, on screen: the photo's pivot while it is in sight, the middle otherwise. */
  const pivotAt = $derived.by(() => {
    const middle = { x: size.width / 2, y: size.height / 2 };
    if (!laid || !overlay.pivot) return middle;
    const at = screenAt(shownLoupe, overlay.pivot.u, overlay.pivot.v, size);
    return at.x >= 0 && at.x <= size.width && at.y >= 0 && at.y <= size.height ? at : middle;
  });

  /** The photo's four corners on screen while they are out to be pulled. */
  const cornersAt = $derived(warping && size.width ? overlay.corners.map((corner) => screenAt(shownLoupe, corner.u, corner.v, size)) : []);
  const cornersLine = $derived(cornersAt.map((at) => `${at.x.toFixed(1)},${at.y.toFixed(1)}`).join(' '));
  /** The middle of each edge on screen, a handle that stretches or squeezes the photo that way. */
  const edgesAt = $derived(warping && size.width ? edgeMiddles(overlay.corners).map((middle) => screenAt(shownLoupe, middle.u, middle.v, size)) : []);
  /** The photo's grid on screen, as it shows. */
  const gridLines = $derived(warping && size.width ? overlay.grid.map(onScreen) : []);
  /** Over the photo while its corners are out: a drag there moves it. */
  let overPhoto = $state(false);

  /** A corner taken in the hand: it follows the pointer until it is let go. */
  function pullCorner(event, index) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    overlay.setPulling(true);
    const move = (ev) => {
      const at = local(ev);
      overlay.setCorner(index, photoAt(shownLoupe, at.x, at.y, size));
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      overlay.setPulling(false);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  /**
   * An edge taken in the hand: its two corners follow the pointer across the
   * edge, which stretches or squeezes the photo; Shift lets them follow it
   * every way.
   */
  function pullEdge(event, index) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    overlay.setPulling(true);
    const from = local(event);
    const corners = [...overlay.corners];
    const move = (ev) => {
      const at = local(ev);
      overlay.setCorners(edgeMoved(corners, index, { x: at.x - from.x, y: at.y - from.y }, photoScale, { free: ev.shiftKey }));
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      overlay.setPulling(false);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  /** The photo's size on screen, magnified by the loupe: what the rubber's reach is measured against. */
  const photoScale = $derived({ width: size.width * shownLoupe.zoom, height: size.height * shownLoupe.zoom });

  /** A stroke kept on the photo, as points on screen through the loupe. */
  const onScreen = (stroke) =>
    stroke
      .map((p) => {
        const at = screenAt(shownLoupe, p.u, p.v, size);
        return `${at.x.toFixed(1)},${at.y.toFixed(1)}`;
      })
      .join(' ');

  function onPointerDown(event) {
    if (!view.observer || onControl(event)) return;
    if (choosing) {
      if (event.button !== 0) return;
      box.setPointerCapture(event.pointerId);
      const at = local(event);
      press = { choosing: true, from: at };
      chosen = { x: at.x, y: at.y, width: 0, height: 0 };
      return;
    }
    // the middle button, or Space held, moves the loupe over the photo
    const panning = laid && (event.button === 1 || (event.button === 0 && spaceHeld));
    if (event.button !== 0 && !panning) return;
    if (event.button === 1) event.preventDefault();
    box.setPointerCapture(event.pointerId);
    box.focus({ preventScroll: true });
    if (panning) {
      press = { ...local(event), pan: true };
      return;
    }
    if (picking) {
      press = { ...local(event), picking: true };
      return;
    }
    if (tracing) {
      press = { ...local(event), tracing: true };
      drawing = [local(event)];
      return;
    }
    if (erasing) {
      const at = local(event);
      press = { ...at, erasing: true };
      overlay.beginErase();
      overlay.eraseAlong([photoAt(shownLoupe, at.x, at.y, size)], RUBBER_PX, photoScale);
      return;
    }
    if (warping && !event.shiftKey) {
      const at = local(event);
      if (insideCorners(photoAt(shownLoupe, at.x, at.y, size), overlay.corners)) {
        press = { ...at, shaping: true, corners: [...overlay.corners] };
        overlay.setPulling(true);
        dragging = true;
        return;
      }
    }
    if (locked) {
      // held to the terrain: a drag moves photo and terrain together, a click still reads the ground
      press = { ...local(event), pan: true, locked: true, travel: 0 };
      return;
    }
    if (moves === 'photo' && !event.shiftKey) {
      // the photo slides over the terrain from where the hand took it
      press = { ...local(event), slide: true, from: local(event), lens: { ...view.camera }, loupe: shownLoupe, moved: false };
      return;
    }
    // the panorama strip has no roll to turn
    const roll = event.shiftKey && view.camera.projection !== 'panorama';
    press = { ...local(event), camera: { ...camera }, moved: false, roll, pivot: pivotAt, swept: 0, angle: null };
  }

  /** The angle the hand has swept round the pivot since it pressed, clockwise on screen, in degrees. */
  function sweep(at) {
    const { pivot } = press;
    if (Math.hypot(at.x - pivot.x, at.y - pivot.y) < PIVOT_CLEAR) return press.swept;
    const angle = (Math.atan2(at.y - pivot.y, at.x - pivot.x) * 180) / Math.PI;
    if (press.angle !== null) press.swept += turnBetween(press.angle, angle);
    press.angle = angle;
    return press.swept;
  }

  function onPointerMove(event) {
    const at = local(event);
    shiftHeld = event.shiftKey;
    hovering = true;
    rubberAt = erasing && !onControl(event) ? at : null;
    overPhoto = warping && !onControl(event) && insideCorners(photoAt(shownLoupe, at.x, at.y, size), overlay.corners);
    if (press?.choosing) {
      chosen = { x: press.from.x, y: press.from.y, width: at.x - press.from.x, height: at.y - press.from.y };
      return;
    }
    if (!press) {
      if (onControl(event) || tracing || erasing || picking || overPhoto || choosing) {
        pointer = null;
        return;
      }
      // the reading follows a frame later, so the page never waits on the GPU while the hand moves
      pointer = { ...at, ground: pointer?.ground ?? null };
      const ask = ++hoverAsked;
      scene?.groundSoon(camera, at.x, at.y).then((ground) => {
        if (ground !== undefined && ask === hoverAsked && pointer) {
          pointer = { ...pointer, ground };
          if (buildings?.on) inspectSoon(ground);
        }
      });
      return;
    }
    if (press.erasing) {
      const from = photoAt(shownLoupe, press.x, press.y, size);
      overlay.eraseAlong([from, photoAt(shownLoupe, at.x, at.y, size)], RUBBER_PX, photoScale);
      press.x = at.x;
      press.y = at.y;
      return;
    }
    if (press.pan) {
      const dx = at.x - press.x;
      const dy = at.y - press.y;
      if (!dx && !dy) return;
      press.travel = (press.travel ?? 0) + Math.abs(dx) + Math.abs(dy);
      press.x = at.x;
      press.y = at.y;
      spaceMoved = true;
      dragging = true;
      pointer = null;
      scene?.moving();
      overlay.panLoupe(dx, dy, size);
      return;
    }
    if (press.tracing) {
      drawing = [...drawing, at];
      return;
    }
    if (press.slide) {
      const dx = at.x - press.from.x;
      const dy = at.y - press.from.y;
      if (!press.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
      if (!press.moved && !photoHinted) understood(PHOTO_HINT_KEY);
      press.moved = true;
      dragging = true;
      pointer = null;
      scene?.moving();
      const slid = slidPhoto(press.lens, press.loupe, dx, dy, at, size);
      overlay.setLoupe(slid.loupe);
      view.look({ heading: slid.heading, tilt: slid.tilt });
      return;
    }
    if (press.shaping) {
      // the photo follows the hand, its four corners together
      const du = (at.x - press.x) / size.width / shownLoupe.zoom;
      const dv = (at.y - press.y) / size.height / shownLoupe.zoom;
      overlay.setCorners(press.corners.map((corner) => ({ u: corner.u + du, v: corner.v + dv })));
      return;
    }
    const dx = at.x - press.x;
    const dy = at.y - press.y;
    if (press.roll && press.angle === null) sweep({ x: press.x, y: press.y });
    if (!press.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    if (!press.moved && !hinted) understood(HINT_KEY);
    if (!press.moved && laid && !photoHinted) understood(PHOTO_HINT_KEY);
    press.moved = true;
    dragging = true;
    pointer = null;
    scene?.moving();
    const start = press.camera;
    if (press.roll) {
      // the terrain turns round the pivot as the hand goes round it
      view.look(turnAbout(start, press.pivot.x, press.pivot.y, sweep(at)));
      rollNote = { text: `Roll ${view.camera.roll.toFixed(1)}°`, x: press.pivot.x, y: press.pivot.y };
      return;
    }
    const across = start.fov / size.width / (start.loupe?.zoom ?? 1);
    const up = start.projection === 'panorama' ? across : verticalFov(start) / size.height;
    view.look({ heading: start.heading - dx * across, tilt: start.tilt + dy * up });
  }

  function onPointerUp(event) {
    if (!press) return;
    if (press.choosing) {
      press = null;
      // a box too small to be a picture is no answer: drag again, or Escape
      const area = areaWithin(chosen, size);
      if (area) endChoosing(area);
      else chosen = null;
      return;
    }
    if (press.pan) {
      const clicked = press.locked && press.travel < CLICK_SLOP;
      press = null;
      dragging = false;
      if (clicked) {
        const at = local(event);
        const ground = groundAt(at.x, at.y);
        if (ground?.distance != null) view.point(ground);
      }
      return;
    }
    if (press.erasing) {
      press = null;
      overlay.endErase();
      return;
    }
    if (press.picking) {
      press = null;
      const at = local(event);
      const point = photoAt(shownLoupe, at.x, at.y, size);
      if (overlay.cutting) overlay.cutAt(point, photoScale);
      else if (overlay.linking) overlay.linkAt(point, photoScale);
      else if (overlay.distancing) overlay.farAt(point, photoScale);
      else if (overlay.clearing) overlay.clearAt(point, photoScale);
      else if (overlay.keying) overlay.keyAt(point, photoScale);
      return;
    }
    if (press.shaping) {
      press = null;
      dragging = false;
      overlay.setPulling(false);
      return;
    }
    if (press.slide) {
      const clicked = !press.moved;
      press = null;
      dragging = false;
      if (!clicked) return;
      const at = local(event);
      const ground = groundAt(at.x, at.y);
      if (ground?.distance != null) view.point(ground);
      return;
    }
    if (press.tracing) {
      const from = press;
      press = null;
      const at = local(event);
      const stroke = strokeFrom(drawing, size, { loupe: shownLoupe });
      drawing = [];
      // a click on a line makes it the pen's kind
      if (Math.hypot(at.x - from.x, at.y - from.y) < CLICK_SLOP && stroke.length < 3) {
        overlay.markLineAt(photoAt(shownLoupe, at.x, at.y, size), photoScale);
        return;
      }
      // snapped onto the nearest edge while the magnet is on; Alt does the other for this stroke
      if (stroke.length > 1) overlay.addStroke(stroke, { snap: overlay.magnet !== event.altKey, scale: photoScale });
      return;
    }
    const clicked = !press.moved;
    const rolled = press.roll;
    press = null;
    dragging = false;
    rollNote = null;
    if (!clicked) return;
    const at = local(event);
    if (rolled && laid) {
      // Shift and a click sets the pivot on the photo: a summit matched stays put while the rest turns
      overlay.setPivot(photoAt(shownLoupe, at.x, at.y, size));
      return;
    }
    const ground = groundAt(at.x, at.y);
    if (ground?.distance != null) view.point(ground);
  }

  /** Wheel pixels a notch is worth: a mouse sends about this, a trackpad many small ones. */
  const NOTCH_PX = 100;
  let heightWheel = 0;
  let heightNoteTimer = 0;

  /** Alt and the wheel raise or lower the eye, a notch a step, which the view then draws again. */
  function raise(event) {
    const observer = view.observer;
    if (!observer) return;
    heightWheel += event.deltaY * (event.deltaMode === 1 ? 33 : 1);
    const notches = Math.trunc(-heightWheel / NOTCH_PX);
    if (!notches) return;
    heightWheel += notches * NOTCH_PX;
    const height = heightStep(observer.mode, observer.height, notches);
    view.setHeight(height);
    const at = local(event);
    heightNote = { text: heightText(observer.mode, height), x: at.x, y: at.y };
    clearTimeout(heightNoteTimer);
    heightNoteTimer = setTimeout(() => (heightNote = null), 1200);
  }

  /**
   * The lens narrows or widens about the direction under the pointer, which
   * stays put. Over a photo the wheel zooms what a drag moves, about the
   * pointer too: the terrain (the lens), the photo, or both (the loupe);
   * drawing or rubbing out, or with Space held, it looks closer at both.
   * Shift and the wheel is the lens.
   */
  function onWheel(event) {
    if (!view.observer || onControl(event)) return;
    event.preventDefault();
    scene?.moving();
    if (event.altKey) {
      if (!locked) raise(event);
      return;
    }
    const at = local(event);
    // Shift turns a mouse wheel sideways in most browsers; a pinch comes as Ctrl and small steps
    const delta = event.deltaY || event.deltaX;
    const unit = event.deltaMode === 1 ? 0.05 : event.ctrlKey ? 0.01 : 0.0015;
    const factor = Math.exp(-delta * unit);
    if (laid && (tracing || erasing || picking || locked || spaceHeld) && !event.shiftKey) {
      // not under a stroke being drawn, which is kept in screen pixels until the hand lifts
      if (!press?.tracing) overlay.zoomLoupe(factor, at, size);
      return;
    }
    // the lens would part a locked photo from its terrain
    if (locked) return;
    if (moves === 'photo' && !event.shiftKey) {
      growPhoto(factor, at);
      return;
    }
    const before = rayFor(camera, at.x, at.y);
    const scale = Math.exp(delta * unit);
    const fov = view.camera.fov * scale;
    view.look({ fov });
    const narrowed = { ...camera, ...view.camera, width: size.width, height: size.height };
    for (let pass = 0; pass < 2; pass += 1) {
      const after = rayFor(narrowed, at.x, at.y);
      narrowed.heading += turnBetween(after.azimuth, before.azimuth);
      narrowed.tilt += before.elevation - after.elevation;
    }
    view.look({ heading: narrowed.heading, tilt: narrowed.tilt });
  }

  /** The photo grown or shrunk over the terrain about a point of the screen, the terrain keeping its size there. */
  function growPhoto(factor, at) {
    const grown = grownPhoto(view.camera, shownLoupe, factor, at, size);
    overlay.setLoupe(grown.loupe);
    view.look({ fov: grown.fov, heading: grown.heading, tilt: grown.tilt });
  }

  /** A held key walks at this pace at most, so each step's picture can come. */
  const WALK_EVERY_MS = 300;
  let walked = 0;

  /**
   * As in a street-level viewer: ↑ and ↓ walk forward and back (Shift for
   * five steps), ← and → turn by a tenth of the lens, Page Up and Page Down
   * tilt, + and − zoom, N faces north.
   */
  function onKey(event) {
    if (!view.observer || onControl(event)) return;
    if (laid && onPhotoKey(event)) {
      event.preventDefault();
      return;
    }
    if (locked) {
      // pinned: the arrows move over the terrain and + and − zoom, the photo going with it; nothing walks
      const tenth = { x: size.width / 10, y: size.height / 10 };
      const pans = { ArrowLeft: [tenth.x, 0], ArrowRight: [-tenth.x, 0], PageUp: [0, tenth.y], PageDown: [0, -tenth.y] };
      const zooms = { '+': 1.25, '=': 1.25, '-': 0.8 };
      const middle = { x: size.width / 2, y: size.height / 2 };
      if (event.key in pans && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        overlay.panLoupe(...pans[event.key], size);
      } else if (event.key in zooms && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        overlay.zoomLoupe(zooms[event.key], middle, size);
      }
      return;
    }
    if (moves === 'photo') {
      // the arrows move the photo over the terrain and + and − grow or shrink it
      const tenth = { x: size.width / 10, y: size.height / 10 };
      const slides = { ArrowLeft: [-tenth.x, 0], ArrowRight: [tenth.x, 0], ArrowUp: [0, -tenth.y], ArrowDown: [0, tenth.y] };
      const grows = { '+': 1.25, '=': 1.25, '-': 0.8 };
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const middle = { x: size.width / 2, y: size.height / 2 };
      if (event.key in slides) {
        event.preventDefault();
        scene?.moving();
        const slid = slidPhoto(view.camera, shownLoupe, ...slides[event.key], middle, size);
        overlay.setLoupe(slid.loupe);
        view.look({ heading: slid.heading, tilt: slid.tilt });
      } else if (event.key in grows) {
        event.preventDefault();
        scene?.moving();
        growPhoto(grows[event.key], middle);
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const walks = { ArrowUp: 1, ArrowDown: -1 };
    if (event.key in walks) {
      event.preventDefault();
      const now = performance.now();
      if (now - walked < WALK_EVERY_MS) return;
      walked = now;
      view.walk({ forward: walks[event.key], scale: event.shiftKey ? 5 : 1 });
      return;
    }
    const step = view.camera.fov / 10;
    const turns = {
      ArrowLeft: { heading: view.camera.heading - step },
      ArrowRight: { heading: view.camera.heading + step },
      PageUp: { tilt: view.camera.tilt + step / 2 },
      PageDown: { tilt: view.camera.tilt - step / 2 },
      '+': { fov: view.camera.fov / 1.25 },
      '=': { fov: view.camera.fov / 1.25 },
      '-': { fov: view.camera.fov * 1.25 },
      n: { heading: 0 },
      N: { heading: 0 },
    };
    const change = turns[event.key];
    if (!change) return;
    event.preventDefault();
    scene?.moving();
    view.look(change);
  }

  /**
   * The photo's keys: Space held and a drag moves the loupe (a tap plays or
   * pauses a video), 0 shows the whole photo, comma and full stop step a
   * frame, B blinks, T traces, E rubs out, W puts the photo's corners out, L
   * locks the photo to the terrain, H hides the trace, D shows its details, Ctrl+Z takes the last change to the trace back, Escape
   * puts the pen, the rubber or the corners away. True when the key was the
   * photo's.
   */
  function onPhotoKey(event) {
    const key = event.key;
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'z') {
      if (!overlay.canUndo) return false;
      overlay.undoStroke();
      return true;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const video = overlay.source.kind === 'video';
    if (key === ' ') {
      if (!event.repeat) {
        spaceHeld = true;
        spaceMoved = false;
      }
    } else if (key === '0') overlay.fitLoupe();
    else if (key === ',' && video) overlay.step(-1);
    else if (key === '.' && video) overlay.step(1);
    else if (key === 'b' || key === 'B') overlay.setBlink(!overlay.blink);
    else if (toolForKey(key)) pressTool(overlay, toolForKey(key));
    else if (key === 'm' || key === 'M') overlay.setMagnet(!overlay.magnet);
    else if ((key === 'w' || key === 'W') && overlay.source.kind === 'image') overlay.setWarping(!overlay.warping);
    else if (key === 'l' || key === 'L') overlay.setLocked(!overlay.locked);
    else if ((key === 'h' || key === 'H') && overlay.strokes.length) overlay.setTraceHidden(!overlay.traceHidden);
    else if ((key === 'd' || key === 'D') && overlay.strokes.length) overlay.setDetails(!overlay.details);
    else if (key === 'Escape' && (overlay.tracing || overlay.erasing || overlay.warping || overlay.linking || overlay.cutting || overlay.distancing || overlay.clearing || overlay.keying)) {
      event.stopPropagation();
      putAway(overlay);
      overlay.setWarping(false);
    } else return false;
    return true;
  }

  /** Where a key typed goes into a field rather than to the view. */
  const typingIn = (target) => Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));

  /**
   * The photo's keys are read wherever the focus is while the pointer is over
   * the view, so a key after a press on the photo's band (T, E, Space…) acts
   * on the view rather than on that button.
   */
  function onWindowKey(event) {
    if (event.key === 'Shift') shiftHeld = event.type === 'keydown';
    if (choosing && event.type === 'keydown' && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      press = null;
      endChoosing(null);
      return;
    }
    const elsewhere = event.target !== box && !box?.contains(event.target) && !typingIn(event.target);
    // under the pointer now: never a view hidden with its tab, nor one a dialog covers
    const over = Boolean(box?.matches?.(':hover'));
    if (event.type === 'keydown' && event.key !== ' ' && laid && over && elsewhere && view.observer && onPhotoKey(event)) {
      event.preventDefault();
      return;
    }
    if (event.key !== ' ') return;
    if (event.type === 'keydown') {
      if (!laid || !over || spaceHeld || !elsewhere) return;
      event.preventDefault();
      spaceHeld = true;
      spaceMoved = false;
      box.focus({ preventScroll: true });
      return;
    }
    if (!spaceHeld) return;
    spaceHeld = false;
    event.preventDefault();
    // a tap plays or pauses a video; a hold that moved the loupe does not
    if (laid && overlay.source.kind === 'video' && !spaceMoved) overlay.togglePlay();
  }

  /** A double click on the ground goes there, facing the same way. */
  function onDoubleClick(event) {
    if (!view.observer || onControl(event) || tracing || erasing || picking || locked) return;
    const at = local(event);
    const ground = groundAt(at.x, at.y);
    if (ground?.distance != null) view.standAt(ground);
  }

  // -- the heading caret: the one place the heading is written --------------------

  let typing = $state(false);
  let typed = $state('');
  let caretInput = $state();

  function editHeading() {
    if (locked) return;
    typed = String(Number(facing.heading.toFixed(1)));
    typing = true;
    queueMicrotask(() => {
      caretInput?.focus();
      caretInput?.select();
    });
  }

  function applyHeading() {
    const heading = parseHeading(typed);
    // the middle of the screen is turned to it, which is the lens's own heading without a loupe
    if (heading != null) view.look({ heading: view.camera.heading + turnBetween(facing.heading, heading) });
    typing = false;
  }

  /**
   * The caret's two arrows: a tenth of a degree a press, a whole one with
   * Shift, held to keep turning. A pinned photo is not turned away from: the
   * view moves over the terrain by as much, the photo going with it.
   */
  const turnBy = (direction) => (shift) => {
    const degrees = direction * (shift ? 1 : 0.1);
    if (!locked) {
      view.look({ heading: view.camera.heading + degrees });
      return;
    }
    const perDegree = (focal(camera) * Math.PI) / 180;
    overlay.panLoupe(-degrees * perDegree, 0, size);
  };
  const turnLeft = repeatPress(turnBy(-1));
  const turnRight = repeatPress(turnBy(1));
  onDestroy(() => {
    turnLeft.stop();
    turnRight.stop();
  });

  function onCaretKey(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyHeading();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      // the field's removal blurs it, and a blur applies what it holds: empty it first
      typed = '';
      typing = false;
      box.focus({ preventScroll: true });
    }
  }
</script>

<svelte:window
  onkeydown={onWindowKey}
  onkeyup={onWindowKey}
  onblur={() => {
    shiftHeld = false;
    spaceHeld = false;
  }}
/>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="horizon-view"
  class:daylight={view.ground !== 'plain' || laid}
  class:dragging
  class:tracing={tracing || erasing || picking || Boolean(choosing)}
  class:shaping={overPhoto}
  class:panning={laid && spaceHeld}
  class:sliding={moves === 'photo' && !tracing && !erasing}
  bind:this={box}
  tabindex="0"
  role="application"
  aria-label={laid
    ? `Photo over the view: ${GESTURES[moves]}, Space and drag to move both, Shift and click to set the pivot`
    : 'View from the eye: drag to turn, wheel to zoom, Shift and drag to roll, Alt and wheel to change the height, click to read the ground, double-click to go there, up and down arrows to walk'}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={() => {
    if (press?.erasing) overlay.endErase();
    if (press?.shaping) overlay.setPulling(false);
    press = null;
    drawing = [];
    dragging = false;
    rollNote = null;
  }}
  onpointerleave={() => {
    pointer = null;
    hovering = false;
    rubberAt = null;
  }}
  onmousedown={(event) => {
    // the middle button moves the loupe, never the browser's own scrolling
    if (event.button === 1 && laid) event.preventDefault();
  }}
  onwheel={onWheel}
  onkeydown={onKey}
  onblur={() => (spaceHeld = false)}
  ondblclick={onDoubleClick}
>
  <canvas bind:this={canvas}></canvas>

  {#if unsupported}
    <p class="notice">{unsupported}</p>
  {:else if failed && !view.error}
    <div class="glass loading failed hz-control" role="alert">
      The ground here could not be loaded
      <button type="button" onclick={() => view.retry()}>Try again</button>
    </div>
  {:else if exporting}
    <div class="export-veil" role="status" aria-live="polite">
      <div class="glass loading">{exporting.text}</div>
    </div>
  {:else if view.observer && loadingText}
    <div class="glass loading" role="status" aria-live="polite">
      {loadingText}
      {#if progress.phase === 'landing' || progress.phase === 'imagery'}
        <span class="bar"><span style:width="{Math.round(progress.share * 100)}%"></span></span>
      {/if}
    </div>
  {/if}

  {#if view.observer && buildingNote}
    <div
      class="glass loading building-note hz-control"
      class:asking={buildingNote.kind === 'ask'}
      role={buildingNote.kind === 'ask' ? 'region' : 'status'}
      aria-label="Buildings"
      aria-live="polite"
    >
      <span>{buildingNote.text}</span>
      {#if buildingNote.kind === 'progress' && buildingNote.share != null}
        <span class="bar"><span style:width="{Math.round(buildingNote.share * 100)}%"></span></span>
      {:else if buildingNote.kind === 'progress'}
        <span class="bar waiting"><span></span></span>
      {/if}
      {#if buildingNote.actions.length}
        <span class="note-actions">
          {#each buildingNote.actions as action (action.label)}
            <button type="button" class:quiet={action.quiet} onclick={action.run}>{action.label}</button>
          {/each}
        </span>
      {/if}
    </div>
  {/if}

  <svg class="overlay" width={size.width} height={size.height} aria-hidden="true">
    {#if level}
      <line class="level" x1={level.x1} y1={level.y1} x2={level.x2} y2={level.y2} />
    {/if}
    {#each scale as tick (tick.elevation)}
      <line class="scale-tick" x1="0" x2="4" y1={tick.y} y2={tick.y} />
    {/each}
    {#each trackPaths as track (track.id)}
      {#each track.parts as part, index (index)}
        <polyline class="track {track.body}" class:hidden={!part.clear} points={part.points} />
      {/each}
      {#each track.marks as mark, index (index)}
        <circle class="track-tick {track.body}" cx={mark.x} cy={mark.y} r="2.5" />
        <text class="track-label {track.body}" x={mark.x + 5} y={mark.y - 5}>{mark.label}</text>
      {/each}
      {#if track.now}
        <circle class="body {track.body}" class:hidden={!track.now.clear} cx={track.now.x} cy={track.now.y} r="7" />
        {#if track.body === 'sun' && clock}
          <text class="track-label now sun" x={track.now.x + 11} y={track.now.y + 4}>{clock}</text>
        {/if}
      {/if}
    {/each}
    {#each peakLabels as label (labelKey(label))}
      {#if label.y - 4 > label.baseline + 4}
        <line class="leader" x1={label.x} x2={label.x} y1={label.baseline + 4} y2={label.y - 4} />
      {/if}
      <circle class="summit" cx={label.x} cy={label.y} r="1.6" />
      <text
        class="peak-name"
        class:lit={hoverLabel === label}
        x={label.left + label.width / 2}
        y={label.baseline}
        text-anchor="middle">{label.name}</text
      >
    {/each}
    {#each bandShapes as points, index (index)}
      <polygon class="margin-band" {points} />
    {/each}
    {#each terrainPaths as points, index (index)}
      <polyline class="terrain-line under" {points} />
      <polyline class="terrain-line over" {points} />
    {/each}
    {#if laid && overlay.traceShown && !overlay.traceHidden}
      {#each detailsOn ? overlay.cutsShown : [] as cut, index (index)}
        {@const points = onScreen(cut)}
        <polyline class="cut under" {points} />
        <polyline class="cut over" {points} />
      {/each}
      {#each overlay.strokesShown as stroke, index (index)}
        {@const points = onScreen(stroke)}
        {@const id = overlay.marks.lines[index]}
        <polyline class="trace under" class:picked={overlay.front === id} {points} />
        {#if overlay.marks.inner.includes(id)}
          <polyline class="trace over ridge" {points} />
        {:else if overlay.marks.sea?.includes(id) && !(fit?.[index]?.length === stroke.length)}
          <polyline class="trace over sea" {points} />
        {:else if fit?.[index]?.length === stroke.length}
          {#each fitRuns(stroke, fit[index]) as run, part (part)}
            <polyline class="trace over {run.kind}" points={onScreen(run.points)} />
          {/each}
        {:else}
          <polyline class="trace over" {points} />
        {/if}
      {/each}
      {#each detailsOn ? overlay.pairBadges : [] as badge (badge.label)}
        {#each [['front', badge.front], ['back', badge.back]] as [side, at] (side)}
          {@const spot = screenAt(shownLoupe, at.u, at.v, size)}
          <g class="pair {side}" transform="translate({spot.x.toFixed(1)} {(spot.y - 14).toFixed(1)})">
            <circle r="7.5" style:--pair={badge.colour} />
            <text text-anchor="middle" dy="3.5">{badge.label}</text>
          </g>
        {/each}
      {/each}
      {#each detailsOn ? (overlay.farBadges ?? []) : [] as badge (badge.line)}
        {@const spot = screenAt(shownLoupe, badge.at.u, badge.at.v, size)}
        <g class="far" transform="translate({spot.x.toFixed(1)} {(spot.y + 16).toFixed(1)})">
          <rect x={-badge.label.length * 3.1 - 5} y="-8" width={badge.label.length * 6.2 + 10} height="16" rx="8" />
          <text text-anchor="middle" dy="3.5">{badge.label}</text>
        </g>
      {/each}
      {#each detailsOn ? (overlay.clearBadges ?? []) : [] as badge (badge.line)}
        {@const spot = screenAt(shownLoupe, badge.at.u, badge.at.v, size)}
        <g class="clear" transform="translate({spot.x.toFixed(1)} {(spot.y - 16).toFixed(1)})">
          <rect x="-29" y="-8" width="58" height="16" rx="8" />
          <text text-anchor="middle" dy="3.5">Sky only</text>
        </g>
      {/each}
      {#each detailsOn ? (overlay.keyBadges ?? []) : [] as badge (badge.line)}
        {@const spot = screenAt(shownLoupe, badge.at.u, badge.at.v, size)}
        <g class="keyline" transform="translate({spot.x.toFixed(1)} {(spot.y - 16).toFixed(1)})">
          <rect x="-16" y="-8" width="32" height="16" rx="8" />
          <text text-anchor="middle" dy="3.5">Key</text>
        </g>
      {/each}
    {/if}
    {#if drawing.length > 1}
      {@const points = drawing.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
      <polyline class="trace under" {points} />
      <polyline class="trace over" {points} />
    {/if}
    {#if pointedAt}
      <!-- drawn twice, dark under yellow, so it holds on snow as on a night ground -->
      <g class="pointed" transform="translate({pointedAt.x} {pointedAt.y})">
        {#each ['under', 'over'] as layer (layer)}
          <g class={layer}>
            <circle r="6" />
            <path d="M-12 0h7M5 0h7M0 -12v7M0 5v7" />
          </g>
        {/each}
      </g>
    {/if}
    {#if targetAt}
      <g class="target" class:hidden={!view.target.visible} transform="translate({targetAt.x} {targetAt.y})">
        <path d="M0 0 L-6 -12 L6 -12 Z" />
      </g>
    {/if}
    {#if rubberAt}
      <circle class="rubber" cx={rubberAt.x} cy={rubberAt.y} r={RUBBER_PX} />
    {/if}
    {#if chosen}
      {@const x = Math.min(chosen.x, chosen.x + chosen.width)}
      {@const y = Math.min(chosen.y, chosen.y + chosen.height)}
      <rect class="area under" {x} {y} width={Math.abs(chosen.width)} height={Math.abs(chosen.height)} />
      <rect class="area over" {x} {y} width={Math.abs(chosen.width)} height={Math.abs(chosen.height)} />
    {/if}
    {#each gridLines as points, index (index)}
      <polyline class="warp-grid under" {points} />
      <polyline class="warp-grid over" {points} />
    {/each}
    {#if cornersAt.length}
      <polygon class="warp-edge under" points={cornersLine} />
      <polygon class="warp-edge over" points={cornersLine} />
    {/if}
    {#if shown && view.camera.projection !== 'panorama' && ((shiftHeld && hovering) || rollNote)}
      <!-- the point a roll turns about, ringed -->
      <g class="pivot" transform="translate({pivotAt.x} {pivotAt.y})">
        {#each ['under', 'over'] as layer (layer)}
          <g class={layer}>
            <circle class="dot" r="2.5" />
            <circle class="ring" r="13" />
          </g>
        {/each}
      </g>
    {/if}
  </svg>

  {#each cornersAt as at, index (index)}
    <button
      type="button"
      class="warp-corner hz-control c{index}"
      style:left="{at.x}px"
      style:top="{at.y}px"
      aria-label="Pull corner {index + 1} of the photo"
      title="Pull to reshape the photo"
      onpointerdown={(event) => pullCorner(event, index)}
    ></button>
  {/each}
  {#each edgesAt as at, index (index)}
    <button
      type="button"
      class="warp-side hz-control s{index}"
      class:across={index % 2 === 1}
      style:left="{at.x}px"
      style:top="{at.y}px"
      aria-label="Pull the {['top', 'right', 'bottom', 'left'][index]} edge of the photo"
      title="Pull to stretch or squeeze the photo that way, Shift to pull it every way"
      onpointerdown={(event) => pullEdge(event, index)}
    ></button>
  {/each}

  <!-- the elevation scale's numbers, on the view's glass so they read over sky and snow alike -->
  {#each scale as tick (tick.elevation)}
    <span class="glass scale mono" style:top="{tick.y}px" aria-hidden="true">{tick.label}</span>
  {/each}
  {#if level && level.x1 < 1 && level.y1 > 12 && level.y1 < size.height - 30}
    <span class="glass scale level-label mono" style:top="{level.y1}px" aria-hidden="true">0°</span>
  {/if}

  {#if targetAt}
    <div class="glass note" class:hidden={!view.target.visible} style:left="{targetAt.x}px" style:top="{targetAt.y - 36}px">
      {view.target.visible ? 'In sight' : 'Hidden'} · {formatDistance(view.target.distance, units)}
    </div>
  {/if}

  {#each away as item (item.id)}
    <button
      type="button"
      class="glass away hz-control {item.side} {item.id}"
      class:hidden={item.hidden}
      style:top="{item.y}px"
      disabled={locked}
      title={locked ? 'Move one alone to turn' : 'Turn to it'}
      onclick={() => turnTo(item)}
    >
      {#if item.side === 'left'}<span aria-hidden="true">◂</span>{/if}
      <span class="dot"></span>{item.label}
      <span class="turn">{item.turn}° {item.side}</span>
      {#if item.side === 'right'}<span aria-hidden="true">▸</span>{/if}
    </button>
  {/each}

  {#if controlsShown}
    <div class="controls">
      <PictureControls {view} {copernicus} {onsetup} bind:width={controls.width} bind:height={controls.height} />
    </div>
  {/if}

  {#if readout}
    <div class="glass readout mono" style:left="{readout.x}px" style:top="{readout.y}px">{readout.text}</div>
    {#if buildings?.on && buildings.info}
      <div class="glass readout mono" style:left="{readout.x}px" style:top="{readout.y + 24}px">{buildings.info}</div>
    {/if}
  {/if}

  {#if heightNote}
    <div class="glass readout mono" style:left="{heightNote.x + 14}px" style:top="{heightNote.y + 14}px">{heightNote.text}</div>
  {/if}

  {#if rollNote}
    <div class="glass readout mono" style:left="{rollNote.x + 22}px" style:top="{rollNote.y + 18}px">{rollNote.text}</div>
  {/if}

  {#if loupe}
    <div class="glass loupe hz-control">
      <span class="mono">×{loupe.zoom < 10 ? loupe.zoom.toFixed(1) : Math.round(loupe.zoom)}</span>
      <button type="button" onclick={() => overlay.fitLoupe()} title="Back to the whole photo in the frame (0)">Fit</button>
    </div>
  {/if}

  <div class="notes">
    {#if legend.length}
      <ul class="glass legend" aria-label="What the lines over the photo show">
        {#each legend as item (item.id)}
          <li><span class="swatch {item.id}" aria-hidden="true"></span>{item.label}</li>
        {/each}
      </ul>
    {/if}
    {#if shown && choosing}
      <p class="glass hint">Drag a box over the view to capture it · Esc to cancel</p>
    {:else if shown && warping}
      <p class="glass hint">Pull a corner to slant the photo, an edge to stretch it · Drag inside it to move it · Esc when done</p>
    {:else if shown && (tracing || picking)}
      <p class="glass hint">{toolHint(overlay)} · Esc when done</p>
    {:else if shown && erasing}
      <p class="glass hint">Drag over the trace to rub it out · Wheel to look closer · Ctrl+Z takes it back · Esc when done</p>
    {:else if shown && laid && !photoHinted}
      <p class="glass hint">{HINTS[moves]}</p>
    {:else if shown && !hinted}
      <p class="glass hint">Drag to turn · Wheel to zoom · Double-click to go there · ↑ ↓ to walk</p>
    {/if}
  </div>

  {#if shown && buildingCaveat}
    <p class="building-caveat"><span>{buildingCaveat.heights}</span><span>{buildingCaveat.note}</span></p>
  {/if}

  {#if credits}
    <div class="credits">{credits}</div>
  {/if}

  {#if shown}
    <div class="ruler">
      {#each ticks as tick (tick.azimuth)}
        <span class="tick" class:named={tick.named} style:left="{tick.x}px" aria-hidden="true">{tick.label}</span>
      {/each}
      <div class="caret-row hz-control">
        {#each [[turnLeft, 'left', 'M5.5 1.5 2.5 5 5.5 8.5'], null, [turnRight, 'right', 'M2.5 1.5 5.5 5 2.5 8.5']] as side, index (index)}
          {#if side}
            {@const [press, way, path] = side}
            <button
              type="button"
              class="hz-nudge"
              tabindex="-1"
              aria-label="Turn {way} a tenth of a degree"
              title="Turn {way} by 0.1°; Shift for 1°"
              onpointerdown={press.start}
              onpointerup={press.stop}
              onpointerleave={press.stop}
              onpointercancel={press.stop}
            >
              <svg width="8" height="10" viewBox="0 0 8 10" aria-hidden="true"><path d={path} /></svg>
            </button>
          {:else if typing}
            <input
              bind:this={caretInput}
              bind:value={typed}
              class="hz-caret mono"
              aria-label="Heading in degrees, or a wind such as SW"
              onkeydown={onCaretKey}
              onblur={applyHeading}
            />
          {:else}
            <button
              type="button"
              class="hz-caret mono"
              aria-label="Heading, click to type"
              disabled={locked}
              title={locked ? 'Move one alone to turn' : undefined}
              onclick={editHeading}
            >
              {headingText(facing.heading, facing.fov)}
            </button>
          {/if}
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .horizon-view {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg-0);
    cursor: grab;
    outline: none;
    touch-action: none;
    user-select: none;
  }
  .horizon-view.dragging {
    cursor: grabbing;
  }
  .horizon-view.tracing {
    cursor: crosshair;
  }
  .horizon-view.panning,
  .horizon-view.shaping,
  .horizon-view.sliding {
    cursor: move;
  }
  .horizon-view:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .glass {
    border-radius: var(--r-md);
    background: var(--hz-glass);
    box-shadow: 0 0 0 1px var(--border);
    color: var(--text-1);
  }

  /* -- level, elevation scale ---------------------------------------------- */
  .level {
    stroke: color-mix(in srgb, var(--text-1) 30%, transparent);
    stroke-dasharray: 2 6;
  }
  .scale-tick {
    stroke: color-mix(in srgb, var(--text-1) 50%, transparent);
  }
  .scale {
    position: absolute;
    left: 7px;
    padding: 0 4px;
    transform: translateY(-50%);
    color: var(--text-2);
    font-size: 11px;
    line-height: 16px;
    pointer-events: none;
  }
  .scale.level-label {
    color: var(--text-1);
  }

  /* -- summit names, in the sky ---------------------------------------------- */
  .leader {
    stroke: color-mix(in srgb, var(--text-1) 40%, transparent);
    stroke-width: 1;
  }
  .summit {
    fill: var(--text-1);
  }
  .peak-name {
    fill: var(--text-1);
    font-size: 11.5px;
    font-weight: 600;
    paint-order: stroke;
    stroke: var(--bg-0);
    stroke-width: 3px;
    stroke-opacity: 0.8;
    stroke-linejoin: round;
  }
  .peak-name.lit {
    fill: var(--accent);
  }
  /* relief and imagery have a day sky: the names are ink on it, haloed in white */
  .daylight .leader {
    stroke: rgba(20, 24, 29, 0.45);
  }
  .daylight .summit {
    fill: #14181d;
  }
  .daylight .peak-name {
    fill: #14181d;
    stroke: #ffffff;
    stroke-opacity: 0.6;
  }
  .daylight .peak-name.lit {
    fill: #8a5300;
  }

  /* -- the skyline traced on a photo: yellow on a dark edge, read on sky and snow -- */
  .trace {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .trace.under {
    stroke: rgba(0, 0, 0, 0.55);
    stroke-width: 4.5;
  }
  .trace.over {
    stroke: var(--hz-mark);
    stroke-width: 2;
  }
  /* the terrain's own skyline beside the trace: thin and white, so the trace's colours stay the reading */
  .terrain-line {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .terrain-line.under {
    stroke: rgba(0, 0, 0, 0.45);
    stroke-width: 3.5;
  }
  .terrain-line.over {
    stroke: #fff;
    stroke-width: 1.5;
  }
  /* how far the terrain's skyline may be off, as coarse as its heights seen from the ridge */
  .margin-band {
    fill: rgba(255, 255, 255, 0.16);
    stroke: rgba(255, 255, 255, 0.28);
    stroke-width: 0.75;
    stroke-dasharray: 3 3;
  }
  /* read against the terrain: green on its skyline, amber near it, red off it */
  .trace.over.on {
    stroke: var(--hz-seen);
  }
  .trace.over.near {
    stroke: var(--accent);
  }
  .trace.over.off {
    stroke: var(--hz-hidden);
  }
  /* an inner edge, a ridge seen against farther land: cyan, so it never reads as the skyline */
  .trace.over.ridge {
    stroke: #4dd6ff;
  }
  /* the sea's horizon: deep blue, a skyline the sea makes */
  .trace.over.sea {
    stroke: #5b8cff;
    stroke-dasharray: 10 4;
  }
  .trace.under.picked {
    stroke: rgba(255, 255, 255, 0.85);
    stroke-width: 7;
  }
  /* a pair: the letter filled on the line in front, ringed on the line behind it */
  .pair circle {
    stroke: var(--pair);
    stroke-width: 2;
  }
  .pair.front circle {
    fill: var(--pair);
  }
  .pair.back circle {
    fill: rgba(0, 0, 0, 0.6);
  }
  .pair text {
    font: 700 10px var(--font-sans, system-ui);
    fill: #fff;
  }
  .pair.front text {
    fill: #111;
  }
  /* how far a line stands */
  .far rect {
    fill: rgba(0, 0, 0, 0.7);
    stroke: #ffd166;
    stroke-width: 1;
  }
  .far text {
    font: 600 10px var(--font-sans, system-ui);
    fill: #ffd166;
  }
  /* a line with only sky above it */
  .clear rect {
    fill: rgba(0, 0, 0, 0.7);
    stroke: #8fd3ff;
    stroke-width: 1;
  }
  .clear text {
    font: 600 10px var(--font-sans, system-ui);
    fill: #8fd3ff;
  }
  /* a line that matters most */
  .keyline rect {
    fill: rgba(0, 0, 0, 0.7);
    stroke: #ffb3e6;
    stroke-width: 1;
  }
  .keyline text {
    font: 600 10px var(--font-sans, system-ui);
    fill: #ffb3e6;
  }
  /* where a collage is cut */
  .cut {
    fill: none;
  }
  .cut.under {
    stroke: rgba(0, 0, 0, 0.5);
    stroke-width: 3.5;
  }
  .cut.over {
    stroke: #fff;
    stroke-width: 1.5;
    stroke-dasharray: 7 5;
  }

  /* -- the photo's corners, out to be pulled ----------------------------------- */
  .warp-edge {
    fill: none;
    stroke-linejoin: round;
  }
  .warp-edge.under {
    stroke: rgba(0, 0, 0, 0.5);
    stroke-width: 3.5;
  }
  .warp-edge.over {
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-dasharray: 6 4;
  }
  /* the area being chosen for a capture, drawn as the photo's edge is */
  .area {
    fill: none;
  }
  .area.under {
    stroke: rgba(0, 0, 0, 0.5);
    stroke-width: 3.5;
  }
  .area.over {
    fill: color-mix(in srgb, var(--accent) 8%, transparent);
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-dasharray: 6 4;
  }
  /* a corner is a bracket on the photo's side of its point, as a crop's is, so the frame's edge never hides it */
  .warp-corner {
    position: absolute;
    z-index: 4;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0 solid var(--accent);
    border-radius: 0;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.7));
    cursor: grab;
  }
  .warp-corner.c0 {
    border-width: 3px 0 0 3px;
  }
  .warp-corner.c1 {
    border-width: 3px 3px 0 0;
    transform: translateX(-100%);
  }
  .warp-corner.c2 {
    border-width: 0 3px 3px 0;
    transform: translate(-100%, -100%);
  }
  .warp-corner.c3 {
    border-width: 0 0 3px 3px;
    transform: translateY(-100%);
  }
  .warp-corner:hover,
  .warp-corner:active {
    background: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .warp-corner:active {
    cursor: grabbing;
  }
  .warp-corner:focus-visible,
  .warp-side:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  /* an edge's handle is a short bar along it on the photo's side, as a crop's side is, so the frame's edge never hides it */
  .warp-side {
    position: absolute;
    z-index: 4;
    width: 26px;
    height: 8px;
    padding: 0;
    border: 2px solid var(--accent);
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.7));
    cursor: ns-resize;
  }
  .warp-side.s0 {
    transform: translate(-50%, 2px);
  }
  .warp-side.s2 {
    transform: translate(-50%, calc(-100% - 2px));
  }
  .warp-side.across {
    width: 8px;
    height: 26px;
    cursor: ew-resize;
  }
  .warp-side.s1 {
    transform: translate(calc(-100% - 2px), -50%);
  }
  .warp-side.s3 {
    transform: translate(2px, -50%);
  }
  .warp-side:hover,
  .warp-side:active {
    background: color-mix(in srgb, var(--accent) 60%, transparent);
  }
  /* the grid says what the corners and the curve do to the photo, light enough to see it through */
  .warp-grid {
    fill: none;
    stroke-linejoin: round;
  }
  .warp-grid.under {
    stroke: rgba(0, 0, 0, 0.35);
    stroke-width: 2.5;
  }
  .warp-grid.over {
    stroke: rgba(255, 255, 255, 0.7);
    stroke-width: 1;
  }

  /* -- marks ------------------------------------------------------------------ */
  .pointed {
    fill: none;
  }
  .pointed .under {
    stroke: rgba(0, 0, 0, 0.6);
    stroke-width: 4;
  }
  .pointed .over {
    stroke: var(--hz-mark);
    stroke-width: 2;
  }
  .pivot {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .pivot .under {
    stroke: rgba(0, 0, 0, 0.6);
    stroke-width: 4;
  }
  .pivot .over {
    stroke: var(--hz-mark);
    stroke-width: 1.8;
  }
  .rubber {
    fill: color-mix(in srgb, var(--text-1) 12%, transparent);
    stroke: var(--text-1);
    stroke-width: 1;
  }
  .pivot .ring {
    stroke-dasharray: 5 4;
  }
  .pivot .over .dot {
    fill: var(--hz-mark);
  }
  .target path {
    fill: var(--hz-seen);
    stroke: var(--bg-0);
    stroke-width: 1.5;
  }
  .target.hidden path {
    fill: var(--hz-hidden);
  }
  .note {
    position: absolute;
    transform: translateX(-50%);
    padding: 1px 6px;
    color: var(--hz-seen);
    font-size: 11px;
    white-space: nowrap;
    pointer-events: none;
  }
  .note.hidden {
    color: var(--hz-hidden);
  }
  .away {
    position: absolute;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 8px;
    transform: translateY(-50%);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .away.left {
    left: 8px;
  }
  .away.right {
    right: 8px;
  }
  .away:hover {
    color: var(--accent);
  }
  .away .turn {
    color: var(--text-2);
  }
  .away .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--hz-seen);
  }
  .away.hidden .dot {
    background: var(--hz-hidden);
  }
  .away.sun .dot {
    background: var(--hz-sun);
  }

  /* -- sun and moon ------------------------------------------------------------ */
  .track {
    fill: none;
    stroke-width: 1.6;
  }
  .track.sun {
    stroke: var(--hz-sun);
  }
  .track.moon {
    stroke: var(--hz-moon);
  }
  /* behind a ridge: still drawn, so the eye sees where it goes */
  .track.hidden {
    stroke-dasharray: 3 5;
    opacity: 0.7;
  }
  .body.hidden {
    opacity: 0.45;
  }
  .track-tick.sun,
  .body.sun {
    fill: var(--hz-sun);
  }
  .track-tick.moon,
  .body.moon {
    fill: var(--hz-moon);
  }
  .body {
    stroke: color-mix(in srgb, var(--bg-0) 60%, transparent);
    stroke-width: 1.5;
  }
  .track-label {
    font-size: 10px;
    font-family: var(--font-mono);
    paint-order: stroke;
    stroke: var(--bg-0);
    stroke-width: 3px;
    stroke-opacity: 0.75;
  }
  .track-label.sun {
    fill: var(--hz-sun);
  }
  .track-label.moon {
    fill: var(--hz-moon);
  }
  .track-label.now {
    font-size: 11px;
    font-weight: 600;
  }

  /* -- what sits on the view ------------------------------------------------- */
  .controls {
    position: absolute;
    top: 10px;
    right: 10px;
  }
  /* how much the loupe magnifies, and the way back to the whole photo */
  .loupe {
    position: absolute;
    top: 10px;
    left: 48px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 2px 2px 8px;
    font-size: 11px;
  }
  .loupe button {
    height: 22px;
    padding: 0 8px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-1);
    font: inherit;
    cursor: pointer;
  }
  .loupe button:hover {
    background: color-mix(in srgb, var(--text-1) 10%, transparent);
  }
  .loupe button:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .readout {
    position: absolute;
    padding: 3px 7px;
    font-size: 11px;
    white-space: nowrap;
    pointer-events: none;
  }
  /* the bottom-left corner: what the lines mean, over what the hand can do */
  .notes {
    position: absolute;
    left: 10px;
    bottom: 32px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    max-width: calc(100% - 20px);
    pointer-events: none;
  }
  .hint {
    margin: 0;
    padding: 3px 8px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 3px 12px;
    margin: 0;
    padding: 3px 8px;
    list-style: none;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .swatch {
    width: 14px;
    height: 3px;
    border-radius: 2px;
    background: var(--hz-mark);
  }
  .swatch.on {
    background: var(--hz-seen);
  }
  .swatch.near {
    background: var(--accent);
  }
  .swatch.off {
    background: var(--hz-hidden);
  }
  .swatch.ridge {
    background: #4dd6ff;
  }
  .swatch.sea {
    background: repeating-linear-gradient(90deg, #5b8cff 0 7px, transparent 7px 10px);
  }
  .swatch.terrain {
    height: 2px;
    background: #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
  }
  .swatch.ridge-lines {
    height: 1px;
    background: rgba(255, 255, 255, 0.75);
  }
  .swatch.level {
    height: 0;
    border-top: 1px dashed color-mix(in srgb, var(--text-1) 60%, transparent);
    border-radius: 0;
    background: none;
  }
  .swatch.margin {
    height: 9px;
    border: 1px dashed rgba(255, 255, 255, 0.5);
    border-radius: 1px;
    background: rgba(255, 255, 255, 0.16);
  }
  .swatch.cut {
    width: 0;
    height: 11px;
    border-left: 2px dashed #fff;
    border-radius: 0;
    background: none;
  }
  .swatch.clear {
    width: 12px;
    height: 8px;
    border: 1px solid #8fd3ff;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.7);
  }
  .swatch.key {
    width: 12px;
    height: 8px;
    border: 1px solid #ffb3e6;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.7);
  }
  .swatch.pair {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #ff9f43;
    box-shadow: 0 0 0 2px var(--hz-glass), 0 0 0 3px #ff9f43;
  }
  .credits {
    position: absolute;
    right: 8px;
    bottom: 30px;
    padding: 1px 6px;
    border-radius: var(--r-sm);
    background: var(--hz-glass);
    color: var(--text-2);
    font-size: 10px;
    pointer-events: none;
  }
  /* what the buildings' heights rest on, over the imagery's credits: always there, never in the way */
  .building-caveat {
    position: absolute;
    right: 8px;
    bottom: 50px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    max-width: min(440px, calc(100% - 16px));
    margin: 0;
    padding: 2px 7px;
    border-radius: var(--r-sm);
    background: var(--hz-glass);
    color: var(--text-2);
    font-size: 11px;
    font-style: italic;
    line-height: 1.4;
    text-align: right;
    pointer-events: none;
  }
  /* the ground still loading, said once over the view rather than in a corner of the page */
  /* an export draws its own camera into the canvas: the screen waits behind this */
  .export-veil {
    position: absolute;
    inset: 0;
    z-index: 6;
    background: var(--bg-0);
  }
  .loading {
    position: absolute;
    top: 10px;
    left: 50%;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 200px;
    padding: 4px 10px;
    transform: translateX(-50%);
    color: var(--text-2);
    font-size: var(--fs-xs);
    text-align: center;
    white-space: nowrap;
    pointer-events: none;
  }
  .loading .bar {
    height: 2px;
    border-radius: 1px;
    background: color-mix(in srgb, var(--text-1) 15%, transparent);
    overflow: hidden;
  }
  .loading .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }
  /* the buildings' question or progress: under the view's own controls and loading line */
  .building-note {
    top: 52px;
    max-width: min(460px, calc(100% - 32px));
    white-space: normal;
  }
  .building-note.asking {
    color: var(--text-1);
    pointer-events: auto;
  }
  .note-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
  }
  .note-actions button {
    height: 22px;
    padding: 0 8px;
    border: none;
    border-radius: var(--r-sm);
    background: var(--accent);
    color: var(--accent-text);
    font: inherit;
    cursor: pointer;
  }
  .note-actions button.quiet {
    background: color-mix(in srgb, var(--text-1) 10%, transparent);
    color: var(--text-1);
  }
  .bar.waiting span {
    width: 30%;
    animation: hz-waiting 1.2s ease-in-out infinite alternate;
  }
  @keyframes hz-waiting {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(233%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar.waiting span {
      animation: none;
    }
  }
  .loading.failed {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    color: var(--text-1);
    pointer-events: auto;
  }
  .loading.failed button {
    height: 22px;
    padding: 0 8px;
    border: none;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--text-1) 10%, transparent);
    color: var(--text-1);
    font: inherit;
    cursor: pointer;
  }
  .notice {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }

  /* -- the ruler and its caret ------------------------------------------------- */
  .ruler {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 24px;
    background: var(--hz-glass);
    pointer-events: none;
  }
  .tick {
    position: absolute;
    bottom: 4px;
    transform: translateX(-50%);
    color: var(--text-2);
    font-family: var(--font-mono);
    font-size: 10.5px;
    white-space: nowrap;
  }
  .tick::before {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 15px;
    width: 1px;
    height: 5px;
    background: color-mix(in srgb, var(--text-1) 50%, transparent);
  }
  .tick.named {
    color: var(--text-1);
    font-weight: 700;
  }
  /* the caret and its two arrows, centred on the heading: the arrows are alike, so the notch stays true */
  .caret-row {
    position: absolute;
    left: 50%;
    bottom: 2px;
    display: flex;
    align-items: flex-end;
    gap: 3px;
    transform: translateX(-50%);
    pointer-events: auto;
  }
  .hz-nudge {
    display: grid;
    place-items: center;
    width: 18px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: var(--r-sm);
    background: var(--hz-glass);
    box-shadow: 0 0 0 1px var(--border);
    color: var(--text-1);
    cursor: pointer;
  }
  .hz-nudge:hover:not(:disabled) {
    color: var(--accent);
  }
  .hz-nudge:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .hz-nudge svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .hz-caret {
    position: relative;
    min-width: 64px;
    width: max-content;
    height: 24px;
    padding: 0 8px;
    border: none;
    border-radius: var(--r-sm);
    background: var(--accent);
    color: var(--accent-text);
    font-size: 11px;
    font-weight: 600;
    text-align: center;
    pointer-events: auto;
    cursor: text;
  }
  /* the notch points up at the exact heading */
  .hz-caret::before {
    content: '';
    position: absolute;
    left: 50%;
    top: -5px;
    border: 5px solid transparent;
    border-top: none;
    border-bottom: 5px solid var(--accent);
    transform: translateX(-50%);
  }
  input.hz-caret {
    width: 64px;
    outline: none;
    box-shadow: inset 0 0 0 2px var(--accent-text);
  }
  button.hz-caret:disabled {
    cursor: default;
    opacity: 0.75;
  }
  button.hz-caret:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--bg-0), 0 0 0 4px var(--accent);
  }
</style>
