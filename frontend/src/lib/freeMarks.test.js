import { describe, expect, it } from 'vitest';
import { surfaceFrame, surfaceHitTest, surfaceToPage } from './composer.js';
import {
  PAGE, PAGE_REACH, canBeFree, freeExtent, markBounds, pageHit, holdsToPicture, isFree, isLink, letGoOf, linkPoints, nudgedLink, onPage,
  pageEntry, pictureUnder, settleLink, shiftedTies,
} from './freeMarks.js';

// A panel 200×100 drawn at half size from (40, 20) on the page, and the page.
const panel = {
  id: 'p1', kind: 'panel', index: 0,
  item: { id: 'p1', natural: [200, 100] },
  box: { x: 40, y: 20, w: 100, h: 50, scale: 0.5, baseScale: 1, row: 0 },
};
const page = pageEntry(400, 300);
const frames = { p1: surfaceFrame(panel), [PAGE]: surfaceFrame(page) };
const frameOf = (id) => frames[id] ?? null;

describe('the page as a surface', () => {
  it('is upright at scale 1, so its pixels are the document’s', () => {
    const frame = surfaceFrame(pageEntry(400, 300));
    expect(frame.box).toMatchObject({ x: 0, y: 0, w: 400, h: 300, scale: 1 });
    expect(surfaceToPage({ x: 12, y: 34 }, frame)).toEqual({ x: 12, y: 34 });
    expect(onPage({ x: -5, y: 320 })).toEqual({ x: 0, y: 320 });
    expect(onPage({ x: 9e9, y: 10 }).x).toBe(PAGE_REACH);
  });

  it('answers last, under every picture', () => {
    expect(surfaceHitTest([panel, page], { x: 60, y: 30 }).id).toBe('p1');
    expect(surfaceHitTest([panel, page], { x: 300, y: 200 }).id).toBe(PAGE);
    expect(pictureUnder([panel, page], { x: 300, y: 200 })).toBeNull();
  });

  it('takes any mark but those that only mean something on a picture', () => {
    for (const kind of ['rect', 'ellipse', 'arrow', 'line', 'curve', 'freehand', 'text', 'icon', 'number']) {
      expect(canBeFree(kind)).toBe(true);
    }
    for (const kind of ['blur', 'zoom', 'callout', 'cone']) expect(canBeFree(kind)).toBe(false);
  });
});

