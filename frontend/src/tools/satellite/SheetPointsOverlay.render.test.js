// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * What the sheet layer asks the map to draw.
 *
 * The saved and Timeline layers are driven end to end in the browser
 * (`e2e/saved-relations.spec.js`, `e2e/timeline.spec.js`); this one is reached
 * only through a sheet's own column menu, so it is exercised here instead —
 * against the shapes it declares, which is all it produces.
 */

const drawn = [];
const surface = {
  set: (shapes) => drawn.push(shapes),
  clear: vi.fn(),
  destroy: vi.fn(),
};
vi.mock('../../lib/map/surface.js', () => ({ createSurface: () => surface }));

const { default: SheetPointsOverlay } = await import('./SheetPointsOverlay.svelte');

let held = null;

function draw(points) {
  drawn.length = 0;
  const target = document.createElement('div');
  document.body.appendChild(target);
  held = mount(SheetPointsOverlay, { target, props: { engine: {}, points } });
  flushSync();
  return drawn.at(-1);
}

afterEach(() => {
  if (held) unmount(held);
  held = null;
});

describe('a sheet column on the map', () => {
  it('draws a precise point as a pin and nothing else', () => {
    const shapes = draw([{ lat: 48.8584, lon: 2.2945, decimals: 6, label: 'Quai sud' }]);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({ kind: 'marker', at: { lat: 48.8584, lon: 2.2945 } });
    expect(shapes[0].title).toBe('Quai sud');
    expect(shapes[0].html).not.toContain('sheet-mark-coarse');
  });

  it('draws how coarsely a cell was written, as the circle it is', () => {
    // "48.85, 2.35" is a claim about a kilometre, not about a building, and a
    // worklist of two-decimal coordinates looks like a worklist of addresses
    // until the circles are drawn
    const shapes = draw([{ lat: 48.85, lon: 2.29, decimals: 2, label: 'Pont nord' }]);
    expect(shapes).toHaveLength(2);
    const [area, pin] = shapes;
    // the shape first, so the pin stays on top of its own imprecision
    expect(area.kind).toBe('circle');
    expect(area.radiusM).toBeGreaterThan(500);
    expect(area.style.interactive).toBe(false); // never steals the pin's click
    expect(pin.kind).toBe('marker');
    expect(pin.html).toContain('sheet-mark-coarse');
    expect(pin.title).toContain('about');
    expect(pin.title).toContain('2 decimals');
  });

  it('names the row on hover, above the pin', () => {
    const [pin] = draw([{ lat: 1, lon: 2, decimals: 6, label: 'Rue basse' }]);
    expect(pin.tip).toEqual({ text: 'Rue basse', direction: 'top', offset: [0, -12] });
  });

  it('draws a whole column in one pass', () => {
    const shapes = draw([
      { lat: 1, lon: 2, decimals: 6, label: 'a' },
      { lat: 3, lon: 4, decimals: 1, label: 'b' },
      { lat: 5, lon: 6, decimals: 6, label: 'c' },
    ]);
    expect(shapes.filter((shape) => shape.kind === 'marker')).toHaveLength(3);
    expect(shapes.filter((shape) => shape.kind === 'circle')).toHaveLength(1);
  });

  it('takes its layer down with it: the points travel, they are never filed', () => {
    draw([{ lat: 1, lon: 2, decimals: 6, label: 'a' }]);
    unmount(held);
    held = null;
    expect(surface.destroy).toHaveBeenCalled();
  });
});
