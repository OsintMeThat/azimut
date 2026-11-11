import { describe, expect, it, vi } from 'vitest';
import {
  BACKGROUNDS, MAP_FRAME, MAP_HEIGHT, MAP_MAX_BYTES, MAP_WIDTH, MIN_SPREAD, PREVIEW_HEIGHT, PREVIEW_WIDTH,
  buildRecapMap, drawRecapMap, groundTiles, mapOptions, recapCredit, recapFit, recapMapPreview, recapPlaces, recapPlate,
  sceneHex, signing,
} from './recapMap.js';
import { project } from './plate/geo.js';
import { sceneColorAt } from './scenes.js';

/**
 * The recap map of a video thread, drawn on a canvas that writes down what it is asked
 * to draw: the browser draws the real one (the e2e screenshot), these hold its rules.
 */

/** A canvas whose context takes every call and keeps them. */
function recorder({ sizes = () => 400_000 } = {}) {
  const made = [];
  const makeCanvas = (width, height) => {
    const calls = [];
    const state = {};
    const ctx = new Proxy(state, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'measureText') return (text) => ({ width: String(text).length * 9 });
        return (...args) => { calls.push({ op: key, args, fill: target.fillStyle }); };
      },
      set(target, key, value) { target[key] = value; return true; },
    });
    const canvas = {
      width, height, calls,
      getContext: () => ctx,
      convertToBlob: async ({ type, quality }) => new Blob([new Uint8Array(Math.min(sizes(quality), 2_000_000))], { type }),
    };
    made.push(canvas);
    return canvas;
  };
  return { made, makeCanvas };
}

const slide = (name, lat, lon, order, extra = {}) => ({
  name, title: name, row: { color: sceneColorAt(order), points: [{ lat, lon, coords: `${lat}, ${lon}` }] }, ...extra,
});
const SLIDES = [slide('bridge', 16.05, 44.1, 0), slide('gate', 16.21, 44.32, 1), slide('village', 15.92, 44.55, 2)];
const PROVIDERS = [
  { id: BACKGROUNDS.satellite, attribution: 'Esri, Vantor, Earthstar Geographics, and the GIS User Community' },
  { id: BACKGROUNDS.map, attribution: '© OpenStreetMap contributors, openstreetmap.org/copyright' },
];
const texts = (canvas) => canvas.calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));

describe('the places it pins', () => {
  it('numbers them as #scenes does and colours them as the strip does', () => {
    const places = recapPlaces(SLIDES);
    expect(places.map((one) => [one.number, one.name, one.colour])).toEqual([
      [1, 'bridge', '#40c4ff'], [2, 'gate', '#ff5252'], [3, 'village', '#69f0ae'],
    ]);
    expect(sceneHex('var(--anno-3)')).toBe('#ffd740');
  });

  it('leaves off a place with no point, its number kept by the others', () => {
    const places = recapPlaces([SLIDES[0], { name: 'blank', row: { points: [{ coords: 'text' }] } }, SLIDES[2]]);
    expect(places.map((one) => one.number)).toEqual([1, 3]);
  });
});

describe('the framing', () => {
  it('frames every place inside the page, clear of the edges where the scale, the north and the credits stand', () => {
    const places = recapPlaces(SLIDES);
    const fit = recapFit(places);
    expect(fit.ok).toBe(true);
    for (const one of places) {
      const [x, y] = project(fit.view, MAP_FRAME, [one.lon, one.lat]);
      expect(x / MAP_FRAME.width).toBeGreaterThan(0.1);
      expect(x / MAP_FRAME.width).toBeLessThan(0.9);
      expect(y / MAP_FRAME.height).toBeGreaterThan(0.13);
      expect(y / MAP_FRAME.height).toBeLessThan(0.82);
    }
    // the places fill the room left them on their tighter side: as close as the page allows
    const at = places.map((one) => project(fit.view, MAP_FRAME, [one.lon, one.lat]));
    const spread = (axis) => Math.max(...at.map((p) => p[axis])) - Math.min(...at.map((p) => p[axis]));
    const filled = Math.max(spread(0) / (MAP_FRAME.width * 0.76), spread(1) / (MAP_FRAME.height * 0.65));
    expect(filled).toBeCloseTo(1, 3);
  });

  it('says why when the places cannot be told apart on a map', () => {
    expect(recapFit([])).toEqual({ ok: false, why: 'none' });
    const one = recapPlaces([SLIDES[0]]);
    expect(recapFit(one)).toEqual({ ok: false, why: 'one' });
    // the same point twice is one place
    expect(recapFit(recapPlaces([SLIDES[0], slide('again', 16.05, 44.1, 1)]))).toEqual({ ok: false, why: 'one' });
    // a few metres apart
    const close = recapPlaces([SLIDES[0], slide('next', 16.0501, 44.1001, 1)]);
    expect(recapFit(close)).toEqual({ ok: false, why: 'close' });
    // past the threshold, a map
    const apart = recapPlaces([SLIDES[0], slide('far', 16.05 + (MIN_SPREAD * 2) / 111_000, 44.1, 1)]);
    expect(recapFit(apart).ok).toBe(true);
  });
});