describe('a line that holds to pictures by its ends', () => {
  it('stays the picture’s mark when both ends are on it', () => {
    const s = { id: 's1', kind: 'arrow', panel: 'p1', points: [0, 0, 1, 1], rotation: 0 };
    const out = settleLink(
      s,
      { page: { x: 50, y: 30 }, on: { id: 'p1', nx: 20, ny: 20 } },
      { page: { x: 90, y: 40 }, on: { id: 'p1', nx: 100, ny: 40 } },
    );
    expect(out).toMatchObject({ panel: 'p1', points: [20, 20, 100, 40] });
    expect(out).not.toHaveProperty('ends');
    expect(out).not.toHaveProperty('rotation');
  });

  it('goes on the page, each end holding to its own picture or to nothing', () => {
    const s = { id: 's1', kind: 'line', panel: 'p1', points: [0, 0, 1, 1] };
    const tied = settleLink(
      s,
      { page: { x: 50, y: 30 }, on: { id: 'p1', nx: 20, ny: 20 } },
      { page: { x: 300, y: 200 }, on: null },
    );
    expect(tied).toMatchObject({ panel: PAGE, points: [50, 30, 300, 200], ends: [{ panel: 'p1', x: 20, y: 20 }, null] });
    expect(holdsToPicture(tied)).toBe(true);
    const free = settleLink(s, { page: { x: 5, y: 5 }, on: null }, { page: { x: 9, y: 9 }, on: null });
    expect(free).toMatchObject({ panel: PAGE, points: [5, 5, 9, 9] });
    expect(free).not.toHaveProperty('ends');
    expect(isFree(free)).toBe(true);
    expect(holdsToPicture(free)).toBe(false);
  });

  it('draws an end where its picture has it now', () => {
    const s = { kind: 'arrow', panel: PAGE, points: [0, 0, 300, 200], ends: [{ panel: 'p1', x: 20, y: 20 }, null] };
    expect(isLink(s)).toBe(true);
    // pixel (20, 20) of a half-size panel at (40, 20)
    expect(linkPoints(s, frameOf)).toEqual([50, 30, 300, 200]);
    // a picture that is gone leaves the end where the page last saw it
    expect(linkPoints(s, () => null)).toEqual([0, 0, 300, 200]);
  });

  it('carries a held end inside its picture when the line is nudged', () => {
    const s = { kind: 'arrow', panel: PAGE, points: [50, 30, 300, 200], ends: [{ panel: 'p1', x: 20, y: 20 }, null] };
    const moved = nudgedLink(s, 4, -2, frameOf);
    expect(moved.points).toEqual([54, 28, 304, 198]);
    // four page pixels are eight of a half-size picture
    expect(moved.ends[0]).toMatchObject({ panel: 'p1', x: 28, y: 16 });
    expect(moved.ends[1]).toBeNull();
  });

  it('lets go of a picture that leaves, where the page saw the end', () => {
    const s = { kind: 'arrow', panel: PAGE, points: [0, 0, 300, 200], ends: [{ panel: 'p1', x: 20, y: 20 }, null] };
    const out = letGoOf(s, 'p1', frames.p1);
    expect(out.points).toEqual([50, 30, 300, 200]);
    expect(out).not.toHaveProperty('ends');
    expect(letGoOf(s, 'p2', frames.p1)).toBe(s);
  });

  it('moves a hold with its picture’s crop', () => {
    const shapes = [{ kind: 'arrow', panel: PAGE, points: [0, 0, 1, 1], ends: [{ panel: 'p1', x: 20, y: 20 }, { panel: 'p2', x: 5, y: 5 }] }];
    const [out] = shiftedTies(shapes, 'p1', -10, 4);
    expect(out.ends).toEqual([{ panel: 'p1', x: 10, y: 24 }, { panel: 'p2', x: 5, y: 5 }]);
    expect(shiftedTies(shapes, 'p1', 0, 0)).toBe(shapes);
  });
});

describe('a page that grows to hold its free marks', () => {
  const helpers = { measure: () => ({ w: 80, h: 20 }), frameOf };

  it('takes a mark let go past its right or bottom edge, never above or left of it', () => {
    expect(pageHit([panel, page], { x: 900, y: 700 })).toMatchObject({ id: PAGE, nx: 900, ny: 700 });
    expect(pageHit([panel, page], { x: -1, y: 10 })).toBeNull();
  });

  it('measures what a free mark covers, ink and tag included', () => {
    expect(markBounds({ kind: 'rect', panel: PAGE, x: 10, y: 20, w: 100, h: 50, strokeWidth: 4 }, helpers))
      .toEqual({ left: 8, top: 18, right: 112, bottom: 72 });
    const tagged = markBounds({ kind: 'rect', panel: PAGE, x: 10, y: 20, w: 100, h: 50, strokeWidth: 4, tag: 'T', tagSize: 10 }, helpers);
    expect(tagged.top).toBeLessThan(18);
    expect(markBounds({ kind: 'text', panel: PAGE, x: 300, y: 40 }, helpers).right).toBe(382);
    // a line that holds reaches where its picture has its end
    const link = { kind: 'line', panel: PAGE, points: [0, 0, 500, 400], ends: [{ panel: 'p1', x: 20, y: 20 }, null], strokeWidth: 2 };
    expect(markBounds(link, helpers)).toEqual({ left: 49, top: 29, right: 501, bottom: 401 });
  });

  it('reaches as far as the free marks do, and no mark of a picture counts', () => {
    const shapes = [
      { kind: 'rect', panel: PAGE, x: 600, y: 10, w: 100, h: 20, strokeWidth: 0 },
      { kind: 'rect', panel: 'p1', x: 5000, y: 5000, w: 10, h: 10 },
      { kind: 'icon', panel: PAGE, x: 100, y: 450, size: 30, strokeWidth: 0 },
    ];
    expect(freeExtent(shapes, helpers)).toEqual({ right: 700, bottom: 480 });
  });
});
