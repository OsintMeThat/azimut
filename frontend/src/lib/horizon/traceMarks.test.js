/** The marks beside a traced skyline: inner edges, pairs in front and behind, a collage's cuts. */
import { describe, expect, it } from 'vitest';
import {
  addCut,
  cleanBands,
  cleanMarks,
  clearBadges,
  cutAt,
  DISTANCE_BANDS,
  farBadges,
  farLabel,
  farOf,
  farRange,
  innerByShape,
  lineAt,
  liesUnder,
  marksAfter,
  marksSaid,
  NO_MARKS,
  nextLine,
  pairBadges,
  pairLabel,
  pieceOf,
  removeCut,
  sameCuts,
  sameMarks,
  setFar,
  setInner,
  setSea,
  skySamples,
  toggleClear,
  toggleKey,
  keyBadges,
  KEYS_MAX,
  togglePair,
} from './traceMarks.js';

const line = (v, from = 0, to = 1, count = 11) => Array.from({ length: count }, (_, i) => ({ u: from + ((to - from) * i) / (count - 1), v }));

describe('marks made whole', () => {
  it('gives each stroke an id and keeps only what names strokes there are', () => {
    expect(cleanMarks(null, 3)).toEqual({ lines: [0, 1, 2], inner: [], pairs: [], cuts: [], far: [], sea: [], clear: [], key: [] });
    const kept = cleanMarks(
      {
        lines: [4, 7],
        inner: [7, 9],
        pairs: [[7, 4], [7, 4], [4, 4], [4, 9]],
        cuts: [0.7, 0.3, 1.2, 0.005],
        far: [{ line: 4, bands: ['b3', 'b1', 'x'] }, { line: 4, bands: ['near'] }, { line: 9, bands: ['b1'] }, { line: 7, bands: [] }],
        sea: [4, 4, 7, 9],
        clear: [9, 7, 4],
        key: [7, 4, 9],
      },
      2
    );
    // a sea line is skyline, and so are a line with only sky above and a key line: an inner edge can be none
    expect(kept).toEqual({ lines: [4, 7], inner: [7], pairs: [[7, 4]], cuts: [0.3, 0.7], far: [{ line: 4, bands: ['b1', 'b3'] }], sea: [4], clear: [4], key: [4] });
    // ids that do not match the strokes start again in order
    expect(cleanMarks({ lines: [1], inner: [1] }, 2).lines).toEqual([0, 1]);
  });

  it('says when they hold anything worth keeping, and compares them', () => {
    expect(marksSaid(cleanMarks(null, 3))).toBe(false);
    expect(marksSaid({ ...NO_MARKS, cuts: [0.5] })).toBe(true);
    const a = cleanMarks({ inner: [1], pairs: [[1, 0]] }, 2);
    expect(sameMarks(a, cleanMarks({ inner: [1], pairs: [[1, 0]] }, 2))).toBe(true);
    expect(sameMarks(a, cleanMarks({ inner: [1], pairs: [[0, 1]] }, 2))).toBe(false);
    expect(sameCuts([0.3, 0.7], [0.3, 0.7])).toBe(true);
    expect(sameCuts([0.3], [0.3, 0.7])).toBe(false);
    expect(sameCuts(null, [])).toBe(true);
    expect(nextLine([0, 5, 2])).toBe(6);
    expect(nextLine([])).toBe(0);
  });
});

describe('inner edges', () => {
  it('reads a stroke under another one as an inner edge', () => {
    const sky = line(0.3);
    const lower = line(0.4, 0.2, 0.6);
    expect(liesUnder(lower, [sky])).toBe(true);
    expect(liesUnder(sky, [lower])).toBe(false);
    // side by side, nothing stands over either
    expect(liesUnder(line(0.4, 0, 0.4), [line(0.3, 0.6, 1)])).toBe(false);
    expect(innerByShape([sky, lower, line(0.2, 0.7, 1)], [0, 1, 2])).toEqual([1]);
  });

  it('finds the stroke a click falls on, within reach', () => {
    const scale = { width: 1000, height: 500 };
    const strokes = [line(0.3), line(0.6)];
    expect(lineAt(strokes, [3, 8], { u: 0.5, v: 0.31 }, 10, scale)).toBe(3);
    expect(lineAt(strokes, [3, 8], { u: 0.5, v: 0.59 }, 10, scale)).toBe(8);
    expect(lineAt(strokes, [3, 8], { u: 0.5, v: 0.45 }, 10, scale)).toBeNull();
  });

  it('sets a stroke inner or back on the skyline, and keeps only the skyline samples', () => {
    const marks = setInner(cleanMarks(null, 3), 2, true);
    expect(marks.inner).toEqual([2]);
    expect(setInner(marks, 2, false).inner).toEqual([]);
    const samples = [{ x: 1, y: 1, stroke: 0 }, { x: 2, y: 2, stroke: 2 }, { x: 3, y: 3, stroke: 1 }];
    expect(skySamples(samples, marks).map((s) => s.x)).toEqual([1, 3]);
    expect(skySamples(samples, NO_MARKS)).toBe(samples);
  });
});

