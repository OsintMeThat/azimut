// @vitest-environment happy-dom
/**
 * Settings › General › Appearance, mounted: the accent swatches.
 *
 * A press repaints the whole interface at once (the stamp on <html>), is kept
 * for the next start, and every swatch names its colour on hover.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import GeneralTab from './GeneralTab.svelte';
import { ACCENTS, ACCENT_KEY } from '../../lib/accent.js';
import { setAccent, uiState } from '../../lib/state.svelte.js';

let target;
let app;

function open() {
  target = document.createElement('div');
  document.body.append(target);
  app = mount(GeneralTab, {
    target,
    props: {
      prefs: { coordFormat: 'dd', units: 'metric', quality3d: 'auto' },
      home: { lat: 0, lon: 0, zoom: 3 },
      coordSample: '0.0000, 0.0000',
      savePrefs: () => {},
      saveHome: () => {},
    },
  });
  flushSync();
}

afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  app = null;
  setAccent('amber');
  localStorage.clear();
});

const swatches = () => [...target.querySelectorAll('.swatch')];

describe('the accent colour', () => {
  it('offers every accent, amber pressed by default, each named on hover', () => {
    open();
    expect(swatches().map((s) => s.title)).toEqual(ACCENTS.map((a) => a.label));
    expect(swatches().map((s) => s.getAttribute('aria-label'))).toEqual(ACCENTS.map((a) => a.label));
    expect(target.querySelector('.swatch[aria-pressed="true"]').title).toBe('Amber');
    // the quiet ones stand apart
    expect(target.querySelectorAll('.swatch-gap')).toHaveLength(1);
  });

  it('repaints the interface and remembers the pick', () => {
    open();
    swatches().find((s) => s.title === 'Teal').click();
    flushSync();
    expect(uiState.accent).toBe('teal');
    expect(document.documentElement.dataset.accent).toBe('teal');
    expect(localStorage.getItem(ACCENT_KEY)).toBe('teal');
    expect(target.querySelector('.swatch[aria-pressed="true"]').title).toBe('Teal');

    swatches().find((s) => s.title === 'Amber').click();
    flushSync();
    expect(document.documentElement.dataset.accent).toBeUndefined();
  });

  it('shows a quiet accent as the deep ink it turns to in the light theme', () => {
    uiState.theme = 'light';
    try {
      open();
      const graphite = swatches().find((s) => s.title === 'Graphite');
      expect(graphite.style.getPropertyValue('--swatch')).toBe('#333333');
      expect(swatches().find((s) => s.title === 'Teal').style.getPropertyValue('--swatch')).toBe('#5dc9b3');
    } finally {
      uiState.theme = 'dark';
    }
  });

  it('says what it paints and what it leaves', () => {
    open();
    const row = target.querySelector('.swatches').closest('.row');
    expect(row.textContent).toContain('Accent colour');
    expect(row.textContent).toContain('The logo keeps its amber');
    expect(row.querySelector('.row-label span').title).toMatch(/selection, the main buttons and the tabs/);
  });
});
