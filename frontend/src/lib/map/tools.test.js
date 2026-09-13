import { describe, expect, it } from 'vitest';
import {
  MAP_ACTIONS,
  MAP_LAYERS,
  MAP_MODES,
  arm,
  armedId,
  cursorOf,
  disarm,
  hasPanel,
  railEntries,
  railSections,
} from './tools.js';

/**
 * Handlers the way the host builds them, over a plain object instead of four
 * Svelte stores. The exclusion rule is the whole reason this registry exists —
 * it was previously spread over `toggleSunMode`, `toggleGridMode`,
 * `setMeasureMode` and `toggleSelect`, each calling the others — so it is
 * tested here, without a browser or a map.
 */
function stubHandlers(on = {}) {
  const state = { measure: false, grid: false, sky: false, capture: false, ...on };
  const handlers = {};
  for (const id of Object.keys(state)) {
    handlers[id] = {
      isOn: () => state[id],
      open: () => (state[id] = true),
      close: () => (state[id] = false),
    };
  }
  return { handlers, state };
}

describe('the rail', () => {
  it('leaves out a mode that is armed from somewhere else', () => {
    const ids = railEntries().map((entry) => entry.id);
    expect(ids).toContain('measure');
    // the capture marquee is armed from the Capture button, not from a toolbox
    expect(ids).not.toContain('capture');
  });

  it('files one-shot actions among the modes, tagged by kind', () => {
    const entries = railEntries();
    const reference = entries.find((entry) => entry.id === 'reference');
    expect(reference.kind).toBe('action');
    expect(entries.find((entry) => entry.id === 'measure').kind).toBe('mode');
  });

  it('cuts the entries into the sections it draws a line between', () => {
    const sections = railSections(railEntries());
    expect(sections.map((section) => section.group)).toEqual(['work', 'read']);
    expect(sections[0].entries.map((entry) => entry.id)).toEqual(['measure', 'grid']);
    expect(sections[1].entries.map((entry) => entry.id)).toEqual(['sky', 'reference']);
  });

  it('keeps the rail short enough to read', () => {
    // the survival rule from the design: past seven seats a tool joins a group
    // with a flyout rather than taking the eighth
    expect(railEntries().length).toBeLessThanOrEqual(7);
  });
});

describe('arming', () => {
  it('arms one mode', () => {
    const { handlers, state } = stubHandlers();
    expect(arm(handlers, 'grid')).toBe('grid');
    expect(state.grid).toBe(true);
  });

  it('closes everything else, whatever was open', () => {
    const { handlers, state } = stubHandlers({ measure: true, capture: true });
    arm(handlers, 'sky');
    expect(state).toEqual({ measure: false, grid: false, sky: true, capture: false });
  });

  it('disarms the mode that was already armed', () => {
    const { handlers, state } = stubHandlers({ sky: true });
    expect(arm(handlers, 'sky')).toBe(null);
    expect(state.sky).toBe(false);
  });

  it('never opens a second mode, whichever order they are pressed', () => {
    const { handlers, state } = stubHandlers();
    for (const id of ['measure', 'grid', 'sky', 'capture', 'grid']) arm(handlers, id);
    expect(Object.values(state).filter(Boolean).length).toBeLessThanOrEqual(1);
  });

  it('ignores a mode the host did not wire, and says what is still armed', () => {
    const { handlers, state } = stubHandlers({ grid: true });
    expect(arm(handlers, 'viewshed')).toBe('grid');
    expect(state.grid).toBe(true);
  });

  it('reports nothing armed when nothing is', () => {
    expect(armedId(stubHandlers().handlers)).toBe(null);
  });

  it('disarms everything', () => {
    const { handlers, state } = stubHandlers({ measure: true, grid: true });
    disarm(handlers);
    expect(Object.values(state).some(Boolean)).toBe(false);
  });
});

describe('what the armed mode says about the surface', () => {
  it('hands the surface the cursor for the armed mode', () => {
    expect(cursorOf('measure')).toBe('measuring');
    expect(cursorOf('capture')).toBe('selecting');
  });

  it('says the map is just a map when nothing is armed', () => {
    expect(cursorOf(null)).toBe(null);
    // a mode can change what a click means without changing how it is pointed
    expect(cursorOf('sky')).toBe(null);
  });

  it('opens the panel slot only for a mode that brings one', () => {
    expect(hasPanel('grid')).toBe(true);
    expect(hasPanel('capture')).toBe(false);
    expect(hasPanel(null)).toBe(false);
  });
});

describe('the declarations themselves', () => {
  it('gives every entry an id, a label, an icon and a group', () => {
    for (const entry of [...MAP_MODES, ...MAP_ACTIONS]) {
      expect(entry.id).toBeTruthy();
      expect(entry.label).toBeTruthy();
      expect(entry.icon).toBeTruthy();
      expect(entry.group).toBeTruthy();
    }
  });

  it('keeps every id unique across modes, actions and layers', () => {
    const ids = [...MAP_MODES, ...MAP_ACTIONS, ...MAP_LAYERS].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives no layer a rail seat', () => {
    const rail = new Set(railEntries().map((entry) => entry.id));
    for (const layer of MAP_LAYERS) expect(rail.has(layer.id)).toBe(false);
  });
});
