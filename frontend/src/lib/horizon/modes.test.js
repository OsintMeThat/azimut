import { describe, expect, it } from 'vitest';
import { MODES, modeOf, modeOfView, modeParams } from './modes.js';

describe('Horizon’s modes', () => {
  it('are View, Overlay and Find, in that order', () => {
    expect(MODES.map((one) => one.id)).toEqual(['view', 'overlay', 'find']);
    expect(MODES.every((one) => one.label && one.icon && one.hint)).toBe(true);
  });

  it('mark Find alone as Beta, in its pill and its tooltip', () => {
    const find = MODES.find((one) => one.id === 'find');
    expect(find.tag).toBe('Beta');
    expect(find.hint).toMatch(/^Beta: /);
    expect(MODES.filter((one) => one.tag).map((one) => one.id)).toEqual(['find']);
  });

  it('come back from the address, View for none or one unknown', () => {
    expect(modeOf(new URLSearchParams('ll=1,2&md=find'))).toBe('find');
    expect(modeOf({ md: 'overlay' })).toBe('overlay');
    expect(modeOf(new URLSearchParams('ll=1,2'))).toBe('view');
    expect(modeOf({ md: 'anything' })).toBe('view');
    expect(modeOf(null)).toBe('view');
  });

  it('go into the address, View writing nothing', () => {
    expect(modeParams('view')).toEqual({});
    expect(modeParams('overlay')).toEqual({ md: 'overlay' });
    expect(modeParams('find')).toEqual({ md: 'find' });
    expect(modeParams('nonsense')).toEqual({});
    for (const one of MODES) expect(modeOf(modeParams(one.id))).toBe(one.id);
  });

  it('open a saved view in Overlay when its photo came back, in View when not', () => {
    expect(modeOfView(true)).toBe('overlay');
    expect(modeOfView(false)).toBe('view');
  });
});
