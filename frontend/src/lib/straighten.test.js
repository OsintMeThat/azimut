import { describe, expect, it } from 'vitest';
import { levelShift, exportBend, LEVEL_MIN_POINTS } from './straighten.js';


describe('straightening a collage along a level line', () => {
  it('needs a line across the canvas', () => {
    expect(LEVEL_MIN_POINTS).toBe(2);
    expect(levelShift([])).toBeNull();
    expect(levelShift([[100, 50]])).toBeNull();
    expect(levelShift([[100, 50], [100, 80]])).toBeNull();
  });

  it('lays a sloping line flat at its own mean height', () => {
    // a shore that drops 40 px across 400: the pan's tilt drifted
    const bend = levelShift([[0, 100], [200, 120], [400, 140]]);
    expect(bend.level).toBeCloseTo(120, 9);
    for (const [x, y] of [[0, 100], [100, 110], [400, 140]]) expect(y + bend.shift(x)).toBeCloseTo(120, 6);
  });

  it('lays a smile flat too, and holds its ends past the line', () => {
    const smile = [0, 100, 200, 300, 400].map((x) => [x, 100 + ((x - 200) / 200) ** 2 * 30]);
    const bend = levelShift(smile);
    for (const [x, y] of smile) expect(y + bend.shift(x)).toBeCloseTo(bend.level, 6);
    // past the line, the picture moves as the line's end does, however far the pan reaches
    expect(bend.shift(650)).toBeCloseTo(bend.shift(400), 9);
    expect(bend.shift(-3000)).toBeCloseTo(bend.shift(0), 9);
  });

  it('runs through every click, whatever order they came in', () => {
    // a hand-drawn shore: six clicks, none on one smooth polynomial
    const clicks = [[0, 100], [90, 108], [210, 101], [300, 117], [420, 111], [500, 125]];
    const shuffled = [clicks[3], clicks[0], clicks[5], clicks[1], clicks[4], clicks[2]];
    const bend = levelShift(shuffled);
    for (const [x, y] of clicks) expect(y + bend.shift(x)).toBeCloseTo(bend.level, 6);
    expect([bend.from, bend.to]).toEqual([0, 500]);
  });

  it('bends only the stretch around a point added between two others', () => {
    const line = [[0, 100], [100, 100], [200, 100], [300, 100], [400, 100], [500, 100]];
    const before = levelShift(line);
    const after = levelShift([...line, [250, 130]]);
    expect(after.shift(260) - after.level).not.toBeCloseTo(before.shift(260) - before.level, 1);
    // two columns away the curve has not moved; only where it is laid flat (its mean) changed
    for (const x of [0, 50, 450, 500]) expect(after.level - after.shift(x)).toBeCloseTo(before.level - before.shift(x), 9);
  });

  it('reads clicks on one column at their mean height', () => {
    const bend = levelShift([[0, 100], [200, 110], [200.2, 130], [400, 100]]);
    expect(bend.level - bend.shift(200)).toBeCloseTo(120, 9);
  });

  it('bends each export column by the line at its own column, with room above and below', () => {
    // a collage 400 canvas px wide exported at twice its size, the shore rising 40 px across it
    const frame = { minX: 100, minY: 0, scale: 2, width: 800, height: 300 };
    const line = [[100, 150], [500, 110]];
    const bend = exportBend(line, frame);
    const at = levelShift(line);
    expect(bend.shifts).toHaveLength(800);
    expect(bend.shifts[0]).toBeCloseTo(at.shift(100.25) * 2, 9);
    expect(bend.shifts[799]).toBeCloseTo(at.shift(499.75) * 2, 9);
    // the left end comes up 20 canvas px (40 out), the right goes down as much: room both ways
    expect(bend.pad).toBe(Math.ceil(-Math.min(...bend.shifts)));
    expect(bend.height).toBe(300 + bend.pad + Math.ceil(Math.max(...bend.shifts)));
  });

  it('says nothing for a line that cannot straighten', () => {
    expect(exportBend([[5, 5]], { minX: 0, scale: 1, width: 10, height: 10 })).toBeNull();
  });
});