describe('pairs', () => {
  it('goes in, comes out with the same two again, and the opposite order gives way', () => {
    let marks = cleanMarks(null, 3);
    marks = togglePair(marks, 1, 0);
    expect(marks.pairs).toEqual([[1, 0]]);
    marks = togglePair(marks, 0, 1);
    expect(marks.pairs).toEqual([[0, 1]]);
    marks = togglePair(marks, 0, 1);
    expect(marks.pairs).toEqual([]);
    expect(togglePair(marks, 2, 2)).toBe(marks);
  });

  it('is named by a letter at the middle of each of its strokes', () => {
    const strokes = [line(0.3, 0, 1, 5), line(0.5, 0, 0.4, 3)];
    const [badge] = pairBadges(strokes, cleanMarks({ pairs: [[1, 0]] }, 2));
    expect(badge.label).toBe('A');
    expect(badge.front).toEqual(strokes[1][1]);
    expect(badge.back).toEqual(strokes[0][2]);
    expect(pairLabel(1)).toBe('B');
    expect(pairLabel(27)).toBe('AB');
  });
});

describe('a collage cut in pieces', () => {
  it('lays cuts, takes the one clicked away, and says each point its piece', () => {
    let marks = addCut(cleanMarks(null, 0), 0.6);
    marks = addCut(marks, 0.3);
    expect(marks.cuts).toEqual([0.3, 0.6]);
    expect(cutAt(marks.cuts, 0.305, 10, 1000)).toBe(0);
    expect(cutAt(marks.cuts, 0.45, 10, 1000)).toBe(-1);
    expect(removeCut(marks, 0).cuts).toEqual([0.6]);
    expect([0.1, 0.4, 0.9].map((u) => pieceOf(marks.cuts, u))).toEqual([0, 1, 2]);
  });
});

describe('the strokes changed', () => {
  it('keeps each piece of a rubbed stroke under its id, and drops what went', () => {
    const marks = cleanMarks({ lines: [4, 7, 9], inner: [7], pairs: [[7, 4], [9, 4]] }, 3);
    // stroke 1 (id 7) rubbed in two, stroke 2 (id 9) rubbed away
    const after = marksAfter(marks, [0, 1, 1]);
    expect(after.lines).toEqual([4, 7, 7]);
    expect(after.inner).toEqual([7]);
    expect(after.pairs).toEqual([[7, 4]]);
  });
});

describe('how far a line stands', () => {
  it('ticks distances in the menu order and reads them as metres and words', () => {
    expect(DISTANCE_BANDS.map((band) => band.label)).toEqual(['< 1 km', '1–3 km', '3–10 km', '10–30 km', '> 30 km']);
    expect(cleanBands(['b10', 'b1', 'b1', 'huge'])).toEqual(['b1', 'b10']);
    expect(farRange(['b1', 'b3'])).toEqual([1_000, 10_000]);
    expect(farRange([])).toBeNull();
    expect(farLabel(['b1'])).toBe('1–3 km');
    expect(farLabel(['near', 'b1'])).toBe('< 3 km');
    expect(farLabel(['b10', 'b30'])).toBe('> 10 km');
    expect(farLabel([])).toBe('');
  });

  it('says a line stands that far, and the same again says nothing', () => {
    const marks = cleanMarks({ lines: [0, 1] }, 2);
    const said = setFar(marks, 1, ['b3']);
    expect(farOf(said, 1)).toEqual(['b3']);
    expect(marksSaid(said)).toBe(true);
    expect(sameMarks(said, marks)).toBe(false);
    expect(farOf(setFar(said, 1, ['b1']), 1)).toEqual(['b1']);
    expect(setFar(said, 1, ['b3']).far).toEqual([]);
    expect(setFar(said, 1, []).far).toEqual([]);
  });

  it('names each line’s distance at the middle of its longest stroke, and keeps it through a rub', () => {
    const strokes = [
      [{ u: 0.1, v: 0.4 }, { u: 0.2, v: 0.4 }, { u: 0.3, v: 0.4 }],
      [{ u: 0.5, v: 0.5 }],
    ];
    const marks = setFar(cleanMarks({ lines: [0, 1] }, 2), 0, ['b1']);
    expect(farBadges(strokes, marks)).toEqual([{ line: 0, label: '1–3 km', at: { u: 0.2, v: 0.4 } }]);
    // the stroke rubbed in two keeps its id, and its distance with it
    expect(marksAfter(marks, [0, 0, 1]).far).toEqual([{ line: 0, bands: ['b1'] }]);
    // a stroke gone takes its distance away
    expect(marksAfter(marks, [1]).far).toEqual([]);
  });
});

