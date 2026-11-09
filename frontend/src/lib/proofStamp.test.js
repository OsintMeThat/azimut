import { describe, expect, it, vi } from 'vitest';
import { MODEL_VIEWS } from './icons/modelMeta.js';
import { setStampView } from './icons/stampView.svelte.js';
import { STAMP_CUT, STAMP_HALO } from './proofIcons.js';
import { loadModels } from './icons/loadModels.svelte.js';
import { createModelCache, modelHalo, modelLine, modelNode, modelPaint, pickedModelView } from './proofModelNode.js';
import { glyphOps, paintGlyph, stampNodes } from './proofStamp.js';

/** Konva's constructors as records of what they were asked to draw. */
const node = (kind) => class {
  constructor(config) { Object.assign(this, { kind, ...config }); }
};
const Konva = { Circle: node('circle'), Path: node('path'), Shape: node('shape'), Group: node('group') };

const box = (size, scale = 1) => ({ size: size / scale, scale, origin: { x: -size / scale / 2, y: -size / scale / 2 } });

describe('a stamp over imagery', () => {
  it('wears a halo, then its silhouette, then its carved details in a dark shade', () => {
    const nodes = stampNodes(Konva, { name: 'truck', color: '#ff5252', size: 56, strokeWidth: 4 }, box(56));
    expect(nodes.map((n) => n.kind)).toEqual(['path', 'path', 'path']);
    const [halo, body, cut] = nodes;
    expect(halo.fill).toBe(STAMP_HALO);
    expect(halo.strokeWidth).toBeGreaterThan(body.strokeWidth);
    expect(body.fill).toBe('#ff5252');
    expect(body.fillRule).toBe('evenodd');
    expect(cut.fill).toBe(STAMP_CUT);
    expect(nodes.every((n) => n.listening === false)).toBe(true);
  });

  it('reads the stroke width as weight on the eight stamps that used to be strokes', () => {
    const at = (strokeWidth) => stampNodes(Konva, { name: 'person', color: '#ff5252', size: 56, strokeWidth }, box(56))[1].strokeWidth;
    expect(at(10)).toBeGreaterThan(at(4));
    expect(at(4)).toBeGreaterThan(at(1));
    expect(at(undefined)).toBe(at(4));
  });

  it('gives a solid one no weight, whatever its stroke says', () => {
    const [, body] = stampNodes(Konva, { name: 'impact', color: '#ff5252', size: 56, strokeWidth: 12 }, box(56));
    expect(body.stroke).toBeUndefined();
  });

  it('keeps the halo visible on a small stamp', () => {
    const halo = (size) => stampNodes(Konva, { name: 'point', color: '#ff5252', size }, box(size))[0].strokeWidth;
    expect(halo(20)).toBeGreaterThan(halo(56));
    expect(halo(56)).toBeCloseTo(halo(120));
  });

  it('scales the drawing into its box, so a turn or a resize never deforms it', () => {
    const [, body] = stampNodes(Konva, { name: 'tank', color: '#ff5252', size: 96 }, box(96, 2));
    expect(body.scaleX).toBeCloseTo(48 / 24);
    expect(body.scaleY).toBe(body.scaleX);
    expect(body.x).toBeCloseTo(-24);
  });
});

describe('a stamp on its disc', () => {
  it('draws the disc, ringed, then the symbol in the disc\'s ink with its details as holes', () => {
    const nodes = stampNodes(Konva, { name: 'camera', color: '#ff5252', size: 56, fillOpacity: 1 }, box(56));
    expect(nodes.map((n) => n.kind)).toEqual(['circle', 'circle', 'path']);
    expect(nodes[1].fill).toBe('rgba(255, 82, 82, 1)');
    expect(nodes[1].stroke).toBe('#ff5252');
    expect(nodes[2].fill).toBe('#ffffff');
    expect(nodes.some((n) => n.fill === STAMP_HALO)).toBe(false);
  });

  it('keeps the symbol coloured and haloed over a disc too sheer to carry white', () => {
    const nodes = stampNodes(Konva, { name: 'camera', color: '#69f0ae', size: 56, fillOpacity: 0.3 }, box(56));
    expect(nodes.find((n) => n.kind === 'path').fill).toBe(STAMP_HALO);
    expect(nodes.filter((n) => n.kind === 'path')[1].fill).toBe('#69f0ae');
  });
});

it('draws nothing for a name this build does not know', () => {
  expect(stampNodes(Konva, { name: 'battleship', color: '#ff5252' }, box(56))).toEqual([]);
});

