import { describe, expect, it } from 'vitest';
import { FORMATS, GALLERY, formatPage, readyTemplate, relaid } from './gallery.js';
import { MAP_KINDS, MAX_MAPS, THEMES, fromTemplate, mapCount, onPaper, pageSize, templateOf } from './page.js';
import { TEXT_STYLES, mutedOf } from './design.js';

const view = { lat: 44.6, lon: 33.6, zoom: 9, bearing: 0 };

describe('the ready plates', () => {
  it('lay every element inside the page, on every paper, each with its own id', () => {
    for (const entry of GALLERY) {
      for (const page of [null, ...FORMATS.map(([, , paper]) => paper)]) {
        const data = readyTemplate(entry.id, page);
        const { width, height } = pageSize(data.page);
        const ids = data.elements.map((element) => element.id);
        expect(new Set(ids).size, entry.id).toBe(ids.length);
        const maps = new Set(data.elements.filter((element) => element.kind === 'map').map((element) => element.id));
        for (const element of data.elements) {
          const [x, y, w, h] = element.box;
          const where = `${entry.id} on ${data.page.paper} ${data.page.orientation}: ${element.id}`;
          expect(w > 0 && h > 0 && x >= -0.5 && y >= -0.5 && x + w <= width + 0.6 && y + h <= height + 0.6, where).toBe(true);
          if (element.of) expect(maps.has(element.of), where).toBe(true);
          if (element.role) expect(TEXT_STYLES[element.role], where).toBeDefined();
        }
        expect(mapCount(data.elements)).toBeLessThanOrEqual(MAX_MAPS);
        // the maps under everything else
        const firstOther = data.elements.findIndex((element) => !MAP_KINDS.includes(element.kind));
        expect(data.elements.slice(firstOther).some((element) => element.kind === 'map')).toBe(false);
      }
    }
  });

  it('carry the Azimut logo alone, in the source line\'s ink, in room of its own on every paper', () => {
    const touches = (a, b) => a[0] < b[0] + b[2] - 0.05 && b[0] < a[0] + a[2] - 0.05 && a[1] < b[1] + b[3] - 0.05 && b[1] < a[1] + a[3] - 0.05;
    const holds = (outer, inner) => outer[0] <= inner[0] && outer[1] <= inner[1] && outer[0] + outer[2] >= inner[0] + inner[2] && outer[1] + outer[3] >= inner[1] + inner[3];
    for (const entry of GALLERY) {
      for (const page of [null, ...FORMATS.map(([, , paper]) => paper)]) {
        const data = readyTemplate(entry.id, page);
        const where = `${entry.id} on ${data.page.paper} ${data.page.orientation}`;
        const logos = data.elements.filter((element) => element.kind === 'brand');
        expect(logos, where).toHaveLength(1);
        const [logo] = logos;
        // the mark and the name, no "Made with" before them
        expect(logo.text, where).toBe('');
        expect(logo.colour, where).toBe(mutedOf(data.theme));
        const { width } = pageSize(data.page);
        const [x, , w, h] = logo.box;
        expect(h >= 3.5 && h <= 6.5, where).toBe(true);
        expect(x + w, where).toBeLessThanOrEqual(width - 5);
        // nothing else stands on it but the map it is set over and the card it signs
        for (const other of data.elements) {
          if (other === logo || other.kind === 'map' || (other.kind === 'shape' && holds(other.box, logo.box))) continue;
          expect(touches(logo.box, other.box), `${where}: ${other.id}`).toBe(false);
        }
      }
    }
  });

  it('open on their own paper and look, and remember which they were', () => {
    const data = readyTemplate('situation');
    expect(data.page).toEqual(formatPage('report'));
    expect(data.theme.preset).toBe('newsroom');
    expect(data.ready).toBe('situation');
    expect(data.elements.find((element) => element.id === 'map').basemap).toBe(THEMES.newsroom.ground);
    const plate = fromTemplate(data, { view, layers: ['front'] });
    expect(plate.ready).toBe('situation');
    expect(plate.elements.find((element) => element.id === 'map').layers).toEqual([{ name: 'front', hidden: [], stroke: 1, icons: 1 }]);
    // a template made of it is the analyst's layout from then on
    expect(templateOf(plate).ready).toBeUndefined();
    expect(readyTemplate('nothing')).toBe(null);
  });

  it('say what goes in their empty pictures, and draw a locator as a globe', () => {
    expect(readyTemplate('geolocation').elements.find((element) => element.kind === 'image').text).toBe('The footage, a still');
    expect(readyTemplate('locator').elements.find((element) => element.kind === 'inset').globe).toBe(true);
    // a detail of the main map is framed closer
    const plate = fromTemplate(readyTemplate('locator'), { view });
    expect(plate.elements.find((element) => element.id === 'detail').view.zoom).toBe(11.5);
  });
});

describe('a plate laid out again for another paper', () => {
  it('puts each element of a ready plate where the recipe puts it there, keeping what it holds', () => {
    const plate = fromTemplate(readyTemplate('situation'), { view, layers: ['front'] });
    plate.elements.find((element) => element.id === 'title').text = 'Kherson, October';
    plate.elements.push({ id: 'mine', kind: 'text', box: [100, 100, 20, 10], text: 'added' });
    const story = formatPage('story');
    const again = relaid(plate, story);
    const fresh = readyTemplate('situation', story);
    expect(again.page).toEqual(story);
    expect(again.elements.find((element) => element.id === 'title')).toMatchObject({ text: 'Kherson, October', box: fresh.elements.find((element) => element.id === 'title').box });
    expect(again.elements.find((element) => element.id === 'map').layers[0].name).toBe('front');
    // what was added since keeps its share of the page
    expect(again.elements.find((element) => element.id === 'mine').box).toEqual(onPaper({ ...plate, elements: [plate.elements.at(-1)] }, story).elements[0].box);
  });

  it('keeps any other plate\'s share of the page', () => {
    const plate = { page: formatPage('report'), theme: {}, elements: [{ id: 'x', kind: 'text', box: [10, 10, 50, 10] }] };
    expect(relaid(plate, formatPage('square'))).toEqual(onPaper(plate, formatPage('square')));
  });
});

describe('a ready plate\'s words', () => {
  it('keep what the recipe sets over their style', () => {
    const geolocation = readyTemplate('geolocation');
    expect(geolocation.elements.find((element) => element.id === 'title')).toMatchObject({ role: 'title', size: 18 });
    expect(geolocation.elements.find((element) => element.id === 'coords')).toMatchObject({ role: 'body', weight: 700 });
  });
});