describe('lines along the sea', () => {
  it('are skyline, never an inner edge, and either word takes the other back', () => {
    const marks = cleanMarks({ lines: [0, 1] }, 2);
    const sea = setSea(marks, 1, true);
    expect(sea.sea).toEqual([1]);
    expect(marksSaid(sea)).toBe(true);
    expect(sameMarks(sea, marks)).toBe(false);
    const ridge = setInner(sea, 1, true);
    expect(ridge.inner).toEqual([1]);
    expect(ridge.sea).toEqual([]);
    expect(setSea(ridge, 1, true).inner).toEqual([]);
    expect(setSea(sea, 1, false).sea).toEqual([]);
  });
});

describe('lines with only sky above', () => {
  it('are said of a skyline line and taken back the same way, never of an inner edge', () => {
    const marks = cleanMarks({ lines: [0, 1, 2], inner: [2] }, 3);
    const sure = toggleClear(marks, 1);
    expect(sure.clear).toEqual([1]);
    expect(marksSaid(sure)).toBe(true);
    expect(sameMarks(sure, marks)).toBe(false);
    expect(toggleClear(sure, 1).clear).toEqual([]);
    // a ridge has land above it
    expect(toggleClear(marks, 2)).toBe(marks);
    expect(setInner(sure, 1, true).clear).toEqual([]);
  });

  it('are named a quarter along their longest stroke, clear of the badges at the middle', () => {
    const strokes = [line(0.3, 0, 0.4, 5), line(0.4, 0.5, 1, 9)];
    const marks = toggleClear(cleanMarks({ lines: [3, 3] }, 2), 3);
    expect(clearBadges(strokes, marks)).toEqual([{ line: 3, at: strokes[1][2] }]);
    expect(clearBadges(strokes, cleanMarks({ lines: [3, 3] }, 2))).toEqual([]);
  });
});

describe('key lines', () => {
  it('are said of a skyline line and taken back the same way, never of an inner edge', () => {
    const marks = cleanMarks({ lines: [0, 1, 2], inner: [2] }, 3);
    const keyed = toggleKey(marks, 1);
    expect(keyed.key).toEqual([1]);
    expect(marksSaid(keyed)).toBe(true);
    expect(sameMarks(keyed, marks)).toBe(false);
    expect(toggleKey(keyed, 1).key).toEqual([]);
    // only skyline lines are held to their fit
    expect(toggleKey(marks, 2)).toBe(marks);
    expect(setInner(keyed, 1, true).key).toEqual([]);
    expect(cleanMarks({ lines: [0, 1, 2], inner: [2], key: [2, 1, 7] }, 3).key).toEqual([1]);
  });

  it('are three at most: the newest takes the oldest one’s place', () => {
    let marks = cleanMarks({ lines: [0, 1, 2, 3] }, 4);
    for (const id of [3, 0, 2, 1]) marks = toggleKey(marks, id);
    expect(KEYS_MAX).toBe(3);
    expect(marks.key).toEqual([0, 2, 1]);
    expect(cleanMarks({ lines: [0, 1, 2, 3], key: [3, 0, 2, 1] }, 4).key).toEqual([0, 2, 1]);
  });

  it('are named three quarters along their longest stroke, clear of the Sky only badge', () => {
    const strokes = [line(0.3, 0, 0.4, 5), line(0.4, 0.5, 1, 9)];
    const marks = toggleKey(cleanMarks({ lines: [3, 3] }, 2), 3);
    expect(keyBadges(strokes, marks)).toEqual([{ line: 3, at: strokes[1][6] }]);
    expect(keyBadges(strokes, cleanMarks({ lines: [3, 3] }, 2))).toEqual([]);
  });
});