describe('a stamp on its disc, sized', () => {
  it('draws a symbol smaller than the disc, about its middle, so its corners stay inside', () => {
    const [, , body] = stampNodes(Konva, { name: 'truck', color: '#ff5252', size: 96, fillOpacity: 1 }, box(96));
    expect(body.scaleX).toBeCloseTo((96 * 0.76) / 24);
    expect(body.x + 12 * body.scaleX).toBeCloseTo(0);
    expect(body.y + 12 * body.scaleX).toBeCloseTo(0);
  });

  it('leaves the pin its whole box, so its tip stays on the point', () => {
    const size = 96;
    const origin = { x: -48, y: (-22.4 / 24) * size };
    const [, , body] = stampNodes(Konva, { name: 'point', color: '#ff5252', size, fillOpacity: 1 }, { size, origin });
    expect(body.scaleX).toBeCloseTo(4);
    expect(body.x).toBeCloseTo(origin.x);
    expect(body.y).toBeCloseTo(origin.y);
  });
});

describe('a layer glyph on a proof', () => {
  it('takes the colour over a dark halo when free, its cuts in the stamp\'s dark shade', () => {
    const ops = glyphOps('badge-flame', { color: '#ff5252', size: 56 });
    expect(ops[0].fill).toBe(STAMP_HALO);
    expect(ops[0].width).toBeGreaterThan(1);
    // one halo per painted layer, then the layers in order
    expect(ops.slice(1).map((op) => op.fill)).toEqual(['#ff5252', STAMP_CUT]);
  });

  it('is the map badge on a solid disc: the disc\'s ink, its cuts in the disc\'s colour', () => {
    const ops = glyphOps('badge-flame', { color: '#ff5252', disc: 1 });
    expect(ops.map((op) => op.fill)).toEqual(['#ffffff', '#ff5252']);
    expect(ops.some((op) => op.fill === STAMP_HALO)).toBe(false);
  });

  it('keeps a stroked layer a stroke, with the width and turn its layer gives', () => {
    const clash = glyphOps('badge-clash', { color: '#ff5252', disc: 1 });
    expect(clash[0].rotate).toBe(45);
    const antenna = glyphOps('badge-telecom-antenna', { color: '#40c4ff', size: 56 });
    expect(antenna.filter((op) => op.stroke === '#40c4ff')[0].width).toBe(1.9);
    expect(antenna.find((op) => op.stroke === STAMP_HALO && !op.fill).width).toBeGreaterThan(1.9);
  });

  it('draws through one shape in its box, at the box\'s scale', () => {
    const [shape] = stampNodes(Konva, { name: 'badge-flame', color: '#ff5252', size: 48 }, box(48));
    expect(shape.kind).toBe('shape');
    expect(shape.x).toBeCloseTo(-24);
    expect(shape.listening).toBe(false);
    expect(typeof shape.sceneFunc).toBe('function');
  });

  it('turns a layer about the box\'s middle as it paints', () => {
    vi.stubGlobal('Path2D', class { constructor(d) { this.d = d; } });
    const calls = [];
    const ctx = new Proxy({}, {
      get: (target, key) => (key in target ? target[key] : (...args) => calls.push([key, ...args])),
      set: (target, key, value) => { target[key] = value; return true; },
    });
    paintGlyph(ctx, [{ d: 'M0 0L1 1Z', fill: '#ff0000', rotate: 90 }, { d: 'M0 0L1 0', stroke: '#00ff00', width: 2 }]);
    expect(calls.map(([k]) => k)).toEqual(['save', 'translate', 'rotate', 'translate', 'fill', 'restore', 'save', 'stroke', 'restore']);
    vi.unstubAllGlobals();
  });
});