describe('the options', () => {
  it('reads what a draft keeps, anything unknown as the default', () => {
    expect(mapOptions()).toEqual({ background: 'satellite', line: false, signature: false, mark: false });
    expect(mapOptions({ background: 'map', line: true, signature: 'yes', mark: true })).toEqual({ background: 'map', line: true, signature: false, mark: true });
    expect(mapOptions({ background: 'mars' }).background).toBe('satellite');
  });

  it('draws the line only when asked, through the places in the video\'s order', () => {
    const places = recapPlaces(SLIDES);
    const fit = recapFit(places);
    expect(recapPlate(fit, places, {}).elements.some((one) => one.kind === 'line')).toBe(false);
    const line = recapPlate(fit, places, { line: true }).elements.find((one) => one.kind === 'line');
    expect(line).toMatchObject({ line: 'dashed', of: 'map' });
    expect(line.points).toEqual(places.map((one) => [one.lon, one.lat]));
  });

  it('is a page of pins, a scale, a north and the credits, with no title', () => {
    const places = recapPlaces(SLIDES);
    const plate = recapPlate(recapFit(places), places, { background: 'map' });
    expect(plate.elements.map((one) => one.kind)).toEqual(['map', 'label', 'label', 'label', 'scale', 'north', 'credits']);
    expect(plate.elements.some((one) => one.kind === 'text')).toBe(false);
    expect(plate.elements[0].basemap).toBe('osm');
    const pins = plate.elements.filter((one) => one.kind === 'label');
    expect(pins.map((one) => [one.id, one.fill, one.style])).toEqual([
      ['pin-3', '#69f0ae', 'number'], ['pin-2', '#ff5252', 'number'], ['pin-1', '#40c4ff', 'number'],
    ]);
    // the number reads on its colour: dark on a light one
    expect(pins[0].colour).toBe('#14171c');
    expect(pins[1].colour).toBe('#ffffff');
    expect(recapCredit(plate, PROVIDERS)).toBe('© OpenStreetMap contributors, openstreetmap.org/copyright');
  });

  it('moves the north and the scale out of the corners the signature takes', () => {
    const places = recapPlaces(SLIDES);
    const fit = recapFit(places);
    const at = (plate, id) => plate.elements.find((one) => one.id === id).box[0];
    const plain = recapPlate(fit, places, {});
    const signed = recapPlate(fit, places, {}, { logo: { anchor: 'tr' }, text: null, mark: { anchor: 'bl' } });
    expect(at(plain, 'north')).toBeGreaterThan(at(signed, 'north'));
    expect(at(plain, 'scale')).toBeLessThan(at(signed, 'scale'));
  });

  it('signs with what the analyst has, as their default proof style sets it', () => {
    const style = { signatureText: { anchor: 'bl', size: 30 }, azimutMark: { anchor: 'tl', show: 'logo', size: 40 } };
    expect(signing({ signature: true, mark: true }, { style, handle: '@desk' })).toEqual({
      logo: null, text: style.signatureText, mark: { anchor: 'tl', show: 'logo', size: 40 },
    });
    // nothing to sign with: no signature, whatever is ticked
    expect(signing({ signature: true }, { style }).text).toBeNull();
    // no style: the proofs' own defaults, in the bottom right
    const plain = signing({ signature: true, mark: true }, { handle: '@desk', logo: { width: 10, height: 10 } });
    expect([plain.logo.anchor, plain.text.anchor, plain.mark.anchor]).toEqual(['br', 'br', 'br']);
    expect(signing({}, { style, handle: '@desk' })).toEqual({ logo: null, text: null, mark: null });
  });
});

