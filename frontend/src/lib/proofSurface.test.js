import { describe, expect, it } from 'vitest';
import {
  blurPatch,
  blurRadiusFor,
  cutToSourceCrop,
  fitSurfaceCut,
  isQuarterTurn,
  isSideways,
  mapSurfaceShapes,
  normalizeSurfaceCut,
  settleSurfaceCut,
  surfaceCutOutline,
  surfaceCutReach,
  surfaceCutSeat,
  surfaceCutStart,
  turnSurfaceCut,
  normalizeSourceCrop,
  normalizeSurfaceAngle,
  rotatedBoxSize,
  shiftProofShape,
  sourceSize,
  surfaceBoxSize,
  surfaceImageSize,
} from './proofSurface.js';

describe('proof surface geometry', () => {
  it('keeps arbitrary angles compact', () => {
    expect([normalizeSurfaceAngle(-450), normalizeSurfaceAngle(450)]).toEqual([-90, 90]);
    expect(normalizeSurfaceAngle(42.5)).toBe(42.5);
    expect(normalizeSurfaceAngle('bad')).toBe(0);
  });

  it('reads a crop in source pixels and clamps it there', () => {
    expect(normalizeSourceCrop({ x: -4, y: 10, w: 80, h: 200 }, [100, 80]))
      .toEqual({ x: 0, y: 10, w: 76, h: 70 });
    expect(sourceSize([0, -3])).toEqual([1, 1]);
  });

  it('calls a crop that covers everything no crop at all', () => {
    // Null is the absence of a box, so nothing downstream has to recognise a
    // full-size one: the image draws its source and the reset control goes away.
    expect(normalizeSourceCrop({ x: 0, y: 0, w: 100, h: 80 }, [100, 80])).toBeNull();
    expect(normalizeSourceCrop(null, [100, 80])).toBeNull();
    expect(normalizeSourceCrop({ x: 0, y: 0, w: 0, h: 10 }, [100, 80])).toBeNull();
  });

  it('draws the crop when there is one, and the source otherwise', () => {
    expect(surfaceImageSize([100, 80], { x: 10, y: 5, w: 40, h: 30 })).toEqual([40, 30]);
    expect(surfaceImageSize([100, 80], null)).toEqual([100, 80]);
  });

  it('boxes a turned rectangle upright, which is what the page reserves', () => {
    expect(rotatedBoxSize(100, 50, 0)).toEqual([100, 50]);
    expect(rotatedBoxSize(100, 50, 90)).toEqual([50, 100]);
    expect(rotatedBoxSize(100, 50, -90)).toEqual([50, 100]);
    // a free turn needs more room than either side of the rectangle
    const [width, height] = rotatedBoxSize(100, 50, 45);
    expect(width).toBeGreaterThan(100);
    expect(height).toBeGreaterThan(50);
  });

  it('boxes the crop rather than the source once both apply', () => {
    expect(surfaceBoxSize([400, 300], { x: 20, y: 20, w: 200, h: 100 }, 90)).toEqual([100, 200]);
    expect(surfaceBoxSize([400, 300], null, 0)).toEqual([400, 300]);
  });
});

describe('annotations follow their surface', () => {
  it('travels with the crop corner they are measured from', () => {
    expect(shiftProofShape({ x: 20, y: 30 }, -5, 8)).toMatchObject({ x: 15, y: 38 });
    expect(shiftProofShape({ points: [0, 0, 10, 4] }, -5, 8).points).toEqual([-5, 8, 5, 12]);
  });

  it('is left alone by a turn, which the group they are drawn in carries', () => {
    const shape = { kind: 'rect', x: 10, y: 20, rotation: 15 };
    expect(shiftProofShape(shape, 0, 0)).toBe(shape);
  });

  it('leaves annotations on the other surfaces untouched', () => {
    const other = { id: 'b', panel: 'p2', x: 1, y: 2 };
    const result = mapSurfaceShapes(
      [{ id: 'a', panel: 'p1', x: 5, y: 6 }, other],
      'p1',
      (shape) => shiftProofShape(shape, 10, 10),
    );
    expect(result[0]).toMatchObject({ x: 15, y: 16 });
    expect(result[1]).toBe(other);
  });
});

