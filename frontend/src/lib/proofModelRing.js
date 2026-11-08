/**
 * The ring round a selected model stamp: the accent knob turns the model on the
 * ground, the white knob on the arc beside it tilts the view from above (top of
 * the arc) to the side (bottom).
 *
 * The heading is the model's own: the knob shows it on the page, so it stands where
 * the nose points whatever the stamp's or the picture's own turn. While a knob is
 * held only the drawn shape changes; the shape's fields are written when it is let
 * go, so a drag is one undo.
 */
import { MODEL_SHAPE } from './proofModelNode.js';

/** The arc's two ends, in degrees clockwise from up: off the top, where the stamp's own turn knob stands. */
const ARC_START = 30;
const ARC_END = 120;
/** The views the tilt settles on when the knob comes near. */
const SETTLES = [0, 55, 84, 90];
const SETTLE_WITHIN = 3;
const HEADING_STEP = 5;

const wrap = (deg) => ((deg % 360) + 360) % 360;
const WINDS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export const windOf = (heading) => WINDS[Math.round(wrap(heading) / 45) % 8];

/** The ring's radius in screen pixels, clear of the frame's corners. */
export const ringRadius = (sideOnScreen) => Math.max(52, sideOnScreen * 0.72 + 14);

/** Degrees clockwise from up of a point seen from `c`. */
export const angleFrom = (c, p) => wrap((Math.atan2(p.x - c.x, -(p.y - c.y)) * 180) / Math.PI);

/** The point at `angle` degrees clockwise from up, `radius` from `c`. */
export const pointAt = (c, radius, angle) => {
  const a = (angle * Math.PI) / 180;
  return { x: c.x + radius * Math.sin(a), y: c.y - radius * Math.cos(a) };
};

/** The heading a turn knob held at `angle` gives, `turn` being the stamp's own turn on the page. */
export function headingAt(angle, turn = 0, free = false) {
  const heading = wrap(angle - turn);
  return free ? Math.round(heading * 10) / 10 : wrap(Math.round(heading / HEADING_STEP) * HEADING_STEP);
}

/**
 * The tilt a knob held at `angle` gives: along the arc, and beyond it the end the
 * pointer went past, the top end owning everything from the left of the ring up.
 */
export function tiltAt(angle, free = false) {
  const a = wrap(angle);
  const along = a > 270 ? 0 : a - ARC_START;
  const tilt = Math.max(0, Math.min(90, along));
  if (free) return Math.round(tilt);
  const settled = SETTLES.find((v) => Math.abs(v - tilt) <= SETTLE_WITHIN);
  return settled ?? Math.round(tilt);
}

/** Where the tilt knob stands on the arc, in degrees clockwise from up. */
export const arcAngle = (tilt) => ARC_START + Math.max(0, Math.min(90, tilt)) * ((ARC_END - ARC_START) / 90);

const readout = (heading, tilt) => `${Math.round(wrap(heading)) % 360}° ${windOf(heading)} · tilt ${Math.round(tilt)}°`;

/**
 * Draws the ring into `group` (the composer's handle layer) round `node`, the
 * stamp's group. `screen` is the stage's zoom, `commit` takes `{ heading, tilt }`.
 */
export function drawModelRing(Konva, { group, node, s, screen = 1, accent = '#e8a33d', edge = '#141414', commit }) {
  if (!node) return null;
  const u = 1 / screen;
  const toLocal = group.getAbsoluteTransform().copy().invert();
  const c = toLocal.point(node.getAbsolutePosition());
  const turn = node.getAbsoluteRotation();
  const side = (s.size ?? 56) * screen;
  const r = ringRadius(side) * u;
  const arc = r + 20 * u;
  const ring = new Konva.Group({ name: 'model-ring' });
  let heading = s.heading ?? 0;
  let tilt = s.tilt ?? 0;

  const line = (points, width, stroke) => new Konva.Line({
    points, stroke, strokeWidth: width * u, lineCap: 'round', lineJoin: 'round', listening: false,
  });
  ring.add(new Konva.Circle({ ...c, radius: r, stroke: 'rgba(0, 0, 0, 0.55)', strokeWidth: 3 * u, listening: false }));
  ring.add(new Konva.Circle({ ...c, radius: r, stroke: '#ffffff', strokeWidth: 1.2 * u, listening: false }));
  const curve = [];
  for (let a = ARC_START; a <= ARC_END; a += 5) {
    const p = pointAt(c, arc, a);
    curve.push(p.x, p.y);
  }
  ring.add(line(curve, 5, 'rgba(0, 0, 0, 0.55)'));
  ring.add(line(curve, 2.4, '#ffffff'));

  const tagAt = pointAt(c, r + 12 * u, 180);
  const tag = new Konva.Label({ x: tagAt.x, y: tagAt.y, listening: false });
  tag.add(new Konva.Tag({ fill: 'rgba(20, 20, 20, 0.85)', cornerRadius: 3 * u }));
  const words = new Konva.Text({
    text: readout(heading, tilt), fontSize: 11 * u, fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    fill: '#e3e3e3', padding: 3 * u,
  });
  tag.add(words);
  const place = () => tag.offsetX(words.width() / 2);
  place();
  ring.add(tag);

  const knob = (at, fill, radius) => new Konva.Circle({
    ...at, radius: radius * u, fill, stroke: edge, strokeWidth: 1.5 * u, draggable: true, name: 'endh',
  });
  const turnKnob = knob(pointAt(c, r, heading + turn), accent, 7.5);
  const tiltKnob = knob(pointAt(c, arc, arcAngle(tilt)), '#ffffff', 6.5);

  const shape = node.findOne?.(`.${MODEL_SHAPE}`);
  const show = () => {
    shape?.setAttrs({ viewHeading: heading, viewTilt: tilt });
    shape?.getLayer()?.batchDraw();
    words.text(readout(heading, tilt));
    place();
    group.getLayer()?.batchDraw();
  };
  const settle = () => commit?.({ heading, tilt });

  turnKnob.on('dragmove', (e) => {
    heading = headingAt(angleFrom(c, turnKnob.position()), turn, !!e.evt?.shiftKey);
    turnKnob.position(pointAt(c, r, heading + turn));
    show();
  });
  turnKnob.on('dragend', settle);
  tiltKnob.on('dragmove', (e) => {
    tilt = tiltAt(angleFrom(c, tiltKnob.position()), !!e.evt?.shiftKey);
    tiltKnob.position(pointAt(c, arc, arcAngle(tilt)));
    show();
  });
  tiltKnob.on('dragend', settle);
  ring.add(turnKnob, tiltKnob);

  // the stamp's own drag and resize carry it away from where the ring was drawn
  node.on?.('dragstart.modelring transformstart.modelring', () => {
    ring.hide();
    group.getLayer()?.batchDraw();
  });
  group.add(ring);
  return ring;
}
