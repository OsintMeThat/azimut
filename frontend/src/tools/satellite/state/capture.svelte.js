/**
 * Taking a crop of the map and filing it as a capture.
 *
 * Two roads reach the same place. Most basemaps are tiles, so the backend
 * stitches the frame at whatever zoom the output asks for. A widget basemap has
 * no tiles anyone may touch — Google's terms allow a user-taken screenshot and
 * nothing programmatic — so those pixels come from the browser extension
 * grabbing the tab. Everything either side of that one step is deliberately
 * identical: the same frame, the same two modes, the same filing.
 *
 * What the rules here are actually protecting is *provenance*. A capture is
 * evidence, and the questions it has to survive are "which imagery is this?"
 * and "where exactly?":
 *
 * - **The pixels name themselves.** Provenance is asked of the surface that
 *   drew them, not of the provider that was chosen — a billed basemap that
 *   stepped aside for the eco fallback must not be filed under the name of the
 *   one the analyst picked.
 * - **A refused capture stays untaken.** When the extension grab fails, nothing
 *   offers to file some other image instead: that is how an unregistered
 *   picture ends up wearing a capture's provenance.
 * - **Our own chrome leaves the frame first.** A tab grab sees the whole
 *   viewport, so the HUD, the controls and the reference windows are hidden for
 *   the shot. The marker is the exception, because the tile path burns one into
 *   its crop and a screen crop missing it would be the odd one out.
 * - **The frame has to fit the view.** A crop bigger than the map on screen has
 *   no pixels to come from, so it is refused with the reason rather than
 *   silently shrunk.
 *
 * The sizing arithmetic is `lib/captureSize.js`, the registration and crop maths
 * `lib/screenCrop.js`, and the extension handshake `lib/extBridge.js`. This
 * holds what shape the output is, which mode the button runs, and the acts.
 *
 * @param {object} deps
 * @param {object} deps.api the app's fetch wrapper
 * @param {(message: string, kind?: string, ms?: number) => void} deps.notify
 * @param {() => Promise<object>} deps.ensureCase the case to file into, made if needed
 * @param {() => Promise<any>} deps.reloadCase
 * @param {() => object|null} deps.engine the map, through the façade
 * @param {() => Element|null} deps.element the map container, for its rectangle
 * @param {() => {lat: number, lon: number, zoom: number}} deps.view where the camera is
 * @param {() => number} deps.bearing which way is up
 * @param {() => {style: string, at: object|null}} deps.marker the pin, if one was moved
 * @param {() => object|undefined} deps.basemap the provider the analyst chose
 * @param {() => number} deps.maxZoom the deepest zoom the *shown* provider has
 * @param {() => {provider: string, imageryDate: string|null}} deps.provenance the pixels' own
 * @param {(rect: object|null) => void} deps.onRect the live marquee outline
 * @param {() => void} deps.onArm the map modes arming the marquee turns off
 */
import { clampSize, scaledCapture } from '../../../lib/captureSize.js';
import { captureTab, extensionVersion } from '../../../lib/extBridge.js';
import { frameFitsView, isRegistered, sourceRect } from '../../../lib/screenCrop.js';
import { startRectDrag } from '../../../lib/map/gestures.js';

/** Standard output sizes for the centred button, named by what they are for. */
export const PRESETS = [
  { id: '1200x675', label: 'Tweet 16:9', w: 1200, h: 675 },
  { id: '1080x1080', label: 'Square', w: 1080, h: 1080 },
  { id: '1200x630', label: 'OG card', w: 1200, h: 630 },
  { id: '1280x800', label: 'Wide', w: 1280, h: 800 },
  { id: 'custom', label: 'Custom', w: 0, h: 0 },
];

/** Marquee aspect lock (width / height); null drags free-form. */
export const RATIOS = [
  { id: 'free', label: 'Free', r: null },
  { id: '16:9', label: '16:9', r: 16 / 9 },
  { id: '4:3', label: '4:3', r: 4 / 3 },
  { id: '1:1', label: '1:1', r: 1 },
];

/** Below this, a drag is a slipped click rather than a box. */
const MIN_DRAG_PX = 12;

