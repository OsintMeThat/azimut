/**
 * A stand-in for `state/sentinel.svelte.js` with the actions stubbed.
 *
 * It lives in a `.svelte.js` file so `layer` is really reactive: the picker
 * binds a select straight to it, and a plain object would make that binding
 * silently one-way in a test while working in the app.
 */
import { vi } from 'vitest';
import { isDraftLayer } from '../../lib/customLayers.js';

export function sentinelStub(overrides = {}) {
  let layer = $state(overrides.layer ?? 'TRUE_COLOR');
  const layers = $state(
    overrides.layers ?? [
      { id: 'TRUE_COLOR', label: 'True colour' },
      { id: 'SWIR', label: 'SWIR' },
    ]
  );
  return {
    get layer() {
      return layer;
    },
    set layer(value) {
      layer = value;
    },
    get layers() {
      return layers;
    },
    get draft() {
      return isDraftLayer(layer);
    },
    menuOpen: true,
    layerHint: '',
    layersSource: 'instance',
    date: '',
    latest: '',
    day: '',
    undated: false,
    maxcc: 100,
    month: '2026-05',
    passes: {},
    passesBusy: false,
    passesNote: '',
    stale: false,
    verifyingDate: '',
    dateStatus: () => undefined,
    filtered: () => false,
    toggleMenu: vi.fn(),
    loadLayers: vi.fn(),
    stepMonth: vi.fn(),
    loadPasses: vi.fn(),
    pickDate: vi.fn(),
    clearDate: vi.fn(),
    setMaxcc: vi.fn(),
    rememberLayer: vi.fn(),
    ...overrides,
  };
}
