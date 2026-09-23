import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import RadarPicker from './RadarPicker.svelte';

function props(s1 = {}) {
  return {
    s1: {
      menuOpen: true,
      month: '2026-05',
      pass: { date: '2026-05-14', time: '05:42:10', orbit: 'descending' },
      passes: [
        { date: '2026-05-14', time: '17:33:02', orbit: 'ascending' },
        { date: '2026-05-14', time: '05:42:10', orbit: 'descending' },
      ],
      busy: false,
      note: '',
      stale: false,
      peer: null,
      toggleMenu: vi.fn(),
      stepMonth: vi.fn(),
      loadPasses: vi.fn(),
      pick: vi.fn(),
      ...s1,
    },
  };
}

describe('the radar pass picker', () => {
  it('names a pass by its day, its UTC time and the way it flew', () => {
    const { body } = render(RadarPicker, { props: props() });
    expect(body).toContain('2026-05-14 · 05:42 UTC');
    expect(body).toContain('17:33 UTC');
    expect(body).toContain('↓');
    expect(body).toContain('Most recent pass');
    expect(body).toContain('billed as one Copernicus request');
  });

  it('marks the passes on the other side’s track', () => {
    const { body } = render(RadarPicker, { props: props({ peer: { date: '2026-05-02', time: '05:42:40' } }) });
    expect(body.match(/same track/g)).toHaveLength(1);
  });

  it('says a failed read failed', () => {
    const { body } = render(RadarPicker, {
      props: props({ passes: [], note: 'Could not read this month’s passes: offline' }),
    });
    expect(body).toContain('Could not read');
  });
});
