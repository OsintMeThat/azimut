import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Dropping a pin where the analyst clicks (`state/drop.svelte.js`): a lead of the scene
 * being geolocated, or a pin that asks for its name before it is saved as a place. The
 * map's surface is stood in for: what is asserted is what is declared on it.
 */

const declared = [];
vi.mock('../../../lib/map/surface.js', () => ({
  createSurface: () => ({ set: (shapes) => declared.push(shapes), destroy: () => {} }),
}));

const { createDropState, leadSvg, PLACE_NAME_MAX } = await import('./drop.svelte.js');
const { sceneColorAt } = await import('../../../lib/scenes.js');

const SCENE = { video: 'media/convoy.mp4', id: 'sc_1', order: 2, leads: [{ id: 'ld_1', n: 1, lat: 1, lon: 2 }, { id: 'ld_2', n: 4, lat: 3, lon: 4 }] };

let held;
let deps;
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

function make() {
  deps = {
    engine: () => ({}),
    held: () => held,
    dropLead: vi.fn(async (at) => ({ id: 'ld_new', n: 5, ...at })),
    moveLead: vi.fn(async () => ({})),
    savePlace: vi.fn(async () => {}),
    centre: vi.fn(),
    notify: vi.fn(),
  };
  return createDropState(deps);
}

beforeEach(() => {
  declared.length = 0;
  held = null;
});

describe('the drop mode', () => {
  it('takes no click until it is armed, then every one until it ends', async () => {
    const drop = make();
    held = SCENE;
    expect(drop.place({ lat: 5, lon: 6 })).toBe(false);
    drop.start();
    expect(drop.place({ lat: 5, lon: 6 })).toBe(true);
    await settle();
    expect(drop.place({ lat: 7, lon: 8 })).toBe(true);
    await settle();
    expect(deps.dropLead.mock.calls.map(([at]) => at)).toEqual([{ lat: 5, lon: 6 }, { lat: 7, lon: 8 }]);
    expect(drop.armed).toBe(true);
    drop.stop();
    expect(drop.armed).toBe(false);
    expect(drop.place({ lat: 9, lon: 9 })).toBe(false);
  });

  it('drops a lead with no name asked while a scene is geolocated, and says when it could not', async () => {
    const drop = make();
    held = SCENE;
    deps.dropLead.mockRejectedValueOnce(new Error('a scene keeps at most 50 leads'));
    drop.at({ lat: 5, lon: 6 });
    await settle();
    expect(drop.naming).toBe(null);
    expect(deps.notify).toHaveBeenCalledWith('Could not drop the lead: a scene keeps at most 50 leads', 'danger', 6000);
  });

  it('asks a name for a pin with no scene geolocated, and saves nothing without one', async () => {
    const drop = make();
    drop.start();
    drop.place({ lat: 5, lon: 6 });
    expect(drop.naming).toEqual({ lat: 5, lon: 6, title: '' });
    expect(await drop.save()).toBe(false);
    drop.setTitle('   ');
    expect(await drop.save()).toBe(false);
    expect(deps.savePlace).not.toHaveBeenCalled();

    // a click elsewhere moves the pin waiting, the name typed so far kept
    drop.setTitle('Water tower');
    drop.place({ lat: 7, lon: 8 });
    expect(drop.naming).toEqual({ lat: 7, lon: 8, title: 'Water tower' });

    drop.setTitle('  Water tower  ');
    expect(await drop.save()).toBe(true);
    expect(deps.savePlace).toHaveBeenCalledWith({ lat: 7, lon: 8, title: 'Water tower' });
    expect(drop.naming).toBe(null);
    expect(drop.armed).toBe(true);
  });

  it('keeps a name to the length a place takes', () => {
    const drop = make();
    drop.at({ lat: 1, lon: 1 });
    drop.setTitle('x'.repeat(PLACE_NAME_MAX + 50));
    expect(drop.naming.title).toHaveLength(PLACE_NAME_MAX);
  });

  it('keeps the pin and its name when the save fails, and says why', async () => {
    const drop = make();
    drop.at({ lat: 1, lon: 1 });
    drop.setTitle('Depot');
    deps.savePlace.mockRejectedValueOnce(new Error('offline'));
    expect(await drop.save()).toBe(false);
    expect(drop.naming).toEqual({ lat: 1, lon: 1, title: 'Depot' });
    expect(deps.notify).toHaveBeenCalledWith('Could not save place: offline', 'danger', 6000);
  });

  it('lets Escape go of the pin waiting before the mode ends', () => {
    const drop = make();
    drop.start();
    expect(drop.cancel()).toBe(false);
    drop.place({ lat: 1, lon: 1 });
    expect(drop.cancel()).toBe(true);
    expect(drop.naming).toBe(null);
    expect(drop.armed).toBe(true);
    drop.place({ lat: 1, lon: 1 });
    drop.stop();
    expect(drop.naming).toBe(null);
  });
});

describe('the leads on the map', () => {
  it('draws each in the scene’s colour with its number, and the pin waiting for its name', () => {
    const drop = make();
    held = SCENE;
    drop.draw();
    const shapes = declared.at(-1);
    expect(shapes.map((s) => s.id)).toEqual(['lead-ld_1', 'lead-ld_2']);
    expect(shapes[1].html).toContain(sceneColorAt(2));
    expect(shapes[1].html).toContain('>4</text>');
    expect(shapes[1]).toMatchObject({ draggable: true, at: { lat: 3, lon: 4 }, title: 'Lead 4: drag to move, click to centre' });

    held = null;
    drop.at({ lat: 9, lon: 9 });
    drop.draw();
    expect(declared.at(-1).map((s) => s.id)).toEqual(['naming']);
  });

  it('centres the map on a lead clicked, moves one dragged, and takes the click a drag ends in for none', async () => {
    const drop = make();
    held = SCENE;
    drop.draw();
    const [first] = declared.at(-1);
    first.onClick();
    expect(deps.centre).toHaveBeenCalledWith({ lat: 1, lon: 2 });

    first.onDragStart();
    first.onDrag({ lat: 1.5, lon: 2.5 });
    await first.onDragEnd();
    expect(deps.moveLead).toHaveBeenCalledWith('ld_1', { lat: 1.5, lon: 2.5 });
    first.onClick();
    expect(deps.centre).toHaveBeenCalledTimes(1);
  });

  it('writes only a colour and a number into the mark', () => {
    expect(leadSvg(3, '"><script>')).toContain('style="fill: #e5484d"');
    expect(leadSvg(3, 'var(--anno-4)')).toContain('style="fill: var(--anno-4)"');
    expect(leadSvg(3, 'var(--x); background: url(x)')).toContain('style="fill: #e5484d"');
    expect(leadSvg('<b>', '#123456')).not.toContain('<b>');
    expect(leadSvg(12, '#123456')).toContain('font-size="9.5"');
  });
});
