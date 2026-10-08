<script>
  /**
   * What the eye sees: the app's panorama looked through the camera.
   *
   * The picture is drawn on the GPU (lib/horizon/renderer.js) and redrawn only
   * when something changed, once a frame at most, so a drag or a wheel turn
   * never waits on anything but the screen. Everything read off the picture is
   * laid over it in the page, positioned by the same camera arithmetic the
   * shader uses (lib/horizon/camera.js): the azimuth ruler with the heading
   * caret, the elevation scale and the level line, the summit names set in the
   * sky, the marks, and the reading that follows the pointer.
   *
   * Gestures, as in a street-level viewer: the landscape follows the hand when
   * dragged, the wheel narrows or widens the lens about the point under the
   * pointer, Shift and a drag rolls the frame, Alt and the wheel raises or
   * lowers the eye. A click that did not drag reads the ground there, which
   * the map then shows. A line at the bottom says so until the first drag.
   *
   * A photo or a video laid over the view (state/overlay.svelte.js) is drawn
   * on the GPU too, fixed on screen while the same gestures move the terrain
   * under it; while its skyline is being traced, a drag draws instead.
   */
  import { onMount } from 'svelte';
  import { createRenderer } from '../../lib/horizon/renderer.js';
  import { rayFor, toScreen, turnBetween, verticalFov } from '../../lib/horizon/camera.js';
  import { cellAt, inSight, SKY, skylineAt } from '../../lib/horizon/panorama.js';
  import {
    azimuthTicks,
    elevationTicks,
    faceTowards,
    groundPoint,
    headingText,
    levelLine,
    parseHeading,
  } from '../../lib/horizon/geometry.js';
  import { labelAt, mergePeaks, placeLabels } from '../../lib/horizon/labels.js';
  import { heightStep, heightText, strokeFrom } from '../../lib/horizon/overlay.js';
  import { pointerReading, summitReading } from '../../lib/horizon/readings.js';
  import { formatDistance } from '../../lib/measure.js';
  import { MAP_LIGHT, shadowKeep } from '../../lib/horizon/sky.js';
  import { RIDGE_STEPS, shadowFits } from './state/horizon.svelte.js';
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
  /** How far either side of the heading caret the ruler keeps its labels out. */
  const CARET_CLEAR = 52;

  let box = $state();
  let canvas = $state();
  let renderer = null;
  let unsupported = $state('');
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

  const camera = $derived({ ...view.camera, width: size.width, height: size.height });

  /** The distance at a direction from the finest picture held there, or SKY / null. */
  function depthAt(azimuth, elevation) {
    for (const picture of [view.detail, view.panorama]) {
      if (!picture) continue;
      const cell = cellAt(picture, azimuth, elevation);
      if (cell >= 0) return picture.depth[cell];
    }
    return null;
  }

  // -- drawing ----------------------------------------------------------------

  let shownPanorama = null;
  let shownDetail = null;
  let shownDrape = null;
  let shownDetailDrape = null;
  let shownShadow = null;
  let shownPicture = null;
  let shownFrame = -1;
  function draw() {
    frame = 0;
    if (!renderer) return;
    if (view.panorama !== shownPanorama) {
      shownPanorama = view.panorama;
      if (shownPanorama) renderer.setPanorama(shownPanorama);
    }
    if (view.detail !== shownDetail) {
      shownDetail = view.detail;
      renderer.setDetail(shownDetail);
    }
    if (view.drape !== shownDrape) {
      shownDrape = view.drape;
      renderer.setDrape(shownDrape?.image ?? null);
    }
    if (view.detailDrape !== shownDetailDrape) {
      shownDetailDrape = view.detailDrape;
      renderer.setDetailDrape(shownDetailDrape?.image ?? null);
    }
    if (view.shadow !== shownShadow) {
      shownShadow = view.shadow;
      renderer.setShadow(shownShadow);
    }
    // the photo, or the video's frame on show once it has one
    const picture = laid ? overlay.picture : null;
    const ready = !picture || !('readyState' in picture) || picture.readyState >= 2;
    if (picture !== shownPicture || (picture && overlay.frame !== shownFrame)) {
      if (ready) {
        shownPicture = picture;
        shownFrame = overlay?.frame ?? -1;
        renderer.setPhoto(picture ?? null);
      }
    }
    if (!(size.width > 0)) return;
    renderer.draw(camera, {
      ground: view.ground,
      lines: view.lines,
      sky,
      // shadows marched for another hour are left off until this one's come
      shaded: shadowFits(view.shadow, sky),
      keep: shadowKeep(view.shadowDepth),
      visibility: view.visibility ?? 0,
      jump: RIDGE_STEPS[view.ridges],
      photo: laid ? overlay.shown : 1,
    });
  }

  $effect(() => {
    // read everything a frame depends on, then draw on the next one
    void [view.panorama, view.detail, view.drape, view.detailDrape, view.shadow, view.shadowDepth, view.ground, view.lines, view.ridges, view.visibility, camera, sky];
    void [overlay?.picture, overlay?.frame, overlay?.shown];
    if (!renderer || frame) return;
    frame = requestAnimationFrame(draw);
  });

  onMount(() => {
    try {
      renderer = createRenderer(canvas);
      if (!renderer) unsupported = 'This view needs WebGL2, which this browser does not offer.';
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
      view.setFrame(size);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    fit();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      renderer?.dispose();
      renderer = null;
    };
  });

  // -- reading the picture ----------------------------------------------------

  const shown = $derived(Boolean(size.width && view.panorama));

  /** The ground under a pixel, or null for sky and off the picture. */
  function groundAt(x, y) {
    if (!view.observer || !view.panorama) return null;
    const { azimuth, elevation } = rayFor(camera, x, y);
    const distance = depthAt(azimuth, elevation);
    if (distance == null || distance === SKY) return { azimuth, elevation, distance: null };
    return { azimuth, elevation, distance, ...groundPoint(view.observer, azimuth, distance) };
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

  /** The corner the picture controls cover, which no name may. */
  const reserved = $derived(
    controls.width
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
    if (!pointer || dragging || !shown || heightNote) return null;
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

  /** Controls laid over the view keep their own clicks and keys. */
  const onControl = (event) => Boolean(event.target?.closest?.('.hz-control'));

  /** The stroke being drawn along the photo's skyline, in CSS pixels, while the hand is down. */
  let drawing = $state.raw([]);
  const tracing = $derived(laid && overlay.tracing);

  function onPointerDown(event) {
    if (event.button !== 0 || !view.panorama || onControl(event)) return;
    box.setPointerCapture(event.pointerId);
    box.focus({ preventScroll: true });
    if (tracing) {
      press = { ...local(event), tracing: true };
      drawing = [local(event)];
      return;
    }
    press = { ...local(event), camera: { ...view.camera }, moved: false, roll: event.shiftKey };
  }

  function onPointerMove(event) {
    const at = local(event);
    if (!press) {
      pointer = onControl(event) || tracing ? null : { ...at, ground: groundAt(at.x, at.y) };
      return;
    }
    if (press.tracing) {
      drawing = [...drawing, at];
      return;
    }
    const dx = at.x - press.x;
    const dy = at.y - press.y;
    if (!press.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    if (!press.moved && !hinted) understood(HINT_KEY);
    if (!press.moved && laid && !photoHinted) understood(PHOTO_HINT_KEY);
    press.moved = true;
    dragging = true;
    pointer = null;
    const start = press.camera;
    if (press.roll) {
      view.look({ roll: start.roll + dx * 0.25 });
      return;
    }
    const across = start.fov / size.width;
    const up =
      start.projection === 'panorama' ? across : verticalFov({ ...start, width: size.width, height: size.height }) / size.height;
    view.look({ heading: start.heading - dx * across, tilt: start.tilt + dy * up });
  }

  function onPointerUp(event) {
    if (!press) return;
    if (press.tracing) {
      press = null;
      const stroke = strokeFrom(drawing, size);
      drawing = [];
      if (stroke.length > 1) overlay.addStroke(stroke);
      return;
    }
    const clicked = !press.moved;
    press = null;
    dragging = false;
    if (!clicked) return;
    const at = local(event);
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

  /** The lens narrows or widens about the direction under the pointer, which stays put. */
  function onWheel(event) {
    if (!view.panorama || onControl(event)) return;
    event.preventDefault();
    if (event.altKey) {
      raise(event);
      return;
    }
    const at = local(event);
    const before = rayFor(camera, at.x, at.y);
    const scale = Math.exp(event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015));
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
    if (!view.panorama || onControl(event)) return;
    if (laid && onPhotoKey(event)) {
      event.preventDefault();
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
    view.look(change);
  }

  /**
   * The photo's keys: Space plays or pauses a video, comma and full stop step
   * a frame, B blinks, T traces, Ctrl+Z takes the last stroke back, Escape
   * stops tracing. True when the key was the photo's.
   */
  function onPhotoKey(event) {
    const key = event.key;
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'z') {
      if (!overlay.strokes.length) return false;
      overlay.undoStroke();
      return true;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const video = overlay.source.kind === 'video';
    if (key === ' ' && video) overlay.togglePlay();
    else if (key === ',' && video) overlay.step(-1);
    else if (key === '.' && video) overlay.step(1);
    else if (key === 'b' || key === 'B') overlay.setBlink(!overlay.blink);
    else if (key === 't' || key === 'T') overlay.setTracing(!overlay.tracing);
    else if (key === 'Escape' && overlay.tracing) {
      event.stopPropagation();
      overlay.setTracing(false);
    } else return false;
    return true;
  }

  /** A double click on the ground goes there, facing the same way. */
  function onDoubleClick(event) {
    if (!view.panorama || onControl(event) || tracing) return;
    const at = local(event);
    const ground = groundAt(at.x, at.y);
    if (ground?.distance != null) view.standAt(ground);
  }

  // -- the heading caret: the one place the heading is written --------------------

  let typing = $state(false);
  let typed = $state('');
  let caretInput = $state();

  function editHeading() {
    typed = String(Number(view.camera.heading.toFixed(1)));
    typing = true;
    queueMicrotask(() => {
      caretInput?.focus();
      caretInput?.select();
    });
  }

  function applyHeading() {
    const heading = parseHeading(typed);
    if (heading != null) view.look({ heading });
    typing = false;
  }

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

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="horizon-view"
  class:daylight={view.ground !== 'plain' || laid}
  class:dragging
  class:tracing
  bind:this={box}
  tabindex="0"
  role="application"
  aria-label="View from the eye: drag to turn, wheel to zoom, Shift and drag to roll, Alt and wheel to change the height, click to read the ground, double-click to go there, up and down arrows to walk"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={() => {
    press = null;
    dragging = false;
  }}
  onpointerleave={() => (pointer = null)}
  onwheel={onWheel}
  onkeydown={onKey}
  ondblclick={onDoubleClick}
>
  <canvas bind:this={canvas}></canvas>

  {#if unsupported}
    <p class="notice">{unsupported}</p>
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
    {#if laid && overlay.traceShown}
      {#each overlay.strokes as stroke, index (index)}
        {@const points = stroke.map((p) => `${(p.u * size.width).toFixed(1)},${(p.v * size.height).toFixed(1)}`).join(' ')}
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
  </svg>

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
      title="Turn to it"
      onclick={() => turnTo(item)}
    >
      {#if item.side === 'left'}<span aria-hidden="true">◂</span>{/if}
      <span class="dot"></span>{item.label}
      <span class="turn">{item.turn}° {item.side}</span>
      {#if item.side === 'right'}<span aria-hidden="true">▸</span>{/if}
    </button>
  {/each}

  {#if view.panorama}
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

  {#if shown && tracing}
    <p class="glass hint">Draw along the skyline in the photo · Ctrl+Z takes a stroke back · Esc when done</p>
  {:else if shown && laid && !photoHinted}
    <p class="glass hint">Drag to move the terrain under the photo · Wheel to zoom · Shift+drag to roll · Alt+wheel for height</p>
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
      {#if typing}
        <input
          bind:this={caretInput}
          bind:value={typed}
          class="hz-caret hz-control mono"
          aria-label="Heading in degrees, or a wind such as SW"
          onkeydown={onCaretKey}
          onblur={applyHeading}
        />
      {:else}
        <button type="button" class="hz-caret hz-control mono" aria-label="Heading, click to type" onclick={editHeading}>
          {headingText(view.camera.heading, view.camera.fov)}
        </button>
      {/if}
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
  .hz-caret {
    position: absolute;
    left: 50%;
    bottom: 2px;
    min-width: 64px;
    width: max-content;
    height: 24px;
    padding: 0 8px;
    transform: translateX(-50%);
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
  button.hz-caret:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--bg-0), 0 0 0 4px var(--accent);
  }
</style>