describe('a blur box over a surface', () => {
  it('names the source pixels under it, through the surface\'s own crop', () => {
    expect(blurPatch({ x: 10, y: 20, w: 50, h: 40 }, [800, 600], null)).toEqual({
      dx: 0, dy: 0, turn: 0, w: 50, h: 40, crop: { x: 10, y: 20, width: 50, height: 40 },
    });
    // the drawn space starts at the crop, so the file's pixels are offset by it
    expect(blurPatch({ x: 10, y: 20, w: 50, h: 40 }, [800, 600], { x: 100, y: 60, w: 400, h: 300 })).toEqual({
      dx: 0, dy: 0, turn: 0, w: 50, h: 40, crop: { x: 110, y: 80, width: 50, height: 40 },
    });
  });

  it('keeps only the part that overlaps the picture', () => {
    // half off the left edge: the box still draws, the patch starts at 0
    expect(blurPatch({ x: -20, y: 10, w: 50, h: 40 }, [800, 600], null)).toEqual({
      dx: 20, dy: 0, turn: 0, w: 30, h: 40, crop: { x: 0, y: 10, width: 30, height: 40 },
    });
    // past the bottom-right: clipped to the picture
    expect(blurPatch({ x: 780, y: 580, w: 60, h: 60 }, [800, 600], null)).toMatchObject({
      w: 20, h: 20, crop: { x: 780, y: 580, width: 20, height: 20 },
    });
    // wholly outside: nothing to blur
    expect(blurPatch({ x: 900, y: 10, w: 50, h: 40 }, [800, 600], null)).toBeNull();
  });

  it('reads a margin of ground around the box without drawing one', () => {
    // the filter needs real pixels past the edge, or the border comes out washed
    // out — the one place a redaction has to hold
    expect(blurPatch({ x: 100, y: 100, w: 50, h: 40 }, [800, 600], null, 10)).toEqual({
      dx: -10, dy: -10, turn: 0, w: 70, h: 60, crop: { x: 90, y: 90, width: 70, height: 60 },
    });
    // at the picture's edge there is no margin to take, and the patch stops there
    expect(blurPatch({ x: 0, y: 0, w: 50, h: 40 }, [800, 600], null, 10)).toEqual({
      dx: 0, dy: 0, turn: 0, w: 60, h: 50, crop: { x: 0, y: 0, width: 60, height: 50 },
    });
  });

  it('reads a turned box off the ground it stands on, not off a turned picture', () => {
    // 40×20 turned a quarter turn: it covers 20×40 of upright picture, reaching
    // left of its own origin, and the patch is turned back level inside the box
    const patch = blurPatch({ x: 100, y: 100, w: 40, h: 20, rotation: 90 }, [800, 600], null);

    expect(patch).toMatchObject({
      w: 20, h: 40, turn: -90, crop: { x: 80, y: 100, width: 20, height: 40 },
    });
    // where it sits inside the box, in the box's own turned space
    expect(patch.dx).toBeCloseTo(0, 6);
    expect(patch.dy).toBeCloseTo(20, 6);
  });

  it('blurs in proportion to what it hides, between a floor and a ceiling', () => {
    expect(blurRadiusFor({ w: 200, h: 100 })).toBe(20);
    expect(blurRadiusFor({ w: 10, h: 10 })).toBe(6);
    expect(blurRadiusFor({ w: 4000, h: 3000 })).toBe(80);
  });
});

