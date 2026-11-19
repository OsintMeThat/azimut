// @vitest-environment happy-dom
/**
 * Settings › Publishing › Styles, mounted: a column per style, a row per thing a
 * document adds after its text, then how its sources are written and how strictly its
 * links are checked. Each change hands the whole table up to be saved, and Reset hands
 * up none, which is Azimut's own throughout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('../../lib/api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() } }));

const { default: NoteStyles } = await import('./NoteStyles.svelte');
const { prefs } = await import('../../lib/state.svelte.js');
const { STYLE_DEFAULTS } = await import('../../lib/notes/look.js');

let target;
let app;
let saved;

beforeEach(() => {
  saved = [];
  prefs.noteStyles = null;
  target = document.createElement('div');
  document.body.append(target);
  // the server answers with the whole table, as GET /api/settings does
  const savePrefs = vi.fn(async (patch) => {
    saved.push(patch);
    prefs.noteStyles = patch.note_styles;
    return { note_styles: patch.note_styles };
  });
  app = mount(NoteStyles, { target, props: { savePrefs } });
  flushSync();
});

afterEach(() => {
  unmount(app);
  target.remove();
  prefs.noteStyles = null;
});

const row = (id) => target.querySelector(`[data-row="${id}"]`);
const cells = (id) => [...row(id).querySelectorAll('[role="cell"]')];

describe('Settings › Publishing › Styles', () => {
  it('shows each style in a column and what it carries by Azimut\'s own, Plain carrying nothing', () => {
    const heads = [...target.querySelectorAll('[role="columnheader"]')].map((cell) => cell.textContent.trim()).filter(Boolean);
    expect(heads).toEqual(['Report', 'Web article', 'Brief', 'Journal', 'Plain']);
    expect(cells('sources').map((cell) => cell.querySelector('input').checked)).toEqual([true, true, true, true, false]);
    expect(cells('method').map((cell) => cell.querySelector('input').checked)).toEqual([true, false, false, false, false]);
    expect(cells('credits').map((cell) => cell.querySelector('input').checked)).toEqual([true, true, false, false, false]);
    expect(cells('sources_style').map((cell) => cell.querySelector('select').value)).toEqual(['academic', 'web', 'short', 'short', 'short']);
    expect(cells('link_check').map((cell) => cell.querySelector('select').value)).toEqual(['grouped', 'grouped', 'grouped', 'grouped', 'grouped']);
    expect(target.querySelector('.foot button').disabled).toBe(true);
  });

  it('hands the whole table up on each change, and Reset hands up none', async () => {
    cells('limits')[2].querySelector('input').click();
    await Promise.resolve();
    flushSync();
    expect(saved).toHaveLength(1);
    expect(saved[0].note_styles.brief).toEqual({ ...STYLE_DEFAULTS.brief, limits: true });
    expect(saved[0].note_styles.report).toEqual(STYLE_DEFAULTS.report);
    // a menu shows what the table holds (happy-dom cannot pick an option, so the table is changed instead)
    prefs.noteStyles = { ...saved[0].note_styles, report: { ...STYLE_DEFAULTS.report, sources_style: 'short' } };
    flushSync();
    expect(cells('sources_style')[0].querySelector('select').value).toBe('short');
    expect(cells('limits')[2].querySelector('input').checked).toBe(true);
    const reset = target.querySelector('.foot button');
    expect(reset.disabled).toBe(false);
    reset.click();
    expect(saved.at(-1)).toEqual({ note_styles: {} });
  });

  it('titles every control with the style it is for', () => {
    for (const control of target.querySelectorAll('input, select, button')) expect(control.title, control.outerHTML).toBeTruthy();
    expect(cells('geolocations')[0].querySelector('input').title).toMatch(/^Report: /);
  });
});
