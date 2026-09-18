import { describe, expect, it } from 'vitest';
import { ACTIONS, actionsFor, copyRows, nextFocus, openRows, placeMenu, placeSubmenu } from './contextMenu.js';

describe('copying the point', () => {
  it('offers every format the app writes, the analyst’s own first', () => {
    const rows = copyRows(50.4501, 30.5234, 'mgrs');
    expect(rows.map((row) => row.format)).toEqual(['MGRS', 'DD', 'DMS']);
    expect(rows[1].text).toBe('50.450100, 30.523400');
    expect(rows[2].text).toContain('°');
  });

  it('leaves out a format that cannot state the point rather than copying another', () => {
    // MGRS stops short of the poles, and would fall back to decimal degrees
    const rows = copyRows(89.9, 10, 'dd');
    expect(rows.map((row) => row.format)).toEqual(['DD', 'DMS']);
  });

  it('falls back to the app’s order for a format it does not know', () => {
    expect(copyRows(1, 2, 'utm').map((row) => row.format)).toEqual(['DD', 'DMS', 'MGRS']);
  });
});

describe('what the menu offers', () => {
  it('acts on the point, and names each act for the point rather than the centre', () => {
    expect(ACTIONS.map((action) => action.id)).toEqual([
      'lookup',
      'place',
      'measure',
      'sky',
      'history',
      'centre',
    ]);
    for (const action of ACTIONS.filter((entry) => entry.id !== 'lookup')) {
      expect(action.label).toMatch(/here/);
    }
  });

  it('gives a tool the subset it can honour, in the menu’s own order', () => {
    expect(actionsFor(['measure', 'lookup', 'place']).map((action) => action.id))
      .toEqual(['lookup', 'place', 'measure']);
    expect(actionsFor([])).toEqual([]);
    expect(actionsFor(['nothing-here'])).toEqual([]);
  });

  it('opens the external maps on the clicked point, at the current zoom', () => {
    const links = openRows(48.85837123456, 2.29448123456, 18);
    const google = links.find((link) => link.id === 'google');
    expect(google.url).toBe('https://www.google.com/maps/@48.858371,2.294481,18z');
  });
});

describe('where the menu opens', () => {
  const frame = { width: 1000, height: 600 };
  const menu = { width: 240, height: 300 };

  it('opens down and to the right of the cursor', () => {
    expect(placeMenu({ x: 100, y: 80 }, menu, frame)).toEqual({ left: 100, top: 80 });
  });

  it('flips to the other side of the cursor near the right or bottom edge', () => {
    expect(placeMenu({ x: 900, y: 500 }, menu, frame)).toEqual({ left: 660, top: 200 });
  });

  it('stays inside a map too small to flip in', () => {
    const small = { width: 260, height: 200 };
    const at = placeMenu({ x: 20, y: 190 }, menu, small);
    expect(at.left).toBe(8);
    expect(at.top).toBe(8);
  });
});

describe('where the submenu opens', () => {
  const frame = { width: 1000, height: 600 };
  const parent = { left: 100, top: 80, width: 240, rowTop: 300 };
  const submenu = { width: 160, height: 260 };

  it('opens beside the row, so the menu it hangs from never moves', () => {
    // the bug this shape exists for: a list unfolding inside the menu changed
    // its height, and a menu already placed against an edge then had to move
    expect(placeSubmenu(parent, submenu, frame)).toEqual({ left: 342, top: 300 });
  });

  it('flips to the other side when it would run past the right edge', () => {
    const right = { ...parent, left: 760 };

    expect(placeSubmenu(right, submenu, frame).left).toBe(598);
  });

  it('is pushed up rather than clipped when the row is near the bottom', () => {
    // a submenu whose last entry is off the map is a submenu with nine of ten
    expect(placeSubmenu({ ...parent, rowTop: 560 }, submenu, frame).top).toBe(332);
  });

  it('overlaps its parent rather than leaving the map it cannot fit beside it', () => {
    // 240 of menu and 160 of submenu do not both fit in 300: there is no
    // placement that avoids the overlap, and off the map is the worse answer
    const at = placeSubmenu(parent, submenu, { width: 300, height: 200 });

    expect(at.left).toBe(8);
    expect(at.top).toBe(8);
  });
});

describe('moving through the menu with arrows', () => {
  it('wraps at either end', () => {
    expect(nextFocus(4, 3, 1)).toBe(0);
    expect(nextFocus(4, 0, -1)).toBe(3);
  });

  it('starts at the first row when nothing has focus yet', () => {
    expect(nextFocus(4, -1, 1)).toBe(0);
  });

  it('skips rows that cannot be pressed, and gives up on a menu with none', () => {
    expect(nextFocus(4, 0, 1, (index) => index === 1)).toBe(2);
    expect(nextFocus(3, 0, 1, () => true)).toBe(-1);
    expect(nextFocus(0, 0, 1)).toBe(-1);
  });
});
