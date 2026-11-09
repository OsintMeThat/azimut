import { describe, expect, it } from 'vitest';
import { surfaceFrame } from './composer.js';
import { pageEntry } from './freeMarks.js';
import { insetSurfaces } from './insetMarks.js';
import { CLIP_TAG, acrossPictures, clipText, makeCopy, pasteShapes, readClip, shownRect } from './proofClipboard.js';

// Two panels side by side on a 1400 × 500 page: a 1280 × 720 frame at half size,
// and a 600 × 600 satellite capture at 2/3.
const frameP = { id: 'f', kind: 'panel', item: { id: 'f', natural: [1280, 720] }, box: { x: 20, y: 20, w: 640, h: 360, scale: 0.5, baseScale: 1, row: 0 }, index: 0 };
const satP = { id: 's', kind: 'panel', item: { id: 's', natural: [600, 600] }, box: { x: 680, y: 20, w: 400, h: 400, scale: 2 / 3, baseScale: 1, row: 0 }, index: 1 };
const page = pageEntry(1400, 500);
const list = [frameP, satP, page];
const frameOfIn = (entries) => (id) => {
  const entry = entries.find((x) => x.id === id);
  return entry ? surfaceFrame(entry) : null;
};
const frameOf = frameOfIn(list);

let counter = 0;
const newId = () => `n${(counter += 1)}`;

const markers = [
  { id: 'm1', panel: 'f', kind: 'number', color: '#ff5252', x: 128, y: 72, size: 36, n: 1 },
  { id: 'm2', panel: 'f', kind: 'number', color: '#ff5252', x: 640, y: 360, size: 36, n: 2 },
  { id: 'm3', panel: 'f', kind: 'number', color: '#ff5252', x: 1152, y: 648, size: 36, n: 3 },
];

describe('a copy', () => {
  it('holds the picked marks and the size of what each of their pictures shows', () => {
    const copy = makeCopy([...markers, { id: 'x', panel: 's', kind: 'rect', x: 0, y: 0, w: 5, h: 5 }], ['m1', 'm3'], { surfaces: list, frameOf, docKey: 1, id: 'c1' });
    expect(copy.shapes.map((s) => s.id)).toEqual(['m1', 'm3']);
    expect(copy.from).toEqual({ f: { kind: 'panel', index: 0, image: [1280, 720], shown: { x: 0, y: 0, w: 1280, h: 720 } } });
    expect(copy).toMatchObject({ azimut: CLIP_TAG, v: 1, id: 'c1', docKey: 1 });
    expect(makeCopy(markers, [], { surfaces: list, frameOf })).toBeNull();
  });

  it('round-trips through the system clipboard\'s text, and refuses anything else', () => {
    const copy = makeCopy(markers, ['m1', 'm2'], { surfaces: list, frameOf, docKey: 1, id: 'c1' });
    expect(readClip(clipText(copy))).toEqual(copy);
    expect(readClip('')).toBeNull();
    expect(readClip('https://example.test')).toBeNull();
    expect(readClip('{"azimut":"proof-shapes","v":2,"shapes":[]}')).toBeNull();
    expect(readClip('{"azimut":"proof-shapes"')).toBeNull();
    expect(readClip(JSON.stringify({ ...copy, shapes: [] }))).toBeNull();
  });

  it('leaves out what it cannot draw', () => {
    const text = JSON.stringify({
      azimut: CLIP_TAG, v: 1, id: 'c', shapes: [
        { id: 'a', panel: 'f', kind: 'rect', x: 1, y: 2, w: 3, h: 4 },
        { id: 'b', panel: 'f', kind: 'script', x: 1, y: 2 },
        { id: 'c', panel: 'f', kind: 'line', points: [0, 0, 'x', 1] },
        { id: 'd', kind: 'rect', x: 1, y: 2 },
      ],
      from: { f: { kind: 'panel', index: 0, image: [10, 10], shown: { x: 0, y: 0, w: 10, h: 0 } } },
    });
    const read = readClip(text);
    expect(read.shapes.map((s) => s.id)).toEqual(['a']);
    expect(read.from).toEqual({});
  });

  // A mark is a live proxy in the composer, and a copy that kept a proxied `points`
  // array once broke copying every kind of line: the copy is plain and detached.
  it('is a plain copy, detached from the marks it was made of', () => {
    const line = { id: 'l', panel: 'f', kind: 'arrow', color: '#fff', points: [0, 0, 5, 5] };
    const copy = makeCopy([line], ['l'], { surfaces: list, frameOf, docKey: 1 });
    line.points[0] = 999;
    line.color = '#000';
    expect(copy.shapes[0]).toEqual({ id: 'l', panel: 'f', kind: 'arrow', color: '#fff', points: [0, 0, 5, 5] });
  });

  it('takes the marks drawn over a picked inset along', () => {
    const zoom = { id: 'z', panel: 'f', kind: 'zoom', color: '#fff', x: 100, y: 100, w: 100, h: 50, iw: 200, dx: 300, dy: 0 };
    const over = { id: 'o', panel: 'z', kind: 'ellipse', color: '#fff', x: 20, y: 20, w: 10, h: 10 };
    const copy = makeCopy([zoom, over, ...markers], ['z'], { surfaces: list, frameOf, docKey: 1 });
    expect(copy.shapes.map((s) => s.id)).toEqual(['z', 'o']);
  });
});

