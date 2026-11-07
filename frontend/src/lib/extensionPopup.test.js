// @vitest-environment happy-dom
/**
 * Tests for the capture extension's pairing popup (extension/popup.js).
 *
 * The toolbar button opens it only while the extension holds no token
 * (`background.js`, "the toolbar button"); once paired, a press opens the tools
 * over a map or the note anywhere else, and no popup at all. Like the options page
 * next door, the popup has no exports: the suite loads popup.html into the
 * document, stubs `chrome` and `fetch`, evaluates the sources and reads the DOM.
 *
 * What is worth pinning: a token is stored only once the app took it, so a wrong
 * one never leaves the button pairing; the step the press was for is offered once
 * paired, inside its own click; and on Azimut's own tab the popup still does what
 * any press does there, let the app capture it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ext = join(here, '../../../extension');
const source = ['pairing.js', 'mapsites.js', 'popup.js'].map((name) => readFileSync(join(ext, name), 'utf8')).join('\n');
const html = readFileSync(join(ext, 'popup.html'), 'utf8');

const $ = (id) => document.getElementById(id);
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const ARTICLE = { id: 5, windowId: 4, url: 'https://example.com/story' };
const MAP = { id: 6, windowId: 4, url: 'https://www.google.com/maps/@48.85,2.29,17z' };
const APP = { id: 9, windowId: 4, url: 'http://127.0.0.1:8477/#/satellite' };

/** Open the popup over `tab`, the app answering the ping with `ping`. */
async function openPopup({ tab = ARTICLE, stored = {}, ping = { status: 200, json: async () => ({ version: '0.3.4' }) }, browser = {} } = {}) {
  document.body.innerHTML = html
    .replace(/[\s\S]*<body[^>]*>/, '')
    .replace(/<\/body>[\s\S]*/, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');
  const api = {
    tabs: { query: vi.fn(async () => [tab]), sendMessage: vi.fn(async () => {}) },
    storage: {
      local: {
        get: vi.fn(async (defaults) => ({ ...defaults, token: '', ...stored })),
        set: vi.fn(async () => {}),
      },
    },
    runtime: { getManifest: () => ({ version: '0.3.4' }), sendMessage: vi.fn(async () => ({ ok: true })) },
    action: { setPopup: vi.fn(async () => {}) },
    ...browser,
  };
  const fetchImpl = vi.fn(async () => {
    if (ping instanceof Error) throw ping;
    return ping;
  });
  const close = vi.spyOn(window, 'close').mockImplementation(() => {});
  new Function('chrome', 'browser', 'fetch', source)(browser.firefox ? undefined : api, browser.firefox ? api : undefined, fetchImpl);
  await settle();
  return { api, fetchImpl, close };
}

/** Paste a token and press Pair. */
async function pair(token = 'tok-123') {
  $('token').value = token;
  $('pair').click();
  await settle();
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('pairing', () => {
  it('asks for the token, the address folded away at its default', async () => {
    await openPopup();
    expect($('pairing').hidden).toBe(false);
    expect($('paired').hidden).toBe(true);
    expect($('elsewhere').open).toBe(false);
    expect($('backendUrl').value).toBe('http://127.0.0.1:8477');
  });

  it('opens the address already when it is not the default', async () => {
    await openPopup({ stored: { backendUrl: 'http://127.0.0.1:9000' } });
    expect($('elsewhere').open).toBe(true);
  });

  it('stores the token once the app took it, and says which Azimut', async () => {
    const { api, fetchImpl } = await openPopup();
    await pair(' tok-123 ');
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:8477/api/ingest/ping', { headers: { 'X-Azimut-Token': 'tok-123' } });
    expect(api.storage.local.set).toHaveBeenCalledWith({ backendUrl: 'http://127.0.0.1:8477', token: 'tok-123' });
    expect($('status').textContent).toBe('Paired with Azimut 0.3.4.');
    expect($('pairing').hidden).toBe(true);
  });

  it('keeps a token the app turned down out of storage, so the button goes on pairing', async () => {
    const { api } = await openPopup({ ping: { status: 401, json: async () => ({}) } });
    await pair();
    expect(api.storage.local.set).not.toHaveBeenCalled();
    expect($('status').textContent).toMatch(/rejected the token/);
    expect($('pairing').hidden).toBe(false);
  });

  it('says so when no Azimut answers at that address', async () => {
    const { api } = await openPopup({ ping: new Error('network') });
    await pair();
    expect(api.storage.local.set).not.toHaveBeenCalled();
    expect($('status').textContent).toBe('No Azimut at http://127.0.0.1:8477. Is the app running?');
  });

  it('asks for a token before asking the app anything', async () => {
    const { fetchImpl } = await openPopup();
    await pair('   ');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect($('status').textContent).toBe('Paste the pairing token first.');
  });
});

describe('the step the press was for', () => {
  it('offers the tools on a map, and puts them over it', async () => {
    const { api, close } = await openPopup({ tab: MAP });
    await pair();
    expect($('next').hidden).toBe(false);
    expect($('next').textContent).toBe('Open the tools on this map');
    $('next').click();
    await settle();
    expect(api.runtime.sendMessage).toHaveBeenCalledWith({ type: 'map-tools', tabId: 6 });
    expect(close).toHaveBeenCalled();
  });

  it('offers the note anywhere else, and opens it inside the click', async () => {
    const open = vi.fn(async () => {});
    await openPopup({ browser: { sidePanel: { open } } });
    await pair();
    expect($('next').textContent).toBe('Open the note');
    $('next').click();
    expect(open).toHaveBeenCalledWith({ windowId: 4 });
  });

  it('opens Firefox’s sidebar the same way', async () => {
    const open = vi.fn(async () => {});
    await openPopup({ browser: { firefox: true, sidebarAction: { open } } });
    await pair();
    $('next').click();
    expect(open).toHaveBeenCalled();
  });

  it('says so when the browser has no panel to open', async () => {
    await openPopup();
    await pair();
    $('next').click();
    await settle();
    expect($('status').textContent).toMatch(/Could not open it/);
  });

  it('drops a popup the browser kept after the pairing, and goes straight to the step', async () => {
    const { api, fetchImpl } = await openPopup({ tab: MAP, stored: { token: 'tok-123' } });
    expect(api.action.setPopup).toHaveBeenCalledWith({ popup: '' });
    expect($('pairing').hidden).toBe(true);
    expect($('next').textContent).toBe('Open the tools on this map');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('on Azimut’s own tab', () => {
  it('lets the app capture the tab, paired or not', async () => {
    const { api } = await openPopup({ tab: APP });
    expect(api.tabs.sendMessage).toHaveBeenCalledWith(9, { type: 'app-activated' });
    expect($('granted').hidden).toBe(false);
  });

  it('opens Settings on the token from step one', async () => {
    const { api } = await openPopup({ tab: APP });
    expect($('open-settings').hidden).toBe(false);
    $('open-settings').click();
    expect(api.tabs.sendMessage).toHaveBeenCalledWith(9, { type: 'app-pairing' });
  });

  it('offers no step once paired: the app is the place', async () => {
    await openPopup({ tab: APP });
    await pair();
    expect($('next').hidden).toBe(true);
  });

  it('keeps step one a sentence anywhere else', async () => {
    await openPopup();
    expect($('open-settings').hidden).toBe(true);
    expect($('granted').hidden).toBe(true);
  });
});
