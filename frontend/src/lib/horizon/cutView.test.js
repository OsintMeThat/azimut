/** The terrain laid piece by piece, as the search read a cut collage. */
import { describe, expect, it } from 'vitest';
import { composePieces, easeText, pieceLayers, pieceVariants, searchedPair, seamsAcross } from './cutView.js';
import { pieceOf } from './traceMarks.js';

/** Pieces cut straight down the frame at these shares of its width. */
const straight = (cuts) => ({ u }) => pieceOf(cuts, u);
/** Pieces cut on a slant, as a rolled photo shows its cuts: the cut moves right by `lean` of the width from top to bottom. */
const slanted = (cuts, lean) => ({ u, v }) => pieceOf(cuts, u - lean * v);

function fakeCanvas() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  const context = {
    calls,
    drawImage: record('drawImage'),
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    closePath: record('closePath'),
    clip: record('clip'),
  };
  return { width: 0, height: 0, context, getContext: () => context };
}

describe('the seams between the pieces', () => {
  it('follows each cut down the frame, left to right, top to bottom', () => {
    const seams = seamsAcross(1000, 400, 3, straight([0.7, 0.3]));
    expect(seams).toHaveLength(2);
    for (const [seam, x] of [[seams[0], 300], [seams[1], 700]]) {
      expect(seam[0].y).toBe(0);
      expect(seam[seam.length - 1].y).toBe(400);
      for (const p of seam) expect(p.x).toBeCloseTo(x, 2);
    }
  });

  it('bends with a cut that crosses the frame on a slant', () => {
    const [seam] = seamsAcross(1000, 400, 2, slanted([0.5], 0.1));
    expect(seam[0].x).toBeCloseTo(500, 2);
    expect(seam[seam.length - 1].x).toBeCloseTo(600, 2);
    const middle = seam.find((p) => p.y === 200);
    expect(middle.x).toBeCloseTo(550, 2);
  });

  it('keeps a seam to the frame where a cut leaves it', () => {
    const [seam] = seamsAcross(1000, 400, 2, slanted([0.95], 0.2));
    expect(seam[0].x).toBeCloseTo(950, 2);
    expect(seam[seam.length - 1].x).toBe(1000);
  });

  it('has nothing to say of a whole photo or an empty frame', () => {
    expect(seamsAcross(1000, 400, 1, straight([]))).toEqual([]);
    expect(seamsAcross(0, 400, 2, straight([0.5]))).toEqual([]);
    expect(seamsAcross(1000, 400, 2, null)).toEqual([]);
  });
});

describe('what each piece writes over the terrain', () => {
  const size = { width: 1000, height: 400 };
  const pieceAt = straight([0.5]);
  const label = (name, centre, baseline = 100) => ({ name, x: centre, y: baseline + 20, left: centre - 30, width: 60, baseline });

  it('keeps the names and ticks each piece placed where that piece lies, the ticks in order', () => {
    const views = [
      { layers: { labels: [label('Left peak', 200), label('Seen past the cut', 700)], ticks: [{ x: 100, label: '210°' }, { x: 640, label: '230°' }] } },
      { layers: { labels: [label('Right peak', 800), label('Seen before the cut', 300)], ticks: [{ x: 820, label: '240°' }, { x: 560, label: '230°' }] } },
    ];
    const layers = pieceLayers(views, pieceAt, size, { trace: [[{ x: 1, y: 2 }]] });
    expect(layers.labels.map((l) => l.name)).toEqual(['Left peak', 'Right peak']);
    expect(layers.ticks.map((t) => t.x)).toEqual([100, 560, 820]);
    expect(layers.trace).toEqual([[{ x: 1, y: 2 }]]);
  });

  it('keeps one of two names or ticks that meet at a seam', () => {
    const views = [
      { layers: { labels: [label('West top', 480)], ticks: [{ x: 495, label: '230°' }] } },
      { layers: { labels: [label('West top again', 520, 108)], ticks: [{ x: 510, label: '230°' }] } },
    ];
    const layers = pieceLayers(views, pieceAt, size);
    expect(layers.labels.map((l) => l.name)).toEqual(['West top']);
    expect(layers.ticks).toHaveLength(1);
  });

  it('marks the point where the piece it falls in shows it', () => {
    const views = [
      { layers: { target: { x: 700, y: 50, visible: true } } },
      { layers: { target: { x: 720, y: 52, visible: true } } },
    ];
    expect(pieceLayers(views, pieceAt, size).target).toEqual({ x: 720, y: 52, visible: true });
  });
});

