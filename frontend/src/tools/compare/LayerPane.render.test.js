import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import LayerPane from './LayerPane.svelte';

const FIRES = { id: 'firms', label: 'Active fires', hint: 'Thermal detections from NASA FIRMS' };

function pane(props) {
  return render(LayerPane, {
    props: {
      letter: 'A',
      present: true,
      layers: [FIRES],
      overlays: ['firms'],
      firms: { sensor: 'viirs', window: '7d', first: '', last: '' },
      night: {},
      firmsSensors: [{ id: 'viirs', label: 'VIIRS' }],
      firesKeyed: true,
      savedCount: 0,
      ontoggle: () => {},
      onfirms: () => {},
      onnight: () => {},
      oncopy: () => {},
      onclear: () => {},
      ...props,
    },
  }).body;
}

describe('the fire layer on one side of Compare', () => {
  it('says a refused key is refused rather than missing', () => {
    const body = pane({ firesKeyed: false, firesState: 'refused' });
    expect(body).toContain('FIRMS does not know this key');
    expect(body).not.toContain('Add a NASA FIRMS key');
  });

  it('keeps its settings and says when a spent allowance refills', () => {
    const body = pane({ firesPaused: { until: '2026-09-26T12:00:00+00:00', used: 4990, of: 5000 } });
    expect(body).toContain('Active fires settings for imagery A');
    expect(body).toContain('FIRMS allowance used up. It refills within ten minutes.');
  });

  it('explains the two colours of a week', () => {
    expect(pane({})).toContain('Red: the last 24 hours. Amber: before them.');
  });
});
