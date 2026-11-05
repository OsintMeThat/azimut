import { describe, expect, it } from 'vitest';
import { creditParts, plateCredits } from './credits.js';

/** What a page drawn from the relief owes it: Mapterhorn, and the Copernicus DEM licence's notice. */
const RELIEF_CREDIT = '© Mapterhorn, produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and '
  + 'Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved';

/** The credits of one map, read through the plate's own path. */
const mapCredits = (element, sources = {}) => creditParts({ elements: [element] }, sources).map((part) => part.text);

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
      'OpenFreeMap', RELIEF_CREDIT, 'GeoConfirmed — geoconfirmed.org', 'Esri, Maxar']);
  });

  it('owes the heights to a topographic ground and to a map drawn in 3D, shaded or not', () => {
    const relief = { sources: [{ attribution: '© Mapterhorn' }] };
    const providers = [{ id: 'esri-world-imagery', attribution: 'Esri' }];
    expect(mapCredits({ kind: 'map', basemap: 'plain-topo', overlays: [] }, { relief })).toContain(RELIEF_CREDIT);
    expect(mapCredits({ kind: 'map', basemap: 'esri-world-imagery', overlays: [], terrain: 1.5 }, { providers, relief })).toEqual(['Esri', RELIEF_CREDIT]);
    expect(mapCredits({ kind: 'map', basemap: 'plain', overlays: [] }, { relief })).not.toContain(RELIEF_CREDIT);
  });

  it('names a Wayback map by its dated release, once', () => {
    const providers = [{ id: 'esri-wayback', attribution: 'Esri, Maxar · World Imagery Wayback' }];
    const releases = [{ release: 7, date: '2026-09-24' }];
    const said = plateCredits({ elements: [{ id: 'map', kind: 'map', basemap: 'esri-wayback', release: 7, overlays: [] }] }, { providers, releases });
    expect(said).toBe('Esri, Maxar · World Imagery Wayback, release of 2026-09-24');
    // a release whose date is not known yet keeps the provider's own words
    expect(mapCredits({ kind: 'map', basemap: 'esri-wayback', overlays: [] }, { providers })).toEqual(['Esri, Maxar · World Imagery Wayback']);
  });

  it('owes the heights to a ground that shades its own relief, and to the relief asked over imagery', () => {
    const relief = { sources: [{ attribution: '© Mapterhorn' }] };
    const providers = [{ id: 'esri-world-imagery', attribution: 'Esri' }];
    expect(mapCredits({ kind: 'map', basemap: 'plain-news', overlays: [] }, { relief })).toContain(RELIEF_CREDIT);
    expect(mapCredits({ kind: 'map', basemap: 'esri-world-imagery', overlays: ['relief'] }, { providers, relief })).toEqual(['Esri', RELIEF_CREDIT]);
    expect(mapCredits({ kind: 'map', basemap: 'plain-grey', overlays: [] }, { relief })).not.toContain(RELIEF_CREDIT);
  });

  it('credits a Sentinel-2 cloudless map with its own year\'s words and licence', () => {
    const providers = [{ id: 's2cloudless', attribution: 'newest words' }];
    const years = [{ year: 2025, attribution: 'EOxCloudless 2025 · CC BY-NC-SA 4.0, non-commercial use' }, { year: 2016, attribution: 'EOxCloudless 2016 · CC BY 4.0' }];
    expect(mapCredits({ kind: 'map', basemap: 's2cloudless', year: 2016, overlays: [] }, { providers, years })).toEqual(['EOxCloudless 2016 · CC BY 4.0']);
    // no year of its own: the newest
    expect(mapCredits({ kind: 'map', basemap: 's2cloudless', overlays: [] }, { providers, years })).toEqual(['EOxCloudless 2025 · CC BY-NC-SA 4.0, non-commercial use']);
    // before the years are read, the provider's own words
    expect(mapCredits({ kind: 'map', basemap: 's2cloudless', overlays: [] }, { providers })).toEqual(['newest words']);
  });

  it('owes nobody for a layer of the analyst\'s own, and still owes the source of a copy', () => {
    const rows = [{ name: 'file', title: 'My layer', source: { kind: 'file', name: 'sightings.kml' } }, { name: 'bare', title: 'Bare' },
      { name: 'copy', title: 'Copy', editable: true, origin: { source: { kind: 'geoconfirmed', name: 'GeoConfirmed Ukraine' } } }];
    const map = { kind: 'map', basemap: 'esri-world-imagery', overlays: [], layers: [{ name: 'file' }, { name: 'bare' }, { name: 'copy' }] };
    const said = mapCredits(map, { providers: [{ id: 'esri-world-imagery', attribution: 'Esri' }], rows });
    expect(said).toEqual(['Esri', 'GeoConfirmed Ukraine — geoconfirmed.org']);
    expect(said.join(' ')).not.toContain('added by the analyst');
  });

  it('lets the analyst take a layer\'s or a feature\'s credit off, never what a ground\'s terms ask for', () => {
    const providers = [{ id: 'esri-world-imagery', attribution: 'Esri' }];
    const rows = [{ name: 'gc', title: 'GeoConfirmed', source: { kind: 'geoconfirmed' } }];
    const spec = { elements: [{ id: 'map', kind: 'map', basemap: 'esri-world-imagery', overlays: [], layers: [{ name: 'gc' }] }] };
    const sources = { providers, rows, extra: ['Photo: a reporter'] };
    expect(creditParts(spec, sources)).toEqual([{ text: 'Esri', owed: true }, { text: 'GeoConfirmed — geoconfirmed.org', owed: false },
      { text: 'Photo: a reporter', owed: false }]);
    expect(plateCredits(spec, sources, ['GeoConfirmed — geoconfirmed.org', 'Esri'])).toBe('Esri · Photo: a reporter');
  });

  it('prints what the relief\'s licences ask of a page drawn from it', () => {
    const fallback = 'Terrain Tiles, Mapzen and AWS Open Data: Europe terrain data produced using Copernicus data';
    const relief = { sources: [{ attribution: 'Terrain Tiles, Mapzen and AWS Open Data', published: fallback }] };
    expect(mapCredits({ kind: 'map', basemap: 'plain-topo', overlays: [] }, { relief })).toContain(fallback);
    // an answer that lists only the short credit still owes the notice
    expect(mapCredits({ kind: 'map', basemap: 'plain-topo', overlays: [] }, { relief: { sources: [{ attribution: '© Mapterhorn' }] } }))
      .toContain(RELIEF_CREDIT);
  });

  it('names a Sentinel-2 map by the day of its one pass, credited with its year', () => {
    // the backend lists the basemap with the notice and no year: a map dates it
    const providers = [{ id: 'sentinel2', attribution: 'Contains modified Copernicus Sentinel data' }];
    expect(mapCredits({ kind: 'map', basemap: 'sentinel2', acquired: '2026-05-12', overlays: [] }, { providers }))
      .toEqual(['Contains modified Copernicus Sentinel data 2026', 'Sentinel-2 pass of 2026-05-12']);
    expect(mapCredits({ kind: 'map', basemap: 'sentinel2', overlays: [] }, { providers }))
      .toEqual(['Contains modified Copernicus Sentinel data']);
  });
});
