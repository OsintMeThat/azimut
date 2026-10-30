// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { readBlocks, readLinks, fillText, layerCard, featureSize, sizeLine } from './layerCard.js';

describe('readBlocks', () => {
  it('reads a labelled line as its label and its value', () => {
    expect(readBlocks('code: UA\nlayer: OLD26')).toEqual([
      { label: 'code', value: 'UA' },
      { label: 'layer', value: 'OLD26' },
    ]);
  });

  it('keeps prose and columns in the order they were written', () => {
    expect(readBlocks('Seen at dawn\nName: North gate\nnothing since')).toEqual([
      { text: 'Seen at dawn' },
      { label: 'Name', value: 'North gate' },
      { text: 'nothing since' },
    ]);
  });

  it('leaves a sentence with a colon in it alone', () => {
    // no space after the colon, so an address and a time stay one piece of prose
    expect(readBlocks('at 10:30 see https://x.com/a/1')).toEqual([
      { text: 'at 10:30 see https://x.com/a/1' },
    ]);
  });

  it('leaves a long lead-in as prose rather than calling it a label', () => {
    const line = `${'word '.repeat(12)}: value`;
    expect(readBlocks(line)).toEqual([{ text: line }]);
  });

  it('is empty for a feature the source said nothing about', () => {
    expect(readBlocks('')).toEqual([]);
    expect(readBlocks(undefined)).toEqual([]);
  });
});

describe('readLinks', () => {
  it('splits an address out of the words around it', () => {
    expect(readLinks('see https://x.com/a/1 now')).toEqual([
      { text: 'see ' },
      { text: 'https://x.com/a/1', href: 'https://x.com/a/1' },
      { text: ' now' },
    ]);
  });

  it('leaves the punctuation that ended the sentence out of the address', () => {
    expect(readLinks('(https://x.com/a/1).')).toEqual([
      { text: '(' },
      { text: 'https://x.com/a/1', href: 'https://x.com/a/1' },
      { text: ').' },
    ]);
  });

  it('links nothing in a string with no address', () => {
    expect(readLinks('north gate')).toEqual([{ text: 'north gate' }]);
  });
});

describe('fillText', () => {
  it('writes an address as a link that opens away from the app', () => {
    const element = fillText(document.createElement('p'), 'see https://x.com/a/1');
    const link = element.querySelector('a');
    expect(link.href).toBe('https://x.com/a/1');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noreferrer noopener');
  });

  it('never lets the source write markup into the page', () => {
    const element = fillText(document.createElement('p'), '<img src=x onerror=boom>');
    expect(element.querySelector('img')).toBeNull();
    expect(element.textContent).toBe('<img src=x onerror=boom>');
  });
});

describe('layerCard', () => {
  const card = layerCard('Ukraine Control Map v2');

  it('states the name, the group and whose map it came from', () => {
    const element = card({ name: 'Ua Position', category: 'Archives Geos' });
    expect(element.querySelector('h4').textContent).toBe('Ua Position');
    expect(element.querySelector('.layer-card-group').textContent).toBe('Archives Geos');
    expect(element.querySelector('.layer-card-from').textContent).toBe('Ukraine Control Map v2');
  });

  it('names a feature the source left unnamed', () => {
    expect(card({}).querySelector('h4').textContent).toBe('Unnamed feature');
  });

  it('draws the columns the source wrote as rows, and their addresses as links', () => {
    const element = card({
      name: 'Ua Position',
      description: 'Description: shelling https://x.com/a/1\ncode: UA',
    });
    const labels = [...element.querySelectorAll('.layer-card-label')].map((n) => n.textContent);
    expect(labels).toEqual(['Description', 'code']);
    const values = [...element.querySelectorAll('.layer-card-value')].map((n) => n.textContent);
    expect(values).toEqual(['shelling https://x.com/a/1', 'UA']);
    expect(element.querySelector('.layer-card-value a').href).toBe('https://x.com/a/1');
  });

  it('carries no body at all when the source described nothing', () => {
    expect(card({ name: 'Ua Position' }).querySelector('.layer-card-body')).toBeNull();
  });

  it('offers no way out of itself: a card is read, never acted on', () => {
    const element = card({ name: 'Ua Position', description: 'code: UA' });
    expect(element.querySelector('button')).toBeNull();
    expect(element.querySelector('input')).toBeNull();
  });
});