describe('a vehicle model on a proof', () => {
  it('is given the picker\'s view where the tool makes it, and only a model is', () => {
    setStampView('angled');
    const angled = MODEL_VIEWS.find((v) => v.id === 'angled');
    expect(pickedModelView('model-tank')).toEqual({ heading: angled.heading, tilt: angled.tilt });
    expect(pickedModelView('tank')).toEqual({});
    expect(pickedModelView('point')).toEqual({});
    setStampView('top');
    expect(pickedModelView('model-tank')).toEqual({ heading: 0, tilt: 0 });
  });

  it('draws a stamp saved without a view from above, nose up, whatever the picker holds', () => {
    setStampView('side');
    const old = { kind: 'icon', name: 'model-tank', color: '#ff5252', size: 56 };
    const [shape] = stampNodes(Konva, old, box(56));
    // drawing writes nothing on the stamp
    expect('tilt' in old).toBe(false);
    expect('heading' in old).toBe(false);
    expect(shape.viewHeading).toBe(0);
    expect(shape.viewTilt).toBe(0);
    setStampView('top');
  });

  it('leaves a model stamp that has a view as it is', () => {
    setStampView('side');
    const saved = { kind: 'icon', name: 'model-tank', color: '#ff5252', size: 56, heading: 12, tilt: 0 };
    const [shape] = stampNodes(Konva, saved, box(56));
    expect(saved.tilt).toBe(0);
    expect(shape.viewHeading).toBe(12);
    expect(shape.viewTilt).toBe(0);
    setStampView('top');
  });

  it('centres one shape on the box, and lets nothing press through it', () => {
    const [shape] = stampNodes(Konva, { kind: 'icon', name: 'model-car', color: '#ff5252', size: 40, heading: 0, tilt: 0 }, { size: 40, origin: { x: -20, y: -20 } });
    expect(shape.kind).toBe('shape');
    expect(shape.x).toBe(0);
    expect(shape.y).toBe(0);
    expect(shape.listening).toBe(false);
  });

  it('is the model\'s length across the box, free and haloed, or smaller in white on a disc', () => {
    const s = { name: 'model-car', color: '#ff5252', size: 100, heading: 30, tilt: 55 };
    const free = modelPaint(s, { size: 50, scale: 2 });
    expect(free).toMatchObject({ px: 50, fit: 'length', heading: 30, tilt: 55, mode: 'tone', colour: '#ff5252' });
    expect(free.line).toBeCloseTo(modelLine(100) / 2);
    expect(free.halo).toBeCloseTo(modelHalo(100) / 2);

    const badge = modelPaint(s, { size: 50, scale: 2, disc: 1 });
    expect(badge).toMatchObject({ mode: 'ink', disc: '#ff5252', paper: '#ffffff', halo: 0 });
    expect(badge.px).toBeLessThan(50);

    expect(modelPaint(s, { size: 50, disc: 0.2 })).toMatchObject({ mode: 'tone', px: 40 });
  });

  it('keeps its outline and halo in step with its size, within sane bounds', () => {
    expect(modelLine(10)).toBeCloseTo(0.35);
    expect(modelLine(1000)).toBe(3);
    expect(modelHalo(56)).toBeGreaterThan(1);
    expect(modelHalo(1000)).toBe(6);
  });

  it('asks for the models it has not got, and repaints when they land', async () => {
    const [shape] = stampNodes(Konva, { kind: 'icon', name: 'model-car', color: '#ff5252', size: 40, heading: 0, tilt: 0 }, box(40));
    const batchDraw = vi.fn();
    const target = { getLayer: () => ({ batchDraw }), getAttr: () => 0 };
    const fill = vi.fn();
    const native = new Proxy({ fill }, {
      get: (t, key) => (key in t ? t[key] : () => {}),
      set: (t, key, value) => { t[key] = value; return true; },
    });
    shape.sceneFunc({ _context: native }, target);
    await vi.waitFor(() => expect(batchDraw).toHaveBeenCalled());
    shape.sceneFunc({ _context: native }, target);
    expect(fill).toHaveBeenCalled();
  });
});