describe('a mark set on another picture', () => {
  it('keeps its place, measured from the picture\'s edges', () => {
    const moved = acrossPictures(markers[0], { shown: { x: 0, y: 0, w: 1280, h: 720 } }, { shown: { x: 0, y: 0, w: 600, h: 600 } });
    expect(moved).toMatchObject({ x: 60, y: 60, n: 1, size: 36 });
  });

  it('keeps a box\'s middle in place and grows it with the picture', () => {
    const box = { kind: 'rect', x: 100, y: 100, w: 200, h: 100 };
    const moved = acrossPictures(box, { shown: { x: 0, y: 0, w: 1000, h: 1000 } }, { shown: { x: 0, y: 0, w: 500, h: 500 } });
    expect(moved).toEqual({ kind: 'rect', x: 50, y: 50, w: 100, h: 50 });
  });

  it('carries every vertex of a line about its middle', () => {
    const line = { kind: 'line', points: [0, 0, 100, 100] };
    const moved = acrossPictures(line, { shown: { x: 0, y: 0, w: 200, h: 200 } }, { shown: { x: 0, y: 0, w: 400, h: 400 } });
    expect(moved.points).toEqual([0, 0, 200, 200]);
  });

  it('reads a cut picture by what its cut shows', () => {
    expect(shownRect({ image: [100, 50], outline: null })).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(shownRect({ image: [100, 50], outline: [{ x: 10, y: 5 }, { x: 90, y: 0 }, { x: 95, y: 45 }, { x: 5, y: 50 }] }))
      .toEqual({ x: 5, y: 0, w: 90, h: 50 });
  });
});

