import { describe, expect, it } from 'vitest';
import { mapCredits, plateCredits } from './credits.js';

describe('a plate\'s credits', () => {
  it('owes the plain ground, its relief, the imagery and a followed layer, each once', () => {
    const relief = { sources: [{ attribution: '© Mapterhorn' }] };
    const providers = [{ id: 'esri-world-imagery', attribution: 'Esri, <b>Maxar</b>' }];
    const rows = [{ name: 'gc', title: 'GeoConfirmed', source: { kind: 'geoconfirmed' } }, { name: 'mine', title: 'Mine', editable: true }];
    const spec = { elements: [
      { id: 'map', kind: 'map', basemap: 'plain', overlays: ['relief'], layers: [{ name: 'gc' }, { name: 'mine' }] },
      { id: 'inset', kind: 'inset', basemap: 'esri-world-imagery', overlays: [] },
      { id: 'other', kind: 'map', basemap: 'plain', overlays: [] },
    ] };
    expect(mapCredits(spec.elements[1], { providers })).toEqual(['Esri, Maxar']);
    const said = plateCredits(spec, { providers, rows, relief });
    expect(said.split(' · ')).toEqual(['© OpenMapTiles © OpenStreetMap contributors · OpenFreeMap'.split(' · ')[0],
      'OpenFreeMap', '© Mapterhorn', 'GeoConfirmed — geoconfirmed.org', 'Esri, Maxar']);
  });
});
