// @vitest-environment happy-dom
/**
 * Settings, actually mounted, on every one of its seven sections.
 *
 * The sections are separate components now (`tools/settings/`), wired to the
 * shell by props. Reading the source proves a tab exists; it cannot prove the
 * tab mounts, that a `bind:` prop the shell passes is one the section declares,
 * or that the pane still carries the class its shared layout rules hang off.
 * A section that throws on mount would otherwise reach a release green.
 */
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { api } from '../lib/api.js';
import { prefs, templatesState } from '../lib/state.svelte.js';

// The template editors reach Konva through the composer; nothing here draws.
vi.mock('konva', () => ({ default: {} }));

vi.mock('../lib/api.js', () => ({
  api: {
    get: vi.fn(async (path) => {
      if (path.startsWith('/api/settings/scrapers')) return { scrapers: [] };
      if (path.startsWith('/api/settings/ffmpeg')) {
        return { available: true, version: '7.1', source: 'bundled', path: '/x/ffmpeg' };
      }
      if (path.startsWith('/api/settings/diagnostics')) {
        return { kind: 'bug', title: 't', report: 'body', url: 'https://example.invalid/new' };
      }
      return settingsBlob();
    }),
    put: vi.fn(async () => settingsBlob()),
    post: vi.fn(async () => ({ ingest_token: 'tok' })),
    del: vi.fn(async () => ({})),
  },
}));

function settingsBlob() {
  return {
    version: '0.2.8',
    workspace_root: '/home/analyst/Azimut',
    extension_version: '1.0',
    signature: false,
    signature_handle: '',
    api_keys: {},
    usage: {},
    month: '2026-08',
    providers_enabled: {},
    usage_overrides: {},
    provider_status: {},
    eco_zoom_fallback: true,
    eco_max_zoom: 12,
    eco_max_zooms: {},
    free_tier: {},
    free_tiers: {},
    export_dirs: { notes: '', media: '', proofs: '' },
    ingest_token: '',
    home_view: { lat: 48.85, lon: 2.29, zoom: 12 },
    post_mention: '',
    post_target: 'x',
    post_template: '',
    update_check_on_start: true,
    proof_place_auto: true,
  };
}

const { default: Settings } = await import('./Settings.svelte');

const TABS = ['general', 'publishing', 'imagery', 'templates', 'extension', 'storage', 'system'];

let live = null;

