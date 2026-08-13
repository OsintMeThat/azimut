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

  it('Imagery draws one card per keyed provider', () => {
    show('imagery');
    expect(pane().querySelectorAll('.cards .card').length).toBe(4);
    expect(pane().textContent).toContain('Eco mode');
  });

  it('Templates says when there is nothing stored yet', () => {
    const text = show('templates');
    expect(text).toContain('No proof templates yet.');
    expect(text).toContain('No post templates yet.');
  });

  it('Extension offers the download and the pairing token', () => {
    const text = show('extension');
    expect(text).toContain('Pairing');
    expect(pane().querySelector('a[href="/api/ingest/extension.zip"]')).not.toBeNull();
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
