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
   * on the GPU too, fixed on screen while the same gestures move the terrain
   * under it; while its skyline is being traced, a drag draws instead. Over a
   * photo the wheel is a loupe on photo and terrain together (Shift and the
   * wheel is then the lens), Space or the middle button and a drag moves the
   * loupe, and Shift and a click sets the pivot on the photo. With the photo's
   * corners out (W), a corner pulled reshapes the photo and a drag inside it
   * moves it; outside it, a drag still moves the terrain. With the photo
   * pinned to the terrain (L), the view moves over the terrain with the photo
   * on it: a drag or the arrows carry both, the wheel or + and − zoom both,
   * out past the photo's edges; nothing that would part them is taken: no
   * roll, lens, height or walk.
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
    insideCorners,
    loupeMoved,
    NO_LOUPE,
    photoAt,
    screenAt,
    strokeFrom,
  } from '../../lib/horizon/overlay.js';

  import { pointerReading, summitReading } from '../../lib/horizon/readings.js';
  import { formatDistance } from '../../lib/measure.js';
  import { MAP_LIGHT, shadowKeep } from '../../lib/horizon/sky.js';
  import { RIDGE_STEPS } from './state/horizon.svelte.js';
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
  } = $props();

  /** Where this browser remembers that the gesture lines were understood, without and with a photo. */
  const HINT_KEY = 'azimut.horizon.hint';
  const PHOTO_HINT_KEY = 'azimut.horizon.photoHint';
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
  /** The loupe over the photo while it shows anything but the whole photo, which the camera is then seen through. */
  const loupe = $derived(laid && view.camera.projection === 'camera' && loupeMoved(overlay.loupe) ? overlay.loupe : null);

  const camera = $derived({ ...view.camera, width: size.width, height: size.height, ...(loupe ? { loupe } : {}) });
  /** What the middle of the screen faces, which the heading caret says: the lens's own heading without a loupe. */
  const facing = $derived(seenLens(camera));

  // -- drawing ----------------------------------------------------------------

  let shownPicture = null;
  let shownFrame = -1;
  function draw() {
    frame = 0;
    if (!scene) return;
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
    const now = scene.draw(camera, {
      ground: view.ground,
      lines: view.lines,
      sky,
      shaded: view.shaded,
      keep: shadowKeep(view.shadowDepth),
      visibility: view.visibility ?? 0,
      near: view.near,
      jump: RIDGE_STEPS[view.ridges],
      photo: laid ? overlay.shown : 1,
      bend: laid && overlay.bend ? [overlay.bend, overlay.bendShape.across, overlay.bendShape.down] : [0, 1, 1],
    });
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
    scene?.setImagery(view.imagery);
    redraw();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      scene?.dispose();
      scene = null;
    };
  });

  // -- reading the picture ----------------------------------------------------

  const shown = $derived(Boolean(size.width && landed));

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

  /** The skyline's height on screen over a column, for the names set above it. */
  function skylineY(x) {
    const panorama = view.panorama;
    if (!panorama) return null;
    const { azimuth } = rayFor(camera, x, size.height / 2);
    const elevation = skylineAt(panorama, azimuth);
    if (!Number.isFinite(elevation)) return null;
    const at = toScreen(camera, azimuth, elevation);
    return at.visible ? at.y : null;
  }

  /**
   * Summits the picture shows, one per top, worked out once per picture rather
   * than per frame: in sight, and not lost in the haze past the visibility.
   */
  const seenPeaks = $derived.by(() => {
    if (!view.peaksOn || !view.panorama) return [];
    const reach = view.visibility ?? Infinity;
    return mergePeaks(view.peaks.filter((peak) => peak.distance <= reach && inSight(view.panorama, peak)));
  });

  /** The corner the picture controls cover, which no name may; with a photo laid they sit in its band instead. */
  const reserved = $derived(
    controls.width && !laid
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

  /** Controls laid over the view keep their own clicks and keys. */
  const onControl = (event) => Boolean(event.target?.closest?.('.hz-control'));

  /** The stroke being drawn along the photo's skyline, in CSS pixels, while the hand is down. */
  let drawing = $state.raw([]);
  const tracing = $derived(laid && overlay.tracing);
  const erasing = $derived(laid && overlay.erasing);
  /** The photo's corners out to be pulled. */
  const warping = $derived(laid && overlay.warping);
  /** The photo held to the terrain: the view's gestures carry both, and none parts them. */
  const locked = $derived(laid && overlay.locked);
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
    press = { ...local(event), camera: { ...camera }, moved: false, roll: event.shiftKey, pivot: pivotAt, swept: 0, angle: null };
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
    if (!press) {
      if (onControl(event) || tracing || erasing || overPhoto) {
        pointer = null;
        return;
      }
      // the reading follows a frame later, so the page never waits on the GPU while the hand moves
      pointer = { ...at, ground: pointer?.ground ?? null };
      const ask = ++hoverAsked;
      scene?.groundSoon(camera, at.x, at.y).then((ground) => {
        if (ground !== undefined && ask === hoverAsked && pointer) pointer = { ...pointer, ground };
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
    if (press.shaping) {
      press = null;
      dragging = false;
      overlay.setPulling(false);
      return;
    }
    if (press.tracing) {
      press = null;
      const stroke = strokeFrom(drawing, size, { loupe: shownLoupe });
      drawing = [];
      // snapped onto the sky's edge near it, unless Alt asks for the line as drawn
      if (stroke.length > 1) overlay.addStroke(stroke, { snap: !event.altKey, scale: photoScale });
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
   * stays put. Over a photo the wheel is the loupe, about the pointer too,
   * and Shift and the wheel the lens.
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
    if (laid && !event.shiftKey) {
      // not under a stroke being drawn, which is kept in screen pixels until the hand lifts
      if (!press?.tracing) overlay.zoomLoupe(Math.exp(-delta * unit), at, size);
      return;
    }
    // the lens would part a locked photo from its terrain
    if (locked) return;
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
   * locks the photo to the terrain, H hides the trace, Ctrl+Z takes the last change to the trace back, Escape
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
    else if (key === 't' || key === 'T') overlay.setTracing(!overlay.tracing);
    else if (key === 'e' || key === 'E') overlay.setErasing(!overlay.erasing);
    else if ((key === 'w' || key === 'W') && overlay.source.kind === 'image') overlay.setWarping(!overlay.warping);
    else if (key === 'l' || key === 'L') overlay.setLocked(!overlay.locked);
    else if ((key === 'h' || key === 'H') && overlay.strokes.length) overlay.setTraceHidden(!overlay.traceHidden);
    else if (key === 'Escape' && (overlay.tracing || overlay.erasing || overlay.warping)) {
      event.stopPropagation();
      overlay.setTracing(false);
      overlay.setErasing(false);
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
    if (!view.observer || onControl(event) || tracing || erasing || locked) return;
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
  class:tracing={tracing || erasing}
  class:shaping={overPhoto}
  class:panning={laid && spaceHeld}
  bind:this={box}
  tabindex="0"
  role="application"
  aria-label={laid
    ? 'Photo over the view: drag to move the terrain under it, wheel to look closer, Space and drag to move around the photo, Shift and drag to roll about the pivot, Shift and click to set the pivot, Shift and wheel to change the lens, Alt and wheel to change the height'
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
  {:else if view.observer && loadingText}
    <div class="glass loading" role="status" aria-live="polite">
      {loadingText}
      {#if progress.phase === 'landing' || progress.phase === 'imagery'}
        <span class="bar"><span style:width="{Math.round(progress.share * 100)}%"></span></span>
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
    {#if laid && overlay.traceShown && !overlay.traceHidden}
      {#each overlay.strokesSeen as stroke, index (index)}
        {@const points = onScreen(stroke)}
        <polyline class="trace under" {points} />
        <polyline class="trace over" {points} />
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
    {#if cornersAt.length}
      <polygon class="warp-edge under" points={cornersLine} />
      <polygon class="warp-edge over" points={cornersLine} />
    {/if}
    {#if shown && ((shiftHeld && hovering) || rollNote)}
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
      title={locked ? 'Unlock the photo to turn' : 'Turn to it'}
      onclick={() => turnTo(item)}
    >
      {#if item.side === 'left'}<span aria-hidden="true">◂</span>{/if}
      <span class="dot"></span>{item.label}
      <span class="turn">{item.turn}° {item.side}</span>
      {#if item.side === 'right'}<span aria-hidden="true">▸</span>{/if}
    </button>
  {/each}

  {#if view.observer && !laid}
    <div class="controls">
      <PictureControls {view} {copernicus} {onsetup} bind:width={controls.width} bind:height={controls.height} />
    </div>
  {/if}

  {#if readout}
    <div class="glass readout mono" style:left="{readout.x}px" style:top="{readout.y}px">{readout.text}</div>
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

  {#if shown && warping}
    <p class="glass hint">Pull a corner to reshape the photo · Drag inside it to move it · Esc when done</p>
  {:else if shown && tracing}
    <p class="glass hint">Draw along the skyline, it snaps to the edge · Alt+drag draws freely · Wheel to look closer · Esc when done</p>
  {:else if shown && erasing}
    <p class="glass hint">Drag over the trace to rub it out · Wheel to look closer · Ctrl+Z takes it back · Esc when done</p>
  {:else if shown && laid && !photoHinted}
    <p class="glass hint">Drag to move the terrain under the photo · Wheel to look closer · Space+drag to move around · Shift+drag to roll</p>
  {:else if shown && !hinted}
    <p class="glass hint">Drag to turn · Wheel to zoom · Double-click to go there · ↑ ↓ to walk</p>
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
              title={locked ? 'Unlock the photo to turn' : undefined}
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
  .horizon-view.shaping {
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
  .warp-corner:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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
  .hint {
    position: absolute;
    left: 10px;
    bottom: 32px;
    margin: 0;
    padding: 3px 8px;
    color: var(--text-2);
    font-size: var(--fs-xs);
    pointer-events: none;
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
  /* the ground still loading, said once over the view rather than in a corner of the page */
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