describe("a pin's point on its card", () => {
  const POINT = { lat: 48.8584, lon: 2.2945 };

  it('states where the pin stands, in the format it is given', () => {
    const coords = vi.fn(() => '48°51′30″N 2°17′40″E');
    const element = layerCard('Paris', { coords })({ name: 'Tower' }, POINT);

    expect(coords).toHaveBeenCalledWith(48.8584, 2.2945);
    expect(element.querySelector('.layer-card-where').textContent).toBe('48°51′30″N 2°17′40″E');
  });

  it('writes decimal degrees when no format was given', () => {
    const element = layerCard('Paris')({ name: 'Tower' }, POINT);
    expect(element.querySelector('.layer-card-where').textContent).toBe('48.858400, 2.294500');
  });

  it('copies those coordinates, and that is the only control it has', () => {
    const copy = vi.fn();
    const element = layerCard('Paris', { copy })({ name: 'Tower', description: 'code: UA' }, POINT);
    const buttons = element.querySelectorAll('button');

    expect(buttons).toHaveLength(1);
    expect(buttons[0].title).toBe('Copy coordinates');
    buttons[0].click();
    expect(copy).toHaveBeenCalledWith(element.querySelector('.layer-card-where span').textContent);
    // still nothing that files, confirms or saves
    expect(element.querySelector('input, form')).toBeNull();
  });

  it('states no point for a line or an area, which has no one point', () => {
    const element = layerCard('Paris', { copy: vi.fn() })({ name: 'District' }, null);
    expect(element.querySelector('.layer-card-where')).toBeNull();
    expect(element.querySelector('button')).toBeNull();
  });
});

describe('what a personal feature says on its card', () => {
  it('names its colour and its icon, states its day and state, and links its sources', () => {
    const card = layerCard('Front', { coords: () => '' })({
      name: 'Depot', category: 'Strikes', colour_name: 'Side A', icon_meaning: 'Drone strike', date: '2026-09-13', status: 'destroyed',
      provenance: 'external', links: ['https://x.com/a/1', 'javascript:alert(1)'],
    }, null);
    expect(card.querySelector('.layer-card-group').textContent).toBe('Strikes · Side A · Drone strike');
    expect(card.querySelector('.layer-card-facts').textContent).toBe('2026-09-13 · Destroyed · Geolocated by someone else');
    const links = [...card.querySelectorAll('a.layer-card-link')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['https://x.com/a/1']);
    expect(links[0].rel).toBe('noreferrer noopener');
  });

  it('gives a source feature its span of days and nothing it does not state', () => {
    const card = layerCard('GC', { coords: () => '' })({ name: 'Event', date: '2026-09-01', date_end: '2026-09-03' }, null);
    expect(card.querySelector('.layer-card-facts').textContent).toBe('2026-09-01 – 2026-09-03');
    expect(card.querySelector('.layer-card-link')).toBeNull();
  });

  it('shows the footage and the proof one of the analyst’s markers follows, each opened from its picture', () => {
    const open = vi.fn();
    const pictures = (properties) => [
      { src: properties.source_picture && `/files/c/${properties.source_picture}`, caption: 'Source', title: 'Open the footage', open: () => open('video') },
      { src: properties.entity_picture && `/files/c/${properties.entity_picture}`, caption: 'Proof', title: 'Open the proof', open: () => open('proof') },
    ];
    const element = layerCard('Front', { coords: () => '', pictures })(
      { name: 'Strike', source_picture: 'thumbs/v.webp', entity_picture: 'thumbs/p.webp' }, null);
    const shown = [...element.querySelectorAll('.layer-card-picture')];
    expect(shown.map((one) => [one.textContent, one.querySelector('img').getAttribute('src')])).toEqual([
      ['Source', '/files/c/thumbs/v.webp'], ['Proof', '/files/c/thumbs/p.webp']]);
    shown[0].click();
    expect(open).toHaveBeenCalledWith('video');
    // a picture the thumbnail cache let go leaves the card as it was
    shown[0].querySelector('img').dispatchEvent(new Event('error'));
    expect([...element.querySelectorAll('.layer-card-picture')].map((one) => one.textContent)).toEqual(['Proof']);
    expect(layerCard('Front', { pictures })({ name: 'Own' }, null).querySelector('.layer-card-pictures')).toBeNull();
  });
});