export function createCaptureState({
  api,
  notify,
  ensureCase,
  reloadCase,
  engine,
  element,
  view,
  bearing,
  marker,
  basemap,
  maxZoom,
  provenance,
  onRect,
  onArm,
}) {
  let preset = $state('1200x675');
  let customW = $state(1200);
  let customH = $state(675);
  let ratio = $state('free');
  // 1 = the view's own zoom, 2 = one zoom deeper, 'max' = the provider's deepest.
  let resolution = $state(1);
  // The button runs whichever mode was used last, so this *is* that memory.
  let mode = $state('center'); // 'center' | 'select'
  let menuOpen = $state(false); // the mode/size/ratio/resolution popover
  let armed = $state(false); // marquee: drag a box on the map to capture it
  let busy = $state(false);
  let hiding = $state(false); // our chrome, out of the way of a tab grab
  let extGate = $state(false); // the "you need the extension" explainer
  let shotOpen = $state(false); // the paste/drop fallback dialog

  /** The chosen output size in px. Custom is clamped to what the backend takes. */
  const size = $derived.by(() => {
    if (preset === 'custom') return [clampSize(customW), clampSize(customH)];
    const chosen = PRESETS.find((entry) => entry.id === preset);
    return [chosen.w, chosen.h];
  });

  const lock = $derived(RATIOS.find((entry) => entry.id === ratio)?.r ?? null);
  /** A widget basemap is captured from screen pixels — it has no tiles to stitch. */
  const widget = $derived(!!basemap()?.widget);
  /** View-only basemaps keep the map but not the button. A widget is *not* one:
   *  it captures the same way through the same button, from other pixels. */
  const blocked = $derived(basemap()?.capturable === false && !widget);

  /** One frame of this tab as a drawable image, through the extension. The
   *  frame is exactly the viewport, so registration is the viewport aspect
   *  check — a mismatch means browser zoom mid-flight or a foreign frame, and
   *  both are refusals. */
  async function tabFrame() {
    const dataUrl = await captureTab();
    const img = new window.Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('unreadable frame from the extension'));
      img.src = dataUrl;
    });
    if (!isRegistered(img.naturalWidth, img.naturalHeight, window.innerWidth, window.innerHeight)) {
      throw new Error('the captured frame does not match this view. Try again');
    }
    return img;
  }

  /** Map a rect in map-container CSS px onto the captured frame and render it at
   *  exactly `outW`×`outH` (default: the native source pixels). Source pixels
   *  are usually denser than CSS px, so a requested size is a supersampled
   *  downscale rather than a blur-up. */
  async function cropFrame(img, rect, outW, outH) {
    const src = sourceRect(rect, {
      mapRect: element().getBoundingClientRect(),
      viewportWidth: window.innerWidth,
      videoWidth: img.naturalWidth,
      videoHeight: img.naturalHeight,
    });
    if (!src) {
      throw new Error(
        'the frame runs past the captured area. Resize the window or pick a smaller size'
      );
    }
    const { sx, sy, sw, sh } = src;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(outW ?? sw);
    canvas.height = Math.round(outH ?? sh);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /** File a screenshot blob as a capture. `framed` records whether the
   *  coordinates are the centre of a registered crop or just the map view at
   *  filing time — the backend keeps that distinction in provenance. */
  async function fileScreenshot(blob, framedOn, framed) {
    const here = view();
    const owner = await ensureCase();
    const form = new FormData();
    form.append('image', blob, 'screenshot.png');
    form.append('lat', String(framedOn ? framedOn.lat : here.lat));
    form.append('lon', String(framedOn ? framedOn.lon : here.lon));
    form.append('zoom', String(here.zoom));
    form.append('bearing', String(bearing()));
    form.append('provider', basemap().id);
    form.append('framed', String(!!framed));
    const result = await api.post(`/api/cases/${owner.id}/satellite/screenshot`, form);
    await reloadCase();
    notify(
      framed
        ? 'Screen crop captured & filed (attribution burned in)'
        : 'Screenshot filed as a capture (attribution burned in)',
      'ok'
    );
    return result;
  }

  /** The widget arm: grab the tab, crop it to the frame, file it. */
  async function widgetCapture(framedOn, rect) {
    if (!extensionVersion()) {
      extGate = true;
      return;
    }
    if (!frameFitsView(rect, element().getBoundingClientRect())) {
      notify(
        `The ${Math.round(rect.w)}×${Math.round(rect.h)} frame is bigger than the map view. ` +
          'Pick a smaller size or enlarge the window',
        'warn',
        7000
      );
      return;
    }
    busy = true;
    hiding = true;
    try {
      // let the hidden chrome actually leave the composited frame
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 60));
      const img = await tabFrame();
      const canvas = await cropFrame(img, rect, Math.round(rect.w), Math.round(rect.h));
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      await fileScreenshot(blob, framedOn, true);
    } catch (e) {
      if (e.needsActivation) {
        // one-time per tab: the browser only lets the extension screenshot a tab
        // it has been invoked on (activeTab) — not an error, a step
        notify(
          'One-time step: click the Azimut Capture icon in the toolbar ' +
            '(or press Alt+Shift+A), then press Capture again',
          'warn',
          10000
        );
      } else {
        notify(`Capture failed: ${e.message}`, 'danger', 7000);
      }
    } finally {
      hiding = false;
      busy = false;
    }
  }

  /**
   * The single capture path. `framedOn` is the `{ lat, lon }` the crop is framed
   * on; `baseW`/`baseH` are its size at the current view zoom, then scaled to
   * the chosen output resolution. `rectCss` is the same frame as a rectangle in
   * map-container px — only the widget road needs it, since it crops screen
   * pixels rather than stitching tiles.
   */
  async function take(framedOn, baseW, baseH, rectCss) {
    if (busy) return;
    if (widget) return widgetCapture(framedOn, rectCss);
    busy = true;
    const facade = engine();
    const here = view();
    const { zoom, width, height, mult } = scaledCapture(
      baseW,
      baseH,
      resolution,
      here.zoom,
      maxZoom()
    );
    const pin = marker();
    let markerX = 0;
    let markerY = 0;
    let markerLat = framedOn.lat;
    let markerLon = framedOn.lon;
    if (pin.at) {
      markerLat = pin.at.lat;
      markerLon = pin.at.lon;
      // offset from the crop centre in container px (rotation already folded
      // in), scaled up to the output pixel size
      const middle = facade.latLngToContainerPoint(framedOn);
      const point = facade.latLngToContainerPoint(pin.at);
      markerX = Math.round((point.x - middle.x) * mult);
      markerY = Math.round((point.y - middle.y) * mult);
    }
    // The pixels' own provenance, asked of the surface that drew them.
    const pixels = provenance();
    try {
      const owner = await ensureCase();
      const result = await api.post(`/api/cases/${owner.id}/satellite/capture`, {
        lat: framedOn.lat,
        lon: framedOn.lon,
        zoom,
        width,
        height,
        provider: pixels.provider,
        bearing: bearing(),
        marker_style: pin.style,
        marker_x: markerX,
        marker_y: markerY,
        marker_lat: markerLat,
        marker_lon: markerLon,
        // the second date on a capture: when the imagery itself was acquired. A
        // pinned Sentinel-2 window is that date outright; every other provider's
        // is Esri's best-effort estimate, or nothing.
        imagery_date: pixels.imageryDate,
      });
      await reloadCase();
      notify(
        result.tiles_missing
          ? `Captured with ${result.tiles_missing} missing tile(s). No imagery was available there`
          : result.tiles_upscaled
            ? `Captured. ${result.tiles_upscaled} tile(s) were upscaled from a lower zoom and recorded in provenance`
            : 'Satellite crop captured & filed',
        result.tiles_missing || result.tiles_upscaled ? 'warn' : 'ok'
      );
    } catch (e) {
      notify(`Capture failed: ${e.message}`, 'danger', 6000);
    } finally {
      busy = false;
    }
  }

  /** The centred button: the chosen preset, framed on the map centre. */
  function takeCentered() {
    const [w, h] = size;
    const box = element().getBoundingClientRect();
    return take(engine().camera(), w, h, {
      x: (box.width - w) / 2,
      y: (box.height - h) / 2,
      w,
      h,
    });
  }

  function toggleSelect() {
    armed = !armed;
    if (armed) {
      menuOpen = false;
      onArm();
    } else {
      onRect(null);
    }
    return armed;
  }

  function finishSelect(dragged) {
    onRect(null);
    if (!dragged) return;
    const w = Math.abs(dragged.x1 - dragged.x0);
    const h = Math.abs(dragged.y1 - dragged.y0);
    if (w < MIN_DRAG_PX || h < MIN_DRAG_PX) return; // a slipped click, not a box
    const framedOn = engine().containerPointToLatLng({
      x: (dragged.x0 + dragged.x1) / 2,
      y: (dragged.y0 + dragged.y1) / 2,
    });
    armed = false; // one box per arm — re-arm to draw another
    take(framedOn, Math.round(w), Math.round(h), {
      x: Math.min(dragged.x0, dragged.x1),
      y: Math.min(dragged.y0, dragged.y1),
      w,
      h,
    });
  }

  return {
    get preset() {
      return preset;
    },
    set preset(value) {
      preset = value;
    },
    get customW() {
      return customW;
    },
    set customW(value) {
      customW = value;
    },
    get customH() {
      return customH;
    },
    set customH(value) {
      customH = value;
    },
    get ratio() {
      return ratio;
    },
    set ratio(value) {
      ratio = value;
    },
    get resolution() {
      return resolution;
    },
    set resolution(value) {
      resolution = value;
    },
    get mode() {
      return mode;
    },
    set mode(value) {
      mode = value;
    },
    get menuOpen() {
      return menuOpen;
    },
    set menuOpen(value) {
      menuOpen = value;
    },
    get extGate() {
      return extGate;
    },
    set extGate(value) {
      extGate = value;
    },
    get shotOpen() {
      return shotOpen;
    },
    set shotOpen(value) {
      shotOpen = value;
    },
    get armed() {
      return armed;
    },
    get busy() {
      return busy;
    },
    /** Our chrome is hidden mid-grab, so it cannot land in the crop. */
    get hiding() {
      return hiding;
    },
    get size() {
      return size;
    },
    get lock() {
      return lock;
    },
    get widget() {
      return widget;
    },
    get blocked() {
      return blocked;
    },

    /**
     * The main button. It runs whichever mode was last used, which is what
     * `mode` remembers. A widget basemap needs the extension before any frame
     * is drawn — gate there and explain, rather than half-working.
     */
    run() {
      if (blocked || busy) return;
      if (widget && !extensionVersion()) {
        extGate = true;
        return;
      }
      if (mode === 'select') toggleSelect();
      else takeCentered();
    },

    toggleSelect,

    /** Put the marquee away because another map mode took the left button.
     *  Unlike `toggleSelect`, this claims nothing back: the mode arming is the
     *  one saying what else it turns off. */
    disarm() {
      if (!armed) return;
      armed = false;
      onRect(null);
    },

    /** Left-drag on the map, while the marquee is armed. */
    startSelect(e) {
      const facade = engine();
      if (!armed || e.button !== 0 || !facade) return;
      startRectDrag(facade, e, {
        ratio: lock,
        onChange: (rect) => onRect(rect),
        onDone: finishSelect,
      });
    },

    /** The whole map view as a PNG blob, for the paste/drop dialog's preview.
     *  Null if the extension refused — that path still takes a pasted image. */
    async grabView() {
      try {
        const img = await tabFrame();
        const box = element().getBoundingClientRect();
        const canvas = await cropFrame(img, { x: 0, y: 0, w: box.width, h: box.height });
        return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      } catch (e) {
        notify(
          `Screen capture unavailable (${e.message}). Paste a screenshot instead`,
          'warn',
          6000
        );
        return null;
      }
    },

    /** File what the dialog holds, at the map view rather than a registered frame. */
    async fileBlob(blob) {
      try {
        await fileScreenshot(blob, null, false);
        return true;
      } catch (e) {
        notify(`Could not file the screenshot: ${e.message}`, 'danger', 6000);
        return false;
      }
    },
  };
}
