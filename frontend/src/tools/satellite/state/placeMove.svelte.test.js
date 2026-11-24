import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Moving a saved place (`state/placeMove.svelte.js`): picked up from its card, the map
 * slides so its point is under the pointer, a pale pin follows the pointer, a click
 * puts it down and Escape leaves it where it was. The map's surface is stood in for.
 */

const ghost = { shapes: [], moves: [], cleared: 0 };
vi.mock('../../../lib/map/surface.js', () => ({
  createSurface: () => ({
    set: (shapes) => (ghost.shapes = shapes),
    patch: (id, change) => {
      if (id !== 'ghost' || !ghost.shapes.length) return false;
      ghost.moves.push(change.at ?? change.points);
      return true;
    },
    clear: () => {
      ghost.shapes = [];
      ghost.cleared += 1;
    },
    destroy: () => {},
  }),
}));

const { createPlaceMove } = await import('./placeMove.svelte.js');
const { placeMark } = await import('../../../lib/mapMarkers.js');

const PLACE = { id: 'p1', key: 'p1', kind: 'place', lat: 48.5, lon: 2.25, color: '#1f77b4' };

let map;
let deps;
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

function make() {
  map = {
    // the place stands at (300, 200) in the map's pixels
    latLngToContainerPoint: vi.fn(() => ({ x: 300, y: 200 })),
    panBy: vi.fn(),
  };
  deps = { engine: () => map, move: vi.fn(async () => {}), notify: vi.fn() };
  return createPlaceMove(deps);
}

beforeEach(() => {
  ghost.shapes = [];
  ghost.moves = [];
  ghost.cleared = 0;
});

describe('picking a place up', () => {
  it('slides the map so the point is under the pointer, which a page cannot move', () => {
    const move = make();
    expect(move.start(PLACE, { x: 320, y: 60 })).toBe(true);
    // the point at (300, 200) comes to the press at (320, 60)
    expect(map.panBy).toHaveBeenCalledWith(-20, 140);
    expect(move.on).toBe(true);
    expect(move.row).toBe(PLACE);
  });

  it('holds a pale copy of the place’s own pin, in its colour, on its point', () => {
    const move = make();
    move.start(PLACE, { x: 320, y: 60 });
    const [pin] = ghost.shapes;
    expect(pin).toMatchObject({ id: 'ghost', kind: 'marker', at: { lat: 48.5, lon: 2.25 }, keyboard: false });
    expect(pin.html).toBe(placeMark({ colour: '#1f77b4', className: 'sat-ghost' }).html);
    expect(pin.className).toContain('sat-ghost');
  });

  it('waits on its point when no press was given, and moves no map', () => {
    const move = make();
    expect(move.start(PLACE)).toBe(true);
    expect(map.panBy).not.toHaveBeenCalled();
    expect(ghost.shapes[0].at).toEqual({ lat: 48.5, lon: 2.25 });
  });

  it('picks up nothing with no point or no map', () => {
    expect(make().start({ ...PLACE, lat: null })).toBe(false);
    const move = make();
    map = null;
    expect(move.start(PLACE, { x: 1, y: 1 })).toBe(false);
    expect(move.on).toBe(false);
  });
});

describe('putting it down', () => {
  it('follows the pointer, then puts the place down where the click lands', async () => {
    const move = make();
    move.start(PLACE, { x: 320, y: 60 });
    move.follow({ lat: 48.6, lon: 2.3 });
    expect(ghost.moves).toEqual([{ lat: 48.6, lon: 2.3 }]);

    expect(move.place({ lat: 48.61, lon: 2.31 })).toBe(true);
    expect(deps.move).toHaveBeenCalledWith(PLACE, { lat: 48.61, lon: 2.31 });
    await settle();
    expect(move.on).toBe(false);
    expect(ghost.shapes).toEqual([]);
  });

  it('keeps the place in the hand when the server refuses, and says why', async () => {
    const move = make();
    deps.move.mockRejectedValueOnce(new Error('Another place already stands there: depot'));
    move.start(PLACE, { x: 320, y: 60 });
    move.place({ lat: 48.61, lon: 2.31 });
    await settle();
    expect(deps.notify).toHaveBeenCalledWith('Could not move the place: Another place already stands there: depot', 'danger', 6000);
    expect(move.on).toBe(true);
    expect(move.saving).toBe(false);
  });

  it('takes one click while the first is on its way', () => {
    const move = make();
    move.start(PLACE, { x: 320, y: 60 });
    move.place({ lat: 48.61, lon: 2.31 });
    expect(move.place({ lat: 48.7, lon: 2.4 })).toBe(true);
    expect(deps.move).toHaveBeenCalledTimes(1);
  });

  it('leaves a click on the map alone when nothing is held', () => {
    expect(make().place({ lat: 1, lon: 2 })).toBe(false);
  });
});

describe('letting it go', () => {
  it('leaves the place where it was on Escape', () => {
    const move = make();
    move.start(PLACE, { x: 320, y: 60 });
    expect(move.cancel()).toBe(true);
    expect(move.on).toBe(false);
    expect(ghost.shapes).toEqual([]);
    expect(deps.move).not.toHaveBeenCalled();
    // a second Escape is somebody else's
    expect(move.cancel()).toBe(false);
  });
});

describe('a zone in the hand', () => {
  const AREA = { type: 'Polygon', coordinates: [[[2, 48], [2.2, 48], [2.2, 48.2], [2, 48.2], [2, 48]]] };
  const ZONE = { id: 'z1', key: 'z1', kind: 'place', lat: 48.1, lon: 2.1, zone: true, footprint: AREA };

  it('is carried as its own outline, its point under the hand, never as a pin', () => {
    const move = make();
    move.start(ZONE, { x: 320, y: 60 });
    expect(move.zone).toBe(true);
    const [outline] = ghost.shapes;
    expect(outline).toMatchObject({ id: 'ghost', kind: 'polygon' });
    expect(outline.points).toHaveLength(4);
    expect(outline.style.dash).toBe('6 4');

    move.follow({ lat: 49.1, lon: 3.1 });
    const [moved] = ghost.moves;
    // shifted by one degree each way, corner for corner
    expect(moved[0].lat).toBeCloseTo(49, 9);
    expect(moved[0].lon).toBeCloseTo(3, 9);
    expect(moved[2].lat).toBeCloseTo(49.2, 9);
  });

  it('takes a place that only traced its precision as a pin, as before', () => {
    const move = make();
    move.start({ ...ZONE, zone: false }, { x: 320, y: 60 });
    expect(move.zone).toBe(false);
    expect(ghost.shapes[0].kind).toBe('marker');
  });
});
