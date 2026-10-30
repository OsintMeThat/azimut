import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectorWidth, mapHeightFor } from './inspector.js';

afterEach(() => vi.unstubAllGlobals());

describe('the Horizon inspector width', () => {
  it('opens at the width the layout was drawn for, the map 250 px tall', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    expect(inspectorWidth.loadWidth()).toBe(340);
    expect(mapHeightFor(inspectorWidth.DEFAULT_W)).toBe(250);
  });

  it('grows the small map with it, in the same shape', () => {
    expect(mapHeightFor(560)).toBe(412);
    expect(mapHeightFor(300)).toBe(221);
  });

  it('stays wide enough for the settings and leaves the view most of the window', () => {
    expect(inspectorWidth.clampWidth(120, 1900)).toBe(300);
    expect(inspectorWidth.clampWidth(900, 1900)).toBe(560);
    // a laptop window caps it under half, whatever was dragged on a wider screen
    expect(inspectorWidth.clampWidth(560, 1000)).toBe(450);
  });

  it('remembers the width under its own key', () => {
    const held = new Map([['azimut:horizonSideW', '480']]);
    vi.stubGlobal('localStorage', { getItem: (key) => held.get(key) ?? null, setItem: (key, value) => held.set(key, value) });
    expect(inspectorWidth.loadWidth()).toBe(480);
    inspectorWidth.saveWidth(420);
    expect(held.get('azimut:horizonSideW')).toBe('420');
  });
});
