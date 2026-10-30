/**
 * Zoom, pan and turn for a picture read closely: a frame in Inspect, or the video
 * it was cut from. All three are view only and never saved; turning just helps
 * read a tilted sign.
 *
 * The wheel zooms toward the pointer, a left drag pans, a middle drag turns the view
 * about the grabbed point (Google-Earth style, `lib/turn.js`), and a middle click
 * that never moved stands it back upright. The turn is kept as a matrix in the
 * stage's own space (`lib/frameRotate.js`), so every new grab pivots from wherever
 * it lands with no jump, whatever the view already looks like.
 *
 * The component lays out three boxes and hands them over: the viewport (where the
 * turn's guide is drawn), the zoom layer (translate + scale only, so its box is a
 * clean screen → local map), and the stage inside it, which carries the turn.
 */
import { IDENTITY, isIdentity, matrixAngleDeg, matrixCss, rotateAbout } from './frameRotate.js';
import { beyondGuide, sweepDelta, turnBearing } from './turn.js';

export const MAX_ZOOM = 8;
/** Pixels a press may wander and still be a click. */
export const CLICK_SLOP = 4;

export class ViewTransform {
  zoom = $state(1);
  pan = $state({ x: 0, y: 0 });
  matrix = $state(IDENTITY);
  /** Whether a turn is under way, and where its guide stands in the viewport. */
  turning = $state(false);
  pivot = $state({ x: 0, y: 0 });

  dirty = $derived(this.zoom !== 1 || this.pan.x !== 0 || this.pan.y !== 0 || !isIdentity(this.matrix));
  angle = $derived(Math.round(matrixAngleDeg(this.matrix)));
  layerCss = $derived(`translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`);
  stageCss = $derived(matrixCss(this.matrix));

  reset() {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.matrix = IDENTITY;
  }

  /**
   * Zoom by one wheel notch toward the pointer. Never below the fitted size: at 1×
   * the pan snaps back to centre so the picture cannot drift off. `rect` is the
   * viewport's box; the zoom layer's transform origin is its centre.
   */
  wheel(event, rect) {
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const cX = rect.width / 2;
    const cY = rect.height / 2;
    const old = this.zoom;
    const next = Math.min(Math.max(old * (event.deltaY > 0 ? 0.9 : 1.1), 1), MAX_ZOOM);
    if (next === 1) {
      this.zoom = 1;
      this.pan = { x: 0, y: 0 };
      return;
    }
    // keep the point under the pointer fixed
    const ratio = next / old;
    this.pan = {
      x: px - (px - (cX + this.pan.x)) * ratio - cX,
      y: py - (py - (cY + this.pan.y)) * ratio - cY,
    };
    this.zoom = next;
  }

  /**
   * Pan with a left drag. `onclick` runs instead when the press never moved past
   * `CLICK_SLOP`, which is how the video takes a click as play or pause.
   */
  panFrom(event, { onclick } = {}) {
    const sx = event.clientX;
    const sy = event.clientY;
    const ox = this.pan.x;
    const oy = this.pan.y;
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < CLICK_SLOP) return;
      moved = true;
      this.pan = { x: ox + ev.clientX - sx, y: oy + ev.clientY - sy };
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) onclick?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** Turn with a middle drag, about the point grabbed on the stage. */
  turnFrom(event, { viewport, layer, stage }) {
    if (!viewport || !layer || !stage) return;
    const box = layer.getBoundingClientRect();
    const vp = viewport.getBoundingClientRect();
    const px = (event.clientX - box.left) / this.zoom - stage.offsetLeft;
    const py = (event.clientY - box.top) / this.zoom - stage.offsetTop;
    const base = this.matrix;
    const baseAngle = matrixAngleDeg(base);
    const grab = { x: event.clientX, y: event.clientY };
    this.pivot = { x: event.clientX - vp.left, y: event.clientY - vp.top };
    this.turning = true;
    let moved = false;
    let last = null; // the last point outside the guide circle, null while inside
    let swept = 0;
    const move = (ev) => {
      const at = { x: ev.clientX, y: ev.clientY };
      if (!moved && Math.hypot(at.x - grab.x, at.y - grab.y) >= CLICK_SLOP) moved = true;
      const out = beyondGuide(grab, at);
      const delta = out && last ? sweepDelta(grab, last, at) : 0;
      last = out ? at : null;
      if (!delta) return;
      swept += delta;
      const to = turnBearing(baseAngle, swept, { stepped: ev.ctrlKey || ev.metaKey });
      this.matrix = rotateAbout(base, px, py, to - baseAngle);
    };
    const up = () => {
      this.turning = false;
      if (!moved) this.matrix = IDENTITY;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
}