describe('a vehicle model kept as a picture', () => {
  const upright = (a = 2) => ({ a, b: 0, c: 0, d: a, e: 10.3, f: 20.6 });
  const turnedBy = (deg, a = 2) => {
    const r = (deg * Math.PI) / 180;
    return { a: a * Math.cos(r), b: a * Math.sin(r), c: -a * Math.sin(r), d: a * Math.cos(r), e: 5, f: 5 };
  };
  const screen = (transform) => {
    const calls = [];
    return {
      calls,
      getTransform: () => transform,
      save: () => calls.push(['save']),
      restore: () => calls.push(['restore']),
      setTransform: (...args) => calls.push(['setTransform', ...args]),
      drawImage: (...args) => calls.push(['drawImage', ...args]),
    };
  };
  const engine = (box = [-30, -12, 30, 12]) => ({ drawModel: vi.fn(), drawnBox: vi.fn(() => box) });
  const makeCanvas = (width, height) => ({ width, height, getContext: () => ({ setTransform: vi.fn() }) });
  const model = { id: 'model-car' };
  const paintOf = (extra = {}) => modelPaint({ name: 'model-car', color: '#ff5252', size: 56, heading: 30, tilt: 55, ...extra }, { size: 56 });

  it('paints a model once, then lays its picture down', () => {
    const cache = createModelCache({ makeCanvas });
    const painter = engine();
    for (let i = 0; i < 5; i += 1) expect(cache.draw(screen(upright()), painter, model, paintOf())).toBe(true);
    expect(painter.drawModel).toHaveBeenCalledTimes(1);
    expect(cache.size()).toBe(1);
  });

  it('paints it again for another view, colour, ink or size on screen', () => {
    const cache = createModelCache({ makeCanvas });
    const painter = engine();
    cache.draw(screen(upright()), painter, model, paintOf());
    cache.draw(screen(upright()), painter, model, paintOf({ heading: 31 }));
    cache.draw(screen(upright()), painter, model, paintOf({ tilt: 0 }));
    cache.draw(screen(upright()), painter, model, paintOf({ color: '#40c4ff' }));
    cache.draw(screen(upright()), painter, model, paintOf({ size: 80 }));
    cache.draw(screen(upright(3)), painter, model, paintOf());
    expect(painter.drawModel).toHaveBeenCalledTimes(6);
    // a stage moved, not zoomed, lays the same picture down
    cache.draw(screen({ ...upright(), e: 400 }), painter, model, paintOf());
    expect(painter.drawModel).toHaveBeenCalledTimes(6);
  });

  it('lays it down pixel for pixel upright, and resampled when turned', () => {
    const cache = createModelCache({ makeCanvas });
    const painter = engine();
    const flat = screen(upright());
    cache.draw(flat, painter, model, paintOf());
    const laid = flat.calls.find(([name]) => name === 'drawImage');
    expect(laid).toHaveLength(4);
    expect(Number.isInteger(laid[2]) && Number.isInteger(laid[3])).toBe(true);
    expect(flat.calls[0]).toEqual(['save']);
    const turned = screen(turnedBy(30));
    cache.draw(turned, painter, model, paintOf());
    expect(turned.calls.find(([name]) => name === 'drawImage')).toHaveLength(6);
  });

  it('keeps no more than its cap or its pixels, the oldest going first', () => {
    const cache = createModelCache({ makeCanvas, cap: 3 });
    const painter = engine();
    for (let h = 0; h < 5; h += 1) cache.draw(screen(upright()), painter, model, paintOf({ heading: h }));
    expect(cache.size()).toBe(3);
    cache.draw(screen(upright()), painter, model, paintOf({ heading: 0 }));
    expect(painter.drawModel).toHaveBeenCalledTimes(6);
    const tight = createModelCache({ makeCanvas, budget: 20_000 });
    for (let h = 0; h < 5; h += 1) tight.draw(screen(upright()), painter, model, paintOf({ heading: h }));
    expect(tight.pixels()).toBeLessThanOrEqual(20_000);
  });

  it('paints one too big to keep every time, and leaves a context it cannot read to the painter', () => {
    const cache = createModelCache({ makeCanvas, largest: 100 });
    expect(cache.draw(screen(upright()), engine(), model, paintOf())).toBe(false);
    expect(cache.size()).toBe(0);
    expect(createModelCache({ makeCanvas }).draw({}, engine(), model, paintOf())).toBe(false);
  });

  it('draws an export as before, never from the pictures kept', async () => {
    await loadModels();
    const cache = { draw: vi.fn(() => true) };
    const shape = modelNode(Konva, { name: 'model-car', color: '#ff5252', size: 40, heading: 0, tilt: 0 }, { ...box(40), cache });
    const fill = vi.fn();
    const native = new Proxy({ fill }, {
      get: (t, key) => (key in t ? t[key] : () => {}),
      set: (t, key, value) => { t[key] = value; return true; },
    });
    const layerContext = { _context: native };
    const on = (context) => ({ getAttr: () => 0, getLayer: () => ({ getCanvas: () => ({ getContext: () => context }) }) });
    shape.sceneFunc(layerContext, on(layerContext));
    expect(cache.draw).toHaveBeenCalledTimes(1);
    expect(fill).not.toHaveBeenCalled();
    shape.sceneFunc({ _context: native }, on(layerContext));
    expect(cache.draw).toHaveBeenCalledTimes(1);
    expect(fill).toHaveBeenCalled();
  });
});
