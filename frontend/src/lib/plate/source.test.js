import { describe, expect, it } from 'vitest';
import { groundSaid, imageryDay, imagerySaid, layeredMaps, layersDayOf, withLayer } from './source.js';

const grounds = [['plain', 'Plain'], ['esri-world-imagery', 'Esri World Imagery'], ['esri-wayback', 'World Imagery Wayback, dated'],
  ['s2cloudless', "Sentinel-2 cloudless, a year's mosaic"], ['sentinel2', 'Sentinel-2, one dated pass'], ['osm', 'OpenStreetMap']];
const releases = [{ release: 900, date: '2025-02-20' }, { release: 41, date: '2024-03-12' }];
const years = [{ year: 2024 }, { year: 2021 }];

describe('where a plate map gets what it draws', () => {
  it('says the day or the year a picture ground was taken', () => {
    expect(groundSaid({ basemap: 'esri-wayback', release: 41 }, { grounds, releases })).toEqual({ name: 'World Imagery Wayback, dated', when: '12 Mar 2024', drawn: false, undated: false });
    // a Wayback map with no release of its own shows the newest
    expect(groundSaid({ basemap: 'esri-wayback' }, { grounds, releases }).when).toBe('20 Feb 2025');
    expect(groundSaid({ basemap: 's2cloudless', year: 2021 }, { grounds, years }).when).toBe('2021');
    expect(groundSaid({ basemap: 'sentinel2', acquired: '2025-10-03' }, { grounds }).when).toBe('3 Oct 2025');
    expect(groundSaid({ basemap: 'sentinel2' }, { grounds }).when).toBe('no pass picked yet');
  });

  it('marks imagery stitched from several days apart from a ground drawn from map data', () => {
    expect(groundSaid({ basemap: 'esri-world-imagery' }, { grounds })).toEqual({ name: 'Esri World Imagery', when: '', drawn: false, undated: true });
    for (const basemap of ['plain', 'plain-topo', 'osm', '']) expect(groundSaid({ basemap }, { grounds }).drawn).toBe(true);
    // a ground no longer offered is still named, by its id
    expect(groundSaid({ basemap: 'mystery' }, { grounds }).name).toBe('mystery');
  });

  it('writes {imagery} as it always has: a cloudless year, a pass, a Wayback day, else nothing', () => {
    expect(imagerySaid({ basemap: 's2cloudless', year: 2021 }, { years })).toBe("Sentinel-2 cloudless 2021, a year's mosaic");
    expect(imagerySaid({ basemap: 'sentinel2', acquired: '2025-10-03', product: '' })).toBe('Sentinel-2 pass of 2025-10-03');
    expect(imagerySaid({ basemap: 'esri-wayback', release: 41 }, { releases })).toBe('2024-03-12');
    expect(imagerySaid({ basemap: 'esri-world-imagery' }, { releases })).toBe('');
    expect(imagerySaid(null)).toBe('');
  });

  it('lists the maps that draw layers, insets left out, and toggles a layer on one', () => {
    const spec = { elements: [{ id: 'm', kind: 'map' }, { id: 'i', kind: 'inset' }, { id: 'd', kind: 'map', of: 'm' }, { id: 't', kind: 'text' }] };
    expect(layeredMaps(spec).map((map) => map.id)).toEqual(['m', 'd']);
    const map = { layers: [{ name: 'front', hidden: ['x'], stroke: 2, icons: 1 }] };
    expect(withLayer(map, 'strikes')).toEqual([map.layers[0], { name: 'strikes', hidden: [], stroke: 1, icons: 1 }]);
    expect(withLayer(map, 'front')).toEqual([]);
    expect(withLayer({}, 'front')).toEqual([{ name: 'front', hidden: [], stroke: 1, icons: 1 }]);
  });
});

describe('a map that draws its layers on its imagery\'s day', () => {
  const releases = [{ release: 900, date: '2025-02-20' }, { release: 41, date: '2024-03-12' }];
  it('knows the day of a Wayback release or a Sentinel-2 pass, and of no other ground', () => {
    expect(imageryDay({ basemap: 'esri-wayback', release: 41 }, { releases })).toBe('2024-03-12');
    expect(imageryDay({ basemap: 'sentinel2', acquired: '2025-10-03' })).toBe('2025-10-03');
    expect(imageryDay({ basemap: 'sentinel2' })).toBe('');
    expect(imageryDay({ basemap: 'esri-world-imagery' }, { releases })).toBe('');
    expect(imageryDay({ basemap: 's2cloudless', year: 2021 })).toBe('');
  });

  it('reads the plate\'s day unless told otherwise and the day is known', () => {
    expect(layersDayOf({ basemap: 'esri-wayback', release: 41 }, { releases })).toBeNull();
    expect(layersDayOf({ basemap: 'esri-wayback', release: 41, layers_on: 'imagery' }, { releases })).toBe('2024-03-12');
    // the releases not read yet, or a ground with no day: the plate's day, never a guess
    expect(layersDayOf({ basemap: 'esri-wayback', release: 41, layers_on: 'imagery' })).toBeNull();
    expect(layersDayOf({ basemap: 'esri-world-imagery', layers_on: 'imagery' }, { releases })).toBeNull();
  });
});