describe('a paste', () => {
  const copy = makeCopy(markers, ['m1', 'm2', 'm3'], { surfaces: list, frameOf, docKey: 1, id: 'c' });

  it('in the same proof lands stepped down and right of what it copies, one step more each time', () => {
    const runs = new Map();
    const first = pasteShapes(copy, { surfaces: list, frameOf, docKey: 1, runs, newId });
    expect(first.map((s) => [s.panel, s.n])).toEqual([['f', 1], ['f', 2], ['f', 3]]);
    // 26 page pixels is 52 of the frame's, at half size
    expect(first[0]).toMatchObject({ x: 128 + 52, y: 72 + 52 });
    expect(new Set(first.map((s) => s.id)).size).toBe(3);
    expect(first.some((s) => markers.some((m) => m.id === s.id))).toBe(false);
    const second = pasteShapes(copy, { surfaces: list, frameOf, docKey: 1, runs, newId });
    expect(second[0]).toMatchObject({ x: 128 + 104, y: 72 + 104 });
  });

  it('onto another picture lands at the same places, numbers kept, then steps on', () => {
    const runs = new Map();
    const onSat = pasteShapes(copy, { surfaces: list, frameOf, docKey: 1, runs, newId, target: 's' });
    expect(onSat.map((s) => [s.panel, s.n, s.x, s.y])).toEqual([['s', 1, 60, 60], ['s', 2, 300, 300], ['s', 3, 540, 540]]);
    // ink is on the page, so a marker keeps its size
    expect(onSat[0].size).toBe(36);
    const again = pasteShapes(copy, { surfaces: list, frameOf, docKey: 1, runs, newId, target: 's' });
    expect(again[0]).toMatchObject({ x: 60 + 39, y: 60 + 39 });
  });

  it('into another proof lands on the picture in the same place, else on the first', () => {
    const other = [
      { ...frameP, id: 'g', item: { ...frameP.item, id: 'g' } },
      { ...satP, id: 't', item: { ...satP.item, id: 't' } },
      page,
    ];
    const satCopy = makeCopy([{ id: 'q', panel: 's', kind: 'rect', x: 0, y: 0, w: 60, h: 60 }], ['q'], { surfaces: list, frameOf, docKey: 1 });
    const [onT] = pasteShapes(satCopy, { surfaces: other, frameOf: frameOfIn(other), docKey: 2, runs: new Map(), newId });
    expect(onT).toMatchObject({ panel: 't', x: 0, y: 0, w: 60, h: 60 });
    const alone = [other[0], page];
    const [onG] = pasteShapes(satCopy, { surfaces: alone, frameOf: frameOfIn(alone), docKey: 2, runs: new Map(), newId });
    expect(onG.panel).toBe('g');
    const numbers = pasteShapes(copy, { surfaces: other, frameOf: frameOfIn(other), docKey: 2, runs: new Map(), newId });
    // the first paste there covers nothing, so it is not stepped
    expect(numbers.map((s) => [s.panel, s.n, s.x, s.y])).toEqual([['g', 1, 128, 72], ['g', 2, 640, 360], ['g', 3, 1152, 648]]);
  });

  it('keeps a free mark free, stepped in the same proof', () => {
    const free = makeCopy([{ id: 'p', panel: 'page', kind: 'text', x: 10, y: 10, text: 'Here' }], ['p'], { surfaces: list, frameOf, docKey: 1 });
    const [same] = pasteShapes(free, { surfaces: list, frameOf, docKey: 1, runs: new Map(), newId, target: 's' });
    expect(same).toMatchObject({ panel: 'page', x: 36, y: 36 });
    const [there] = pasteShapes(free, { surfaces: list, frameOf, docKey: 2, runs: new Map(), newId });
    expect(there).toMatchObject({ panel: 'page', x: 10, y: 10 });
  });

  it('keeps a line holding to two pictures while both are there, and frees it otherwise', () => {
    const link = { id: 'k', panel: 'page', kind: 'arrow', points: [0, 0, 0, 0], ends: [{ panel: 'f', x: 640, y: 360 }, { panel: 's', x: 300, y: 300 }] };
    const linked = makeCopy([link], ['k'], { surfaces: list, frameOf, docKey: 1 });
    // copied where the page shows its ends
    expect(linked.shapes[0].points).toEqual([340, 200, 880, 220]);
    const [held] = pasteShapes(linked, { surfaces: list, frameOf, docKey: 1, runs: new Map(), newId });
    expect(held.ends.map((tie) => tie.panel)).toEqual(['f', 's']);
    expect(held.ends[0]).toMatchObject({ x: 640 + 52, y: 360 + 52 });
    const lone = [frameP, page];
    const [freed] = pasteShapes(linked, { surfaces: lone, frameOf: frameOfIn(lone), docKey: 1, runs: new Map(), newId });
    expect(freed.ends).toBeUndefined();
    expect(freed).toMatchObject({ panel: 'page', points: [366, 226, 906, 246] });
  });

  it('carries the marks over a copied inset on its copy, and keeps picture marks off insets', () => {
    const zoom = { id: 'z', panel: 'f', kind: 'zoom', color: '#fff', x: 100, y: 100, w: 100, h: 50, iw: 200, dx: 300, dy: 0 };
    const over = { id: 'o', panel: 'z', kind: 'ellipse', color: '#fff', x: 20, y: 20, w: 10, h: 10 };
    const blur = { id: 'b', panel: 'f', kind: 'blur', x: 0, y: 0, w: 40, h: 40 };
    const shapes = [zoom, over, blur];
    const withInsets = [...insetSurfaces(shapes, frameOf, 1400, 500), ...list];
    const copied = makeCopy(shapes, ['z', 'b'], { surfaces: withInsets, frameOf: frameOfIn(withInsets), docKey: 1 });
    const pasted = pasteShapes(copied, { surfaces: withInsets, frameOf: frameOfIn(withInsets), docKey: 1, runs: new Map(), newId, target: 'z' });
    const [z2, o2, b2] = pasted;
    expect(o2).toMatchObject({ panel: z2.id, x: 20, y: 20 });
    // the blur stays on its picture, stepped, rather than going on the inset
    expect(b2).toMatchObject({ panel: 'f', x: 52, y: 52 });
  });

  it('adds nothing when nothing in the proof can take it', () => {
    const lonely = makeCopy(markers, ['m1'], { surfaces: list, frameOf, docKey: 1 });
    expect(pasteShapes(lonely, { surfaces: [page], frameOf: frameOfIn([page]), docKey: 2, runs: new Map(), newId })).toEqual([]);
    expect(pasteShapes(null, { surfaces: list, frameOf, newId })).toEqual([]);
  });
});
