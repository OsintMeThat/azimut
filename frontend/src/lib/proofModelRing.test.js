import { describe, expect, it, vi } from 'vitest';
import { angleFrom, arcAngle, drawModelRing, headingAt, pointAt, ringRadius, tiltAt, windOf } from './proofModelRing.js';
import { MODEL_SHAPE } from './proofModelNode.js';

describe('reading the knobs', () => {
  it('turns a knob position into a heading in 5° steps, free with Shift', () => {
    expect(headingAt(92)).toBe(90);
    expect(headingAt(93)).toBe(95);
    expect(headingAt(93.3, 0, true)).toBe(93.3);
    expect(headingAt(358)).toBe(0);
  });

  it('takes the stamp\'s own turn on the page out of the heading', () => {
    expect(headingAt(120, 30)).toBe(90);
    expect(headingAt(10, 30)).toBe(340);
  });

  it('reads the arc from the top view down to the side, the near end beyond it', () => {
    expect(tiltAt(30)).toBe(0);
    expect(tiltAt(120)).toBe(90);
    expect(tiltAt(75)).toBe(45);
    expect(tiltAt(10)).toBe(0);
    expect(tiltAt(200)).toBe(90);
    expect(tiltAt(350)).toBe(0);
  });

  it('settles the tilt on the offered views, free with Shift', () => {
    expect(tiltAt(30 + 56)).toBe(55);
    expect(tiltAt(30 + 82)).toBe(84);
    expect(tiltAt(30 + 82, true)).toBe(82);
  });

  it('puts the tilt knob back on the arc', () => {
    expect(arcAngle(0)).toBe(30);
    expect(arcAngle(90)).toBe(120);
    expect(tiltAt(arcAngle(40))).toBe(40);
  });

  it('measures angles clockwise from up, and back', () => {
    const c = { x: 10, y: 10 };
    expect(angleFrom(c, { x: 10, y: 0 })).toBeCloseTo(0);
    expect(angleFrom(c, { x: 20, y: 10 })).toBeCloseTo(90);
    const p = pointAt(c, 5, 135);
    expect(angleFrom(c, p)).toBeCloseTo(135);
    expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(5);
  });

  it('names the wind of a heading', () => {
    expect(windOf(0)).toBe('N');
    expect(windOf(46)).toBe('NE');
    expect(windOf(350)).toBe('N');
    expect(windOf(-90)).toBe('W');
  });

  it('keeps the ring clear of the frame\'s corners', () => {
    expect(ringRadius(20)).toBe(52);
    expect(ringRadius(200)).toBeGreaterThan(200 * Math.SQRT1_2);
  });
});

describe('the drawn ring', () => {
  /** Konva's constructors as records, with what the ring asks of its nodes. */
  const node = (kind) => class {
    constructor(config) {
      Object.assign(this, { kind, config, handlers: {}, children: [] });
    }

    on(name, fn) { this.handlers[name] = fn; }

    add(...nodes) { this.children.push(...nodes); }

    position(at) {
      if (at) { this.config.x = at.x; this.config.y = at.y; }
      return { x: this.config.x, y: this.config.y };
    }

    offsetX() {}

    width() { return 40; }

    text(value) { this.config.text = value; }

    hide() { this.hidden = true; }
  };
  const Konva = {
    Group: node('group'), Circle: node('circle'), Line: node('line'), Label: node('label'), Tag: node('tag'), Text: node('text'),
  };

  function setup({ heading = 0, tilt = 0, turn = 0 } = {}) {
    const shape = { setAttrs: vi.fn(), getLayer: () => ({ batchDraw: vi.fn() }) };
    const stamp = {
      getAbsolutePosition: () => ({ x: 100, y: 100 }),
      getAbsoluteRotation: () => turn,
      findOne: (selector) => (selector === `.${MODEL_SHAPE}` ? shape : null),
      on: vi.fn(),
    };
    const group = {
      getAbsoluteTransform: () => ({ copy: () => ({ invert: () => ({ point: (p) => p }) }) }),
      getLayer: () => ({ batchDraw: vi.fn() }),
      add: vi.fn(),
    };
    const commit = vi.fn();
    const s = { size: 56, heading, tilt };
    const ring = drawModelRing(Konva, { group, node: stamp, s, screen: 1, commit });
    const knobs = ring.children.filter((c) => c.config.draggable);
    return { ring, knobs, shape, stamp, group, commit };
  }

  it('stands the turn knob where the nose points, and repaints only the shape while held', () => {
    const { knobs, shape, commit } = setup({ heading: 90 });
    const [turn] = knobs;
    const { x, y } = turn.position();
    expect(x).toBeGreaterThan(100);
    expect(y).toBeCloseTo(100);

    turn.position({ x: 100, y: 200 });
    turn.handlers.dragmove({ evt: {} });
    expect(shape.setAttrs).toHaveBeenLastCalledWith({ viewHeading: 180, viewTilt: 0 });
    expect(commit).not.toHaveBeenCalled();
    turn.handlers.dragend();
    expect(commit).toHaveBeenCalledWith({ heading: 180, tilt: 0 });
  });

  it('counts the stamp\'s own turn on the page', () => {
    const { knobs, commit } = setup({ heading: 0, turn: 90 });
    const [turn] = knobs;
    expect(turn.position().x).toBeGreaterThan(100);
    turn.position({ x: 100, y: 200 });
    turn.handlers.dragmove({ evt: {} });
    turn.handlers.dragend();
    expect(commit).toHaveBeenCalledWith({ heading: 90, tilt: 0 });
  });

  it('holds the tilt knob on the arc and writes the tilt on release', () => {
    const { knobs, commit, shape } = setup({ heading: 45, tilt: 10 });
    const [, tilt] = knobs;
    tilt.position({ x: 300, y: 100 });
    tilt.handlers.dragmove({ evt: { shiftKey: true } });
    expect(shape.setAttrs).toHaveBeenLastCalledWith({ viewHeading: 45, viewTilt: 60 });
    tilt.handlers.dragend();
    expect(commit).toHaveBeenCalledWith({ heading: 45, tilt: 60 });
  });

  it('steps aside while the stamp itself is dragged or resized', () => {
    const { ring, stamp } = setup();
    const [events, hide] = stamp.on.mock.calls[0];
    expect(events).toContain('dragstart');
    expect(events).toContain('transformstart');
    hide();
    expect(ring.hidden).toBe(true);
  });

  it('draws nothing without a stamp on the page', () => {
    expect(drawModelRing(Konva, { group: {}, node: null, s: {} })).toBeNull();
  });
});
