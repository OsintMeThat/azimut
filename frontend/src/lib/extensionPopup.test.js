// @vitest-environment happy-dom
/**
 * Tests for the capture extension's popup (extension/popup.js).
 *
 * Like extension.test.js next door, the popup has no exports: the suite loads
 * popup.html into the document, stubs `chrome` and `fetch`, evaluates the source
 * and reads the resulting DOM.
 *
 * What is worth pinning here is the unreachable case. The popup asks the app to
 * read the URL before it draws anything, so a stopped app is caught upstream and
 * these buttons are never wired at all. The window this covers is the narrow one:
 * the app answered the first request and was gone by the second.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ext = join(here, '../../../extension');
const source = readFileSync(join(ext, 'popup.js'), 'utf8');
const html = readFileSync(join(ext, 'popup.html'), 'utf8');

const $ = (id) => document.getElementById(id);

/** Run the popup against a tab, with `fetch` answering per URL fragment. */
async function runPopup({ tabUrl, answers }) {
  // Body only, without the <script src> happy-dom refuses to fetch: the source is
  // evaluated below by hand, with the globals a popup really has.
  document.body.innerHTML = html
    .replace(/[\s\S]*<body[^>]*>/, '')
    .replace(/<\/body>[\s\S]*/, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');

  // happy-dom ships no `Option` constructor; the popup fills its case pickers with it.
  globalThis.Option = function Option(text, value) {
    const option = document.createElement('option');
    option.textContent = text;
    option.value = value ?? text;
    return option;
  };

  globalThis.chrome = {
    tabs: { query: vi.fn(async () => [{ id: 7, url: tabUrl }]), sendMessage: vi.fn(async () => {}) },
    storage: {
      local: {
        get: vi.fn(async (defaults) => ({
          ...defaults,
          backendUrl: 'http://127.0.0.1:8477',
          token: 'tok-123',
        })),
        set: vi.fn(),
      },
    },
    runtime: { getManifest: () => ({ version: '0.2.9' }), sendMessage: vi.fn(async () => ({ ok: true })) },
  };

  globalThis.fetch = vi.fn(async (url) => {
    for (const [fragment, answer] of Object.entries(answers)) {
      if (String(url).includes(fragment)) return answer();
    }
    throw new Error('unexpected fetch');
  });

  const run = new Function('browser', `${source}\n//# sourceURL=popup.js`);
  run(undefined);
  // init() is async and awaits two fetches before it wires the buttons
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const ok = (body) => () => ({ ok: true, status: 200, json: async () => body });
const down = () => {
  throw new Error('network');
};

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('a map page whose app goes away mid-load', () => {
  const mapPage = {
    tabUrl: 'https://www.google.fr/maps/@48.85,2.29,17z',
    answers: {
      '/parse': ok({ site: 'google-maps', label: 'Google Maps', lat: 48.85, lon: 2.29, zoom: 17 }),
      '/cases': down,
    },
  };

  it('greys out every button, so the error message is the only story', async () => {
    await runPopup(mapPage);

    expect($('save-place').disabled).toBe(true);
    expect($('capture-area').disabled).toBe(true);
    expect($('status').textContent).toContain('Cannot reach Azimut');
  });

  it('leaves nothing that answers a click with silence', async () => {
    await runPopup(mapPage);

    const live = ['save-place', 'capture-area'].filter((id) => !$(id).disabled);
    expect(live).toEqual([]);
  });
});

describe('a page that is not a map, whose app goes away mid-load', () => {
  it('greys out the bookmark button too', async () => {
    await runPopup({
      tabUrl: 'https://example.com/article',
      answers: { '/parse': ok({ site: null }), '/cases': down },
    });

    expect($('save-bookmark').disabled).toBe(true);
    expect($('status').textContent).toContain('Cannot reach Azimut');
  });
});

describe('a map page with the app answering', () => {
  it('leaves capture reachable, and holds the place button for its coordinates', async () => {
    await runPopup({
      tabUrl: 'https://www.google.fr/maps/@48.85,2.29,17z',
      answers: {
        '/parse': ok({ site: 'google-maps', label: 'Google Maps', lat: 48.85, lon: 2.29, zoom: 17 }),
        '/cases': ok([{ id: 'c1', name: 'Case one' }]),
      },
    });

    expect($('capture-area').disabled).toBe(false);
    expect($('save-place').disabled).toBe(false);
  });
});
