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

  it('owes the heights to a topographic ground and to a map drawn in 3D, shaded or not', () => {
    const relief = { sources: [{ attribution: '© Mapterhorn' }] };
    const providers = [{ id: 'esri-world-imagery', attribution: 'Esri' }];
    expect(mapCredits({ kind: 'map', basemap: 'plain-topo', overlays: [] }, { relief })).toContain('© Mapterhorn');
    expect(mapCredits({ kind: 'map', basemap: 'esri-world-imagery', overlays: [], terrain: 1.5 }, { providers, relief })).toEqual(['Esri', '© Mapterhorn']);
    expect(mapCredits({ kind: 'map', basemap: 'plain', overlays: [] }, { relief })).not.toContain('© Mapterhorn');
  });

  it('names a Wayback map by its dated release, once', () => {
    const providers = [{ id: 'esri-wayback', attribution: 'Esri, Maxar · World Imagery Wayback' }];
    const releases = [{ release: 7, date: '2026-09-24' }];
    const said = plateCredits({ elements: [{ id: 'map', kind: 'map', basemap: 'esri-wayback', release: 7, overlays: [] }] }, { providers, releases });
    expect(said).toBe('Esri, Maxar · World Imagery Wayback, release of 2026-09-24');
    // a release whose date is not known yet keeps the provider's own words
    expect(mapCredits({ kind: 'map', basemap: 'esri-wayback', overlays: [] }, { providers })).toEqual(['Esri, Maxar · World Imagery Wayback']);
  });
});
