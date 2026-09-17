import { describe, expect, it } from 'vitest';
import { ACTIONS, actionsFor, copyRows, nextFocus, openRows, placeMenu } from './contextMenu.js';

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
