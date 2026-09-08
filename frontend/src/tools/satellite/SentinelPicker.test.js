import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import SentinelPicker from './SentinelPicker.svelte';

/** The picker reads one store (`state/sentinel.svelte.js`); this is a stand-in
 *  holding the state a case would be in, with the actions stubbed. */
function props({ s2 = {}, ...overrides } = {}) {
  return {
    s2: {
      menuOpen: true,
      layer: 'TRUE_COLOR',
      layers: [{ id: 'TRUE_COLOR', label: 'True colour' }],
      layerHint: '',
      layersSource: 'instance',
      date: '',
      maxcc: 100,
      month: '2026-05',
      passes: { '2026-05-11': { cloud: 4, granules: 1 } },
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
      ...s2,
    },
    maxccLabel: (v) => (v >= 100 ? 'Any cloud' : `Up to ${v}%`),
    monthLabel: () => 'May 2026',
    monthGrid: () => ['2026-05-11'],
    cloudClass: () => 'clear',
    cloudLabel: () => '4% cloud',
    ...overrides,
  };
}

describe('SentinelPicker date safety', () => {
  it('disables dates from the previous map location', () => {
    const { body } = render(SentinelPicker, { props: props({ s2: { stale: true } }) });
    expect(body).toContain('Refreshing dates for this location.');
    expect(body).toMatch(/<button[^>]*class="cal-day[^>]*disabled[^>]*>/);
  });

  it('marks a checked date that has no imagery as unavailable', () => {
    const { body } = render(SentinelPicker, {
      props: props({ s2: { dateStatus: () => false } }),
    });
    expect(body).toMatch(/class="cal-day clear [^"]*has unavailable"/);
    expect(body).toContain('No imagery at the crosshair on 2026-05-11');
    expect(body).toMatch(/<button[^>]*class="cal-day clear [^"]*has unavailable"[^>]*disabled/);
  });

  it('greys out a pass over the cloud ceiling', () => {
    const { body } = render(SentinelPicker, {
      props: props({
        s2: {
          maxcc: 20,
          passes: { '2026-05-11': { cloud: 38, granules: 1 } },
          filtered: () => true,
        },
        cloudLabel: () => '38% cloud',
      }),
    });
    // above the ceiling Sentinel Hub renders nothing, so the day says why
    // rather than costing a tile to find out
    expect(body).toContain('over the 20% ceiling');
    expect(body).toMatch(/<button[^>]*class="cal-day[^"]*unavailable"[^>]*disabled/);
  });

  it('shows the ceiling and only commits it on release', () => {
    const setMaxcc = vi.fn();
    const { body } = render(SentinelPicker, { props: props({ s2: { maxcc: 20, setMaxcc } }) });
    expect(body).toContain('Up to 20%');
    expect(body).toMatch(/<input[^>]*type="range"/);
    // dragging must not spend a tile per step: nothing fires from rendering
    expect(setMaxcc).not.toHaveBeenCalled();
  });

  it('shows which date is being checked', () => {
    const { body } = render(SentinelPicker, {
      props: props({ s2: { verifyingDate: '2026-05-11' } }),
    });
    expect(body).toMatch(/class="cal-day clear [^"]*has verifying"/);
    expect(body).toContain('Checking imagery for 2026-05-11');
  });
});