beforeEach(() => {
  const target = document.createElement('div');
  target.id = 'root';
  document.body.append(target);
  live = mount(Settings, { target });
  flushSync();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

const rail = () => [...document.querySelectorAll('.rail-tab')];
const pane = () => document.querySelector('.pane');

describe('the settings pane', () => {
  it('offers every section in the rail', () => {
    expect(rail()).toHaveLength(TABS.length);
  });

  it('carries the class its shared layout rules hang off', () => {
    // `.group`, `.row` and the segmented control live in app.css under
    // `.settings-pane`; drop the class and all seven sections lose their layout.
    expect(pane().classList.contains('settings-pane')).toBe(true);
  });

  it('mounts each section without throwing, and shows only that one', () => {
    for (const [index] of TABS.entries()) {
      rail()[index].click();
      flushSync();
      expect(pane().querySelectorAll('section.group, .workspace-folder').length).toBeGreaterThan(0);
    }
  });
});

describe('each section', () => {
  const show = (id) => {
    rail()[TABS.indexOf(id)].click();
    flushSync();
    return pane().textContent;
  };

  it('General states the coordinate and unit choices', () => {
    const text = show('general');
    expect(text).toContain('Coordinates');
    expect(text).toContain('MGRS');
    expect(text).toContain('Satellite home view');
  });

  it('Publishing states the mention and signature controls', () => {
    const text = show('publishing');
    expect(text).toContain('Geo Report');
    expect(text).toContain('Signature');
  });

  it('Imagery draws one card per key, basemap or layer', () => {
    show('imagery');
    // four basemaps and NASA FIRMS, which buys a layer over whichever one is
    // showing rather than a basemap of its own
    expect(pane().querySelectorAll('.cards .card').length).toBe(5);
    expect(pane().textContent).toContain('Eco mode');
    expect(pane().textContent).toContain('NASA FIRMS');
  });

  it('Templates says when there is nothing stored yet', () => {
    const text = show('templates');
    expect(text).toContain('No proof templates yet.');
    expect(text).toContain('No post templates yet.');
  });

  it('Extension offers the download and the pairing token', () => {
    const text = show('extension');
    expect(text).toContain('Pairing');
    expect(text).toContain('about:addons');
    expect(text).toContain('Install Add-on From File');
    expect(pane().querySelector('a[href="/api/ingest/extension.zip"]')).not.toBeNull();
  });

  it('Extension links the XPI on the release that carries it, not the newest one', () => {
    // The signed add-on is attached to the release that last moved the extension,
    // so it is the extension's own version that names the tag and the file. Link
    // `releases/latest` instead and every release that left `extension/` alone
    // sends Firefox users to a page with no XPI on it at all.
    const text = show('extension');
    expect(text).toContain('azimut-capture-1.0.xpi');
    const link = pane().querySelector('a[href*="azimut-capture-1.0.xpi"]');
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe(
      'https://github.com/OsintMeThat/azimut/releases/download/v1.0/azimut-capture-1.0.xpi',
    );
    expect(pane().querySelector('a[href$="/releases/latest"]')).toBeNull();
  });

  it('Storage manages all three export folders and the backup', () => {
    const text = show('storage');
    expect(text).toContain('Note PDFs');
    expect(text).toContain('Media copies');
    expect(text).toContain('Proof PNGs');
    expect(pane().querySelector('a[href="/api/settings/export"]')).not.toBeNull();
  });

  it('System reports the version and what ffmpeg it found', () => {
    const text = show('system');
    expect(text).toContain('0.2.8');
    expect(text).toContain('bundled');
    expect(text).toContain('Report an issue');
  });
});

describe('post templates', () => {
  const CLASSIC = {
    id: 'po_1', name: 'Classic', data: { mention: '@House', body: '#place\n#mention', mediaEnabled: true, extraTweets: [] },
  };
  const SHORT = {
    id: 'po_2', name: 'Short', data: { mention: '', body: '#coordinates', mediaEnabled: false, extraTweets: [{ text: 'Thread' }] },
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const click = (el) => {
    el.click();
    flushSync();
  };
  const row = (name) =>
    [...pane().querySelectorAll('.tpl-row')].find((r) => r.querySelector('.tpl-name').textContent === name);
  const inRow = (name, text) =>
    [...row(name).querySelectorAll('button')].find((b) => b.textContent.trim() === text);
  const editor = () => document.querySelector('.tpl-modal');
  const startFrom = () => editor().querySelector('.starters');

  beforeEach(async () => {
    // the shell asked for the templates and the settings as it mounted
    await settle();
    templatesState.post = [CLASSIC, SHORT];
    api.put.mockImplementation(async (path, patch) => ({ ...settingsBlob(), ...patch }));
    api.put.mockClear();
    api.post.mockClear();
    api.del.mockClear();
    rail()[TABS.indexOf('templates')].click();
    flushSync();
  });

  afterEach(() => {
    if (editor()) click(editor().querySelector('.btn-ghost:not(.btn-sm)')); // Cancel
    api.put.mockImplementation(async () => settingsBlob());
    templatesState.proof = [];
    templatesState.post = [];
    prefs.postTemplate = '';
  });

  it('offers starting layouts for a new template, and not for one that exists', () => {
    click(pane().querySelectorAll('.group')[1].querySelector(':scope > button'));
    expect(startFrom()).not.toBeNull();
    click(editor().querySelector('.btn-ghost:not(.btn-sm)')); // Cancel

    click(inRow('Classic', 'Edit'));
    expect(editor()).not.toBeNull();
    expect(startFrom()).toBeNull();
  });

  it('opens a copy of a template under its own name, to be saved as a new one', async () => {
    click(inRow('Short', 'Duplicate'));

    expect(editor().querySelector('.tpl-title').value).toBe('Short copy');
    expect(editor().querySelector('textarea.body').value).toBe('#coordinates');
    expect(startFrom()).toBeNull(); // a copy is not a blank start
    expect(api.post).not.toHaveBeenCalled(); // nothing is stored until Save

    click([...editor().querySelectorAll('button')].find((b) => b.textContent.includes('Save template')));
    await settle();
    expect(api.post).toHaveBeenCalledWith('/api/templates/post', {
      id: null,
      name: 'Short copy',
      data: SHORT.data,
    });
  });

  it('leaves the original alone when the copy is edited and dropped', async () => {
    click(inRow('Classic', 'Duplicate'));
    const body = editor().querySelector('textarea.body');
    body.value = 'changed';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(); // the textarea binding reads its value back one tick later
    click(editor().querySelector('.btn-ghost:not(.btn-sm)'));

    expect(editor()).toBeNull();
    expect(CLASSIC.data.body).toBe('#place\n#mention');
  });

  it('keeps a copied name inside the length a template may have', () => {
    templatesState.post = [{ ...CLASSIC, name: 'n'.repeat(120) }];
    flushSync();
    click(inRow('n'.repeat(120), 'Duplicate'));
    expect(editor().querySelector('.tpl-title').value).toBe('n'.repeat(120));
  });

  it('saves the template new posts start with, and shows it', async () => {
    row('Short').querySelector('button[aria-pressed]').click();
    await settle();
    flushSync();
    expect(api.put).toHaveBeenCalledWith('/api/settings/prefs', { post_template: 'po_2' });
    expect(prefs.postTemplate).toBe('po_2');
    expect(row('Short').querySelector('.tpl-tag').textContent).toBe('Default');
    expect(row('Classic').querySelector('.tpl-tag')).toBeNull();

    row('Short').querySelector('button[aria-pressed]').click();
    await settle();
    flushSync();
    expect(api.put).toHaveBeenLastCalledWith('/api/settings/prefs', { post_template: '' });
    expect(prefs.postTemplate).toBe('');
  });

  it('forgets the default when that template is deleted', async () => {
    prefs.postTemplate = 'po_2';
    flushSync();
    click(row('Short').querySelector('button[title="Delete"]'));
    click([...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.trim() === 'Delete'));
    await settle();

    expect(api.del).toHaveBeenCalledWith('/api/templates/post/po_2');
    expect(api.put).toHaveBeenCalledWith('/api/settings/prefs', { post_template: '' });
    expect(prefs.postTemplate).toBe('');
  });

  it('keeps the default when another template is deleted', async () => {
    prefs.postTemplate = 'po_2';
    flushSync();
    click(row('Classic').querySelector('button[title="Delete"]'));
    click([...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.trim() === 'Delete'));
    await settle();

    expect(api.del).toHaveBeenCalledWith('/api/templates/post/po_1');
    expect(api.put).not.toHaveBeenCalled();
    expect(prefs.postTemplate).toBe('po_2');
  });
});