describe('an upright cut over a turned picture', () => {
  const close = (p, q) => {
    expect(p.x).toBeCloseTo(q.x, 6);
    expect(p.y).toBeCloseTo(q.y, 6);
  };

  it('reserves the cut itself on the page, whatever the turn', () => {
    expect(surfaceBoxSize([640, 360], null, 30, { x: -100, y: -50, w: 200, h: 100 })).toEqual([200, 100]);
    // no cut: the turned picture's upright box, as before
    expect(surfaceBoxSize([640, 360], null, 30)).toEqual(rotatedBoxSize(640, 360, 30));
  });

  it('reads a cut in whole units and gives way to a crop', () => {
    expect(normalizeSurfaceCut({ x: -10.4, y: 5.6, w: 20.2, h: 9.9 })).toEqual({ x: -10, y: 6, w: 20, h: 10 });
    expect(normalizeSurfaceCut({ x: 0, y: 0, w: 0, h: 10 })).toBeNull();
    expect(normalizeSurfaceCut({ x: 'a', y: 0, w: 4, h: 4 })).toBeNull();
    expect(normalizeSurfaceCut([1, 2, 3, 4])).toBeNull();
    // only a hand-edited spec holds both, and every older build reads the crop
    expect(normalizeSurfaceCut({ x: 0, y: 0, w: 4, h: 4 }, { x: 0, y: 0, w: 4, h: 4 })).toBeNull();
  });

  it('tells the turns whose edges lie along the page', () => {
    expect([0, 90, -90, 180, 270, 89.999].map(isQuarterTurn)).toEqual([true, true, true, true, true, true]);
    expect([7, 45, 135.5].map(isQuarterTurn)).toEqual([false, false, false]);
    expect([90, -90, 270].map(isSideways)).toEqual([true, true, true]);
    expect([0, 180, 7].map(isSideways)).toEqual([false, false, false]);
  });

  it('opens its marks on what the surface shows, upright', () => {
    // unturned: the whole picture, measured from its middle
    expect(surfaceCutStart([640, 360], null, 0)).toEqual({ x: -320, y: -180, w: 640, h: 360 });
    // unturned and cropped: the crop, measured the same way
    expect(surfaceCutStart([640, 360], { x: 40, y: 20, w: 200, h: 100 }, 0))
      .toEqual({ x: -280, y: -160, w: 200, h: 100 });
    // turned: the upright box around the turned picture
    const start = surfaceCutStart([640, 360], null, 30);
    const reach = surfaceCutReach([640, 360], 30);
    expect(start.x).toBeCloseTo(reach.left, 6);
    expect(start.w).toBeCloseTo(reach.right - reach.left, 6);
  });

  it('keeps no cut when the marks were left round the whole picture', () => {
    expect(settleSurfaceCut(surfaceCutStart([640, 360], null, 30), [640, 360], 30)).toBeNull();
    expect(settleSurfaceCut({ x: -200, y: -100, w: 300, h: 150 }, [640, 360], 30))
      .toEqual({ x: -200, y: -100, w: 300, h: 150 });
  });

  it('holds a cut a spec carries to the picture it can reach', () => {
    expect(fitSurfaceCut({ x: -1000, y: -10, w: 3000, h: 20 }, [640, 360], 30)).toEqual({ x: -368, y: -10, w: 736, h: 20 });
    expect(fitSurfaceCut({ x: 5000, y: 0, w: 10, h: 10 }, [640, 360], 30)).toBeNull();
  });

  it('stays square on a small turn and goes round with a quarter turn', () => {
    const cut = { x: 0, y: -50, w: 200, h: 100 }; // its middle 100 right of the picture's
    // a few degrees more: the same box, its middle turned about the picture's
    const levelled = turnSurfaceCut(cut, 7, 10);
    expect([levelled.w, levelled.h]).toEqual([200, 100]);
    close({ x: levelled.x + 100, y: levelled.y + 50 }, { x: 100 * Math.cos(Math.PI / 60), y: 100 * Math.sin(Math.PI / 60) });
    // a quarter turn: the box goes round with the picture
    const sideways = turnSurfaceCut(cut, 7, 97);
    expect([sideways.w, sideways.h]).toEqual([100, 200]);
    close({ x: sideways.x + 50, y: sideways.y + 100 }, { x: 0, y: 100 });
  });

  it('becomes a plain crop once the picture lies square again', () => {
    // a quarter turn: 200 across the page is 200 down the source
    expect(cutToSourceCrop({ x: -100, y: -50, w: 200, h: 100 }, [640, 360], 90)).toEqual({ x: 270, y: 80, w: 100, h: 200 });
    // what lies past the picture is not kept
    expect(cutToSourceCrop({ x: -400, y: -50, w: 500, h: 100 }, [640, 360], 0)).toEqual({ x: 0, y: 130, w: 420, h: 100 });
    expect(cutToSourceCrop({ x: -320, y: -180, w: 640, h: 360 }, [640, 360], 0)).toBeNull();
  });

  it('seats the cut in the picture\'s own pixels, turned back square', () => {
    const cut = { x: -100, y: -50, w: 200, h: 100 };
    const seat = surfaceCutSeat(cut, [640, 360], 30);
    const outline = surfaceCutOutline(cut, [640, 360], 30);
    expect(seat.rotation).toBe(-30);
    close(outline[0], seat);
    // its corners are as far apart as the cut is wide and tall
    expect(Math.hypot(outline[1].x - outline[0].x, outline[1].y - outline[0].y)).toBeCloseTo(200, 6);
    expect(Math.hypot(outline[3].x - outline[0].x, outline[3].y - outline[0].y)).toBeCloseTo(100, 6);
  });
});
