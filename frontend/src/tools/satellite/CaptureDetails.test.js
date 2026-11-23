import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import CaptureDetails from './CaptureDetails.svelte';

/**
 * A capture taken with the layers on the map says so in its details, so it is never
 * read as the imagery alone; a capture of the imagery says nothing of the kind.
 */
const row = { id: 'c1', kind: 'capture', title: 'Bridge', lat: 1, lon: 2, path: 'media/a.png', provider: 'Esri', zoom: 16 };
const show = (extra) =>
  render(CaptureDetails, { props: { row: { ...row, ...extra }, caseId: 'case-1', coords: () => '1, 2', onsave: () => {}, onclose: () => {} } }).body;

describe('a capture’s details', () => {
  it('lists the layers drawn over the imagery, the analyst’s by name', () => {
    const body = show({ layers: ['boundaries', 'places', 'places-names', 'added', 'leads'], layer_names: ['Front line'] });
    expect(body).toContain('data-testid="capture-layers"');
    expect(body).toContain('Borders, Places with names, Front line, Leads');
  });

  it('says nothing of layers for the imagery alone', () => {
    expect(show({})).not.toContain('capture-layers');
  });
});
