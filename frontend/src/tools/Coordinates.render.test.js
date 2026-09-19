// @vitest-environment happy-dom
/**
 * The tab, mounted, following the map.
 *
 * `Coordinates.test.js` holds the handover to its own rules — which point the
 * map offers and that naming the place stays behind a press. This checks the
 * one thing only a live component can answer: the tab is never unmounted once
 * visited, so the prefill has to keep up with a map that moved rather than fill
 * once and hold the first point forever.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const post = vi.fn(async (_url, body) => {
  const [lat, lon] = String(body.text).split(',').map((part) => Number(part.trim()));
  return { lat, lon, formats: [{ id: 'dd', label: 'Decimal', value: `${lat}, ${lon}` }] };
});
// The sky panel under the notations asks for its own point; it is not what this
// file is about, and it refuses rather than answering with a shape it invented.
const get = vi.fn(async (url) => {
  if (url.startsWith('/api/geo/reverse')) return { display_name: 'Somewhere' };
  throw new Error('not asked here');
});
vi.mock('../lib/api.js', () => ({ api: { get, post }, ApiError: Error }));

const toast = vi.fn();
vi.mock('../lib/state.svelte.js', async () => {
  const { caseState, uiState } = await import('./coordinates.fixture.svelte.js');
  return { caseState, uiState, toast };
});

const { default: Coordinates } = await import('./Coordinates.svelte');
const { uiState, resetCoordinatesFixture } = await import('./coordinates.fixture.svelte.js');

let live = null;
let target = null;

async function settle() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  flushSync();
}

async function open() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(Coordinates, { target });
  flushSync();
  await settle();
  return target;
}

const field = () => target.querySelector('.go-form .input');

/** The map settling somewhere, which is what writes `uiState.mapPoint`. */
async function mapMovesTo(lat, lon) {
  uiState.mapPoint = { lat, lon, zoom: 15 };
  flushSync();
  await settle();
}

async function type(value) {
  const input = field();
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  await settle();
}

beforeEach(() => {
  resetCoordinatesFixture();
  vi.clearAllMocks();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  target = null;
});

describe('the point the tab opens on', () => {
  it('is the one the map is on', async () => {
    uiState.mapPoint = { lat: 48.8584, lon: 2.2945, zoom: 15 };
    await open();

    expect(field().value).toBe('48.858400, 2.294500');
    expect(post).toHaveBeenCalledWith('/api/geo/parse', { text: '48.858400, 2.294500' });
    // the conversion is local; naming the place is a Nominatim call, and it
    // stays behind the press that asks for it
    expect(get.mock.calls.flat().some((url) => url.startsWith('/api/geo/reverse'))).toBe(false);
  });

  it('follows the map instead of holding the first point it was given', async () => {
    uiState.mapPoint = { lat: 48.8584, lon: 2.2945, zoom: 15 };
    await open();
    await mapMovesTo(50.0755, 14.4378);

    expect(field().value).toBe('50.075500, 14.437800');
    expect(target.querySelector('.formats .v').textContent).toContain('50.0755');
  });

  it('leaves a coordinate somebody typed alone until the map moves again', async () => {
    uiState.mapPoint = { lat: 48.8584, lon: 2.2945, zoom: 15 };
    await open();
    await type('12.5, 13.5');

    expect(field().value).toBe('12.5, 13.5');

    await mapMovesTo(50.0755, 14.4378);
    expect(field().value).toBe('50.075500, 14.437800');
  });

  it('does not overwrite work already on a tab reached without the map moving', async () => {
    await open();
    await type('12.5, 13.5');
    uiState.mapPoint = { lat: 48.8584, lon: 2.2945, zoom: 15 };
    flushSync();
    await settle();

    expect(field().value).toBe('12.5, 13.5');
  });

  it('stays out of the way while another tool is open', async () => {
    await open();
    uiState.tool = 'satellite';
    await mapMovesTo(50.0755, 14.4378);

    expect(field().value).toBe('');
  });
});