describe('the size of a line or an area on its card', () => {
  // about 1.11 km a side on the equator
  const SQUARE = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]];
  const HOLE = [[0.0025, 0.0025], [0.0075, 0.0025], [0.0075, 0.0075], [0.0025, 0.0075], [0.0025, 0.0025]];

  it('measures a line, its parts added up', () => {
    const one = featureSize({ type: 'LineString', coordinates: [[0, 0], [0.01, 0]] });
    expect(one.length).toBeCloseTo(1113.2, 0);
    expect(one.area).toBe(0);
    const two = featureSize({ type: 'MultiLineString', coordinates: [[[0, 0], [0.01, 0]], [[0, 1], [0.01, 1]]] });
    expect(two.length).toBeGreaterThan(2 * 1113);
  });

  it('measures an area with its hole taken out, and its perimeter on the outer ring', () => {
    const full = featureSize({ type: 'Polygon', coordinates: [SQUARE] });
    const holed = featureSize({ type: 'Polygon', coordinates: [SQUARE, HOLE] });
    expect(full.area).toBeCloseTo(1.239e6, -3);
    expect(holed.area).toBeCloseTo(full.area * 0.75, -3);
    expect(holed.perimeter).toBeCloseTo(full.perimeter, 6);
    expect(featureSize({ type: 'MultiPolygon', coordinates: [[SQUARE], [SQUARE]] }).area).toBeCloseTo(2 * full.area, 0);
  });

  it('has nothing to say about a point or a broken shape', () => {
    expect(featureSize({ type: 'Point', coordinates: [0, 0] })).toBeNull();
    expect(featureSize({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] })).toBeNull();
    expect(featureSize({ type: 'LineString', coordinates: [[0, 0], ['x', null]] })).toBeNull();
    expect(featureSize(null)).toBeNull();
    expect(sizeLine(null)).toBe('');
  });

  it("writes the size in the analyst's units", () => {
    expect(sizeLine({ type: 'Polygon', coordinates: [SQUARE] })).toBe('Area 1.24 km² · Perimeter 4.45 km');
    expect(sizeLine({ type: 'LineString', coordinates: [[0, 0], [0.01, 0]] }, 'imperial')).toBe('Length 3652 ft');
  });

  it('shows at the foot of the card for a line or an area, never for a pin', () => {
    const card = layerCard('Front', { coords: () => '', units: () => 'metric' });
    const area = card({ name: 'District' }, null, { type: 'Polygon', coordinates: [SQUARE] });
    expect(area.querySelector('.layer-card-size').textContent).toBe('Area 1.24 km² · Perimeter 4.45 km');
    expect(area.querySelector('.layer-card-size').nextElementSibling.className).toBe('layer-card-from');
    const pin = card({ name: 'Gate' }, { lat: 0, lon: 0 }, { type: 'Point', coordinates: [0, 0] });
    expect(pin.querySelector('.layer-card-size')).toBeNull();
  });
});