describe('the pieces laid as one', () => {
  const frame = (name) => ({ name, width: 2000, height: 800 });

  it('lays the first piece whole, then each next one right of its seam, at the drawn scale', () => {
    const frames = [frame('a'), frame('b'), frame('c')];
    const seams = [
      [{ x: 300, y: 0 }, { x: 300, y: 400 }],
      [{ x: 700, y: 0 }, { x: 720, y: 400 }],
    ];
    const out = composePieces(frames, seams, { scale: 2, makeCanvas: fakeCanvas });
    expect([out.width, out.height]).toEqual([2000, 800]);
    const calls = out.context.calls;
    expect(calls.filter(([name]) => name === 'drawImage').map(([, image]) => image.name)).toEqual(['a', 'b', 'c']);
    expect(calls.filter(([name]) => name === 'clip')).toHaveLength(2);
    // the second seam, scaled, closed round the frame's right side
    const last = calls.slice(calls.findLastIndex(([name]) => name === 'beginPath'));
    expect(last.slice(1, 5)).toEqual([
      ['moveTo', 1400, 0],
      ['lineTo', 1440, 800],
      ['lineTo', 2001, 800],
      ['lineTo', 2001, 0],
    ]);
  });

  it('asks for the pictures first', () => {
    expect(() => composePieces([], [], { makeCanvas: fakeCanvas })).toThrow(/drawn/);
  });
});

describe('the pair drawn as the search read the collage', () => {
  const CAMERA = { heading: 90, tilt: 0, roll: 0, fov: 60, projection: 'camera', width: 1000, height: 400 };
  const PIECES = [{ piece: 1, turn: 1.5, tilt: -0.2, roll: 0.4 }];

  it('draws the terrain alone through each piece’s camera, the pieces the search left as the whole', () => {
    const variants = pieceVariants(3, PIECES);
    expect(variants.map(({ photo }) => photo)).toEqual([0, 0, 0]);
    const cameras = variants.map(({ through }) => through(CAMERA));
    expect(cameras[0]).toBe(CAMERA);
    expect(cameras[1]).toMatchObject({ heading: 91.5, tilt: -0.2, roll: 0.4, width: 1000 });
    expect(cameras[2]).toBe(CAMERA);
  });

  it('lays the pieces as one beside the photo and the whole terrain, and lets their pictures go', () => {
    const frame = (name) => ({ name, width: 2000, height: 800 });
    const parts = [frame('piece 1'), frame('piece 2')];
    const turnedCamera = { ...CAMERA, heading: 91.5 };
    const drawn = {
      frames: [frame('photo'), frame('terrain'), ...parts],
      turned: [null, null, { camera: CAMERA, layers: { ticks: [{ x: 100, label: '70°' }] } }, { camera: turnedCamera, layers: { ticks: [{ x: 900, label: '110°' }] } }],
      camera: CAMERA,
      scale: 2,
      layers: { trace: [[{ x: 5, y: 6 }]], ticks: [] },
    };
    const pair = searchedPair(drawn, { count: 2, pieces: PIECES, pieceAt: straight([0.5]), makeCanvas: fakeCanvas });
    expect(pair.frames.map((f) => f.name)).toEqual(['photo', 'terrain']);
    expect(pair.searched.frame.context.calls.filter(([name]) => name === 'drawImage').map(([, image]) => image.name)).toEqual(['piece 1', 'piece 2']);
    expect(pair.searched.seams).toHaveLength(1);
    expect(pair.searched.seams[0][0].x).toBeCloseTo(500, 2);
    expect(pair.searched.layers.ticks.map((t) => t.label)).toEqual(['70°', '110°']);
    expect(pair.searched.layers.trace).toEqual([[{ x: 5, y: 6 }]]);
    expect(pair.searched.cameras).toEqual([CAMERA, turnedCamera]);
    expect(pair.searched.eases).toEqual([null, PIECES[0]]);
    expect(parts.map((part) => part.width)).toEqual([0, 0]);
  });
});

describe('a piece said in a line', () => {
  it('says each ease signed, to a tenth of a degree', () => {
    expect(easeText({ turn: 0.62, tilt: -0.3, roll: 0 })).toBe('turned +0.6°, tilted −0.3°, rolled +0.0°');
    expect(easeText(null)).toBe('as the whole');
  });
});