describe('the ground', () => {
  it('asks a dozen tiles or so for the preview and a bounded number for the full picture, covering the canvas', () => {
    const fit = recapFit(recapPlaces(SLIDES));
    const small = groundTiles(fit.view, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    const full = groundTiles(fit.view, MAP_WIDTH, MAP_HEIGHT);
    expect(small.tiles.length).toBeLessThanOrEqual(16);
    expect(full.tiles.length).toBeLessThanOrEqual(80);
    expect(full.zoom).toBeGreaterThan(small.zoom);
    for (const { tiles } of [small, full]) {
      const right = Math.max(...tiles.map((t) => t.left + t.size));
      const bottom = Math.max(...tiles.map((t) => t.top + t.size));
      expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
      expect(Math.min(...tiles.map((t) => t.top))).toBeLessThanOrEqual(0);
      expect(right).toBeGreaterThanOrEqual(tiles === small.tiles ? PREVIEW_WIDTH : MAP_WIDTH);
      expect(bottom).toBeGreaterThanOrEqual(tiles === small.tiles ? PREVIEW_HEIGHT : MAP_HEIGHT);
    }
  });
});

describe('the picture', () => {
  it('is drawn offline on a plain ground until tiles are asked for', async () => {
    const { made, makeCanvas } = recorder();
    const places = recapPlaces(SLIDES);
    const drawn = await drawRecapMap(places, recapFit(places), {}, { providers: PROVIDERS, makeCanvas });
    expect(drawn.asked).toBe(0);
    const [ground, page] = made;
    expect(ground.calls.filter((c) => c.op === 'drawImage')).toHaveLength(0);
    // the numbers, the scale's words, the north and the credit: and no title
    expect(texts(page)).toEqual(['3', '2', '1', '0', expect.stringMatching(/ km$/), 'N', PROVIDERS[0].attribution]);
  });

  it('lays the background\'s tiles, a few at a time, and says how many did not come', async () => {
    const { makeCanvas } = recorder();
    const places = recapPlaces(SLIDES);
    let open = 0;
    let most = 0;
    const loadTile = vi.fn(async (provider, tile) => {
      open += 1;
      most = Math.max(most, open);
      await Promise.resolve();
      open -= 1;
      return tile.x % 2 ? null : { width: 256, height: 256, close() {} };
    });
    const drawn = await drawRecapMap(places, recapFit(places), { background: 'map' }, {
      providers: PROVIDERS, loadTile, makeCanvas, width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT,
    });
    expect(loadTile).toHaveBeenCalledTimes(drawn.asked);
    expect(new Set(loadTile.mock.calls.map(([provider]) => provider))).toEqual(new Set(['osm']));
    expect(most).toBeLessThanOrEqual(5);
    expect(drawn.missing).toBe(loadTile.mock.calls.filter(([, tile]) => tile.x % 2).length);
  });

  it('is a 1600 by 900 JPEG under Bluesky\'s picture size, the quality lowered as needed', async () => {
    const { made, makeCanvas } = recorder({ sizes: (q) => (q > 0.8 ? 1_400_000 : 700_000) });
    const places = recapPlaces(SLIDES);
    const { blob } = await buildRecapMap(places, recapFit(places), {}, { providers: PROVIDERS, makeCanvas });
    expect([made[1].width, made[1].height]).toEqual([MAP_WIDTH, MAP_HEIGHT]);
    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBeLessThanOrEqual(MAP_MAX_BYTES);
  });

  it('gives a small preview with a URL to show and let go', async () => {
    const { made, makeCanvas } = recorder();
    const places = recapPlaces(SLIDES);
    const shown = await recapMapPreview(places, recapFit(places), {}, { makeCanvas });
    expect([made[1].width, made[1].height]).toEqual([PREVIEW_WIDTH, PREVIEW_HEIGHT]);
    expect(shown.url).toMatch(/^blob:/);
    shown.revoke();
  });

  it('writes the handle beside the pins when signed, and the line when asked', async () => {
    const { made, makeCanvas } = recorder();
    const places = recapPlaces(SLIDES);
    await drawRecapMap(places, recapFit(places), { signature: true, line: true }, { providers: PROVIDERS, handle: '@desk', makeCanvas });
    expect(texts(made[1])).toContain('@desk');
    expect(made[1].calls.some((c) => c.op === 'setLineDash' && c.args[0].length)).toBe(true);
  });
});
