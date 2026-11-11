// @vitest-environment happy-dom
/**
 * The Templates section, actually mounted.
 *
 * Each row offers a copy, and a post row also says whether new posts start with
 * it. Both are answers the parent acts on, so what is checked here is what a row
 * hands up when pressed and what it shows for the current default.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../lib/api.js', () => ({ api: { get, post, put: vi.fn(), del: vi.fn() } }));
vi.mock('../../lib/notes/thumbs.js', () => ({ templateThumb: vi.fn(async () => 'data:image/png;base64,AAAA') }));

const { default: TemplatesTab } = await import('./TemplatesTab.svelte');
const { caseState, prefs, templatesState, uiState } = await import('../../lib/state.svelte.js');
const { noteTemplateFile } = await import('../../lib/notes/templateFile.js');

const PROOF = { id: 'pf_1', name: 'House proof', data: { legend: true } };
const CLASSIC = { id: 'po_1', name: 'Classic', data: { body: '#place' } };
const SHORT = { id: 'po_2', name: 'Short', data: { body: '#coordinates' } };

let target;
let app;
let props;

function open() {
  target = document.createElement('div');
  document.body.append(target);
  props = {
    newTemplate: vi.fn(),
    editTemplate: vi.fn(),
    duplicateTemplate: vi.fn(),
    savePrefs: vi.fn(),
    deleteTpl: null,
  };
  app = mount(TemplatesTab, { target, props });
  flushSync();
}

beforeEach(() => {
  templatesState.proof = [PROOF];
  templatesState.post = [CLASSIC, SHORT];
  prefs.postTemplate = '';
  prefs.proofTemplate = '';
});

afterEach(() => {
  if (app) unmount(app);
  document.querySelectorAll('.float-menu').forEach((node) => node.remove());
  caseState.current = null;
  target?.remove();
  app = null;
  templatesState.proof = [];
  templatesState.post = [];
  templatesState.note = [];
  prefs.postTemplate = '';
  prefs.proofTemplate = '';
});

describe('Notebook templates', () => {
  const WRITE_UP = { id: 'nt_1', name: 'Write-up', data: { body: '## Claim', folder: '', look: { style: 'brief' } } };
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); flushSync(); };

  beforeEach(() => {
    vi.clearAllMocks();
    // saving a template answers with it, and the list is read again
    post.mockImplementation(async (_url, body) => ({ id: 'nt_new', name: body.name, data: body.data }));
    get.mockImplementation(async () => ({ proof: templatesState.proof, post: templatesState.post, map: [], note: templatesState.note }));
  });

  it('shows each one by its first page, its name and its style', () => {
    templatesState.note = [WRITE_UP, { id: 'nt_2', name: 'Old', data: { body: '' } }];
    open();
    const section = target.querySelector('[data-guide="settings.note-templates"]');
    expect(section.querySelector('h3').textContent).toBe('Notebook templates');
    expect(rowOf('Write-up').textContent).toContain('Brief');
    expect(rowOf('Old').textContent).toContain('Plain');
    expect(rowOf('Write-up').querySelector('.thumb')).not.toBeNull();
  });

  it('opens one in the Notebook to edit it, with a copy, a file and a delete beside', () => {
    templatesState.note = [WRITE_UP];
    open();
    const row = rowOf('Write-up');
    expect(button(row, 'Duplicate')).toBeTruthy();
    expect(row.querySelector('button[aria-label="Download Write-up"]')).not.toBeNull();
    expect(row.querySelector('button[aria-label="Delete Write-up"]')).not.toBeNull();
    button(row, 'Edit').click();
    expect(uiState.openNoteTemplate).toBe('nt_1');
    expect(uiState.tool).toBe('notebook');
    uiState.openNoteTemplate = null;
  });

  it('copies one with its look', async () => {
    templatesState.note = [WRITE_UP];
    open();
    button(rowOf('Write-up'), 'Duplicate').click();
    await settle();
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/api/templates/note');
    expect(body.name).toBe('Write-up copy');
    expect(body.data).toMatchObject({ body: '## Claim', look: { style: 'brief' } });
  });

  it('saves one as a file, and takes a file back', async () => {
    templatesState.note = [WRITE_UP];
    open();
    let saved = null;
    const createObjectURL = vi.fn((blob) => { saved = blob; return 'blob:x'; });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const clicks = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicks.push(this.download); });
    rowOf('Write-up').querySelector('button[aria-label="Download Write-up"]').click();
    expect(clicks).toEqual(['Write-up.azimut-note.json']);
    click.mockRestore();
    const text = await saved.text();
    expect(JSON.parse(text)).toMatchObject({ azimut_note_template: 1, name: 'Write-up', data: { look: { style: 'brief' } } });

    const input = target.querySelector('[data-guide="settings.note-templates"] input[type="file"]');
    const file = new File([await noteTemplateFile({ name: 'From a colleague', data: WRITE_UP.data }).text()], 't.azimut-note.json');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    const [, body] = post.mock.calls.at(-1);
    expect(body.name).toBe('From a colleague');
    expect(body.data).toMatchObject({ body: '## Claim', look: { style: 'brief', cover: { image: '' } } });
  });

  it('refuses a file that is not one, and says so', async () => {
    open();
    const input = target.querySelector('[data-guide="settings.note-templates"] input[type="file"]');
    Object.defineProperty(input, 'files', { value: [new File(['{"azimut_map_template":1,"data":{}}'], 'map.json')], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(uiState.toasts.map((item) => item.message)).toContain('That file is not a Notebook template'));
    expect(post).not.toHaveBeenCalled();
  });

  const menu = () => document.querySelector('.float-menu[aria-label="New template"]');
  const entry = (text) => [...menu().querySelectorAll('.fm-item')].find((node) => node.textContent.trim() === text);
  const openMenu = () => {
    target.querySelector('[data-new-template]').click();
    flushSync();
  };

  it('starts one from one menu: blank, a ready one, one of yours, or a note of the case open', () => {
    caseState.current = { id: 'c1', name: 'Case' };
    templatesState.note = [WRITE_UP];
    open();
    expect(sectionButton(target.querySelector('[data-guide="settings.note-templates"]'), 'From a ready one')).toBeUndefined();
    openMenu();
    expect([...menu().querySelectorAll('.fm-item')].map((node) => node.textContent.trim()))
      .toEqual(['Blank', 'From a ready one', 'From one of yours', 'From a note of this case']);
    caseState.current = null;
    flushSync();
    // no case open, no note to start from
    expect(entry('From a note of this case')).toBeUndefined();
    document.querySelectorAll('.float-menu').forEach((node) => node.remove());
  });

  it('has none of yours to copy before one is kept', () => {
    open();
    openMenu();
    expect(entry('From one of yours').disabled).toBe(true);
  });

  it('starts a blank one and opens it in the Notebook', async () => {
    open();
    openMenu();
    entry('Blank').click();
    await settle();
    const [, body] = post.mock.calls[0];
    expect(body).toMatchObject({ name: 'Note template', data: { body: '', folder: '' } });
    expect(uiState.openNoteTemplate).toBe('nt_new');
    expect(menu()).toBeNull();
    uiState.openNoteTemplate = null;
  });

  it('copies one of yours, look and all, and opens the copy', async () => {
    templatesState.note = [WRITE_UP];
    open();
    openMenu();
    entry('From one of yours').click();
    flushSync();
    [...menu().querySelectorAll('.ready-item')].find((node) => node.textContent.includes('Write-up')).click();
    await settle();
    const [, body] = post.mock.calls[0];
    expect(body.name).toBe('Write-up copy');
    expect(body.data).toMatchObject({ body: '## Claim', look: { style: 'brief' } });
    expect(uiState.openNoteTemplate).toBe('nt_new');
    uiState.openNoteTemplate = null;
  });

  it('starts one from a note of the case: its text, folder and look, never its cover picture or day', async () => {
    caseState.current = { id: 'c1', name: 'Case' };
    get.mockImplementation(async (url) => {
      if (url === '/api/cases/c1/notes/index') return { items: [{ id: 'case', title: 'Case notes' }, { id: 'n1', title: 'Port strike', folder: 'Leads', updated_at: 'x' }] };
      if (url === '/api/cases/c1/notes/n1') return { text: '# Port strike\n\nWhat we saw.' };
      if (url === '/api/cases/c1/notes/n1/look') return { look: { style: 'report', cover: { on: true, mode: 'own', image: 'm1', date: '2026-11-04' } } };
      return { proof: [], post: [], map: [], note: [] };
    });
    open();
    openMenu();
    entry('From a note of this case').click();
    flushSync();
    await settle();
    const picker = document.querySelector('.float-menu[aria-label="Notes"]');
    expect(picker.textContent).toContain('Its text, folder and look start the template');
    [...picker.querySelectorAll('.fm-item')].find((node) => node.textContent.includes('Port strike')).click();
    await settle();
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    const [, body] = post.mock.calls[0];
    expect(body.name).toBe('Port strike');
    expect(body.data.body).toBe('# Port strike\n\nWhat we saw.');
    expect(body.data.folder).toBe('Leads');
    expect(body.data.look).toMatchObject({ style: 'report', cover: { on: true, mode: 'own', image: '', date: '' } });
    expect(uiState.openNoteTemplate).toBe('nt_new');
    uiState.openNoteTemplate = null;
    caseState.current = null;
  });

  it('starts one from a ready template and opens it in the Notebook', async () => {
    open();
    openMenu();
    entry('From a ready one').click();
    flushSync();
    const item = [...document.querySelectorAll('.ready-item')].find((node) => node.textContent.includes('Daily SITREP'));
    expect([...document.querySelectorAll('.ready-item')].some((node) => node.textContent.includes('Blank'))).toBe(false);
    item.click();
    await settle();
    const [, body] = post.mock.calls[0];
    expect(body.name).toBe('Daily SITREP');
    expect(body.data.body).toContain('## {today}');
    expect(body.data.look.style).toBe('brief');
    expect(uiState.openNoteTemplate).toBe('nt_new');
    uiState.openNoteTemplate = null;
  });

  it('says how to make one when there is none', () => {
    open();
    expect(target.textContent).toContain('No Notebook templates yet. Keep one from a note, start one from a ready one, or import a file.');
  });
});

const rows = () => [...target.querySelectorAll('.tpl-row')];
// a section's own buttons, wherever they sit in it
function sectionButton(section, text) {
  return [...section.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
}
const rowOf = (name) => rows().find((row) => row.querySelector('.tpl-name').textContent === name);
const button = (row, text) =>
  [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const toggle = (name) => rowOf(name).querySelector('button[aria-pressed]');

describe('Duplicate', () => {
  it('is on every row of both kinds, and hands up the kind and the template', () => {
    open();
    expect(rows()).toHaveLength(3);
    for (const row of rows()) expect(button(row, 'Duplicate')).toBeTruthy();

    button(rowOf('House proof'), 'Duplicate').click();
    expect(props.duplicateTemplate).toHaveBeenLastCalledWith('proof', PROOF);
    button(rowOf('Short'), 'Duplicate').click();
    expect(props.duplicateTemplate).toHaveBeenLastCalledWith('post', SHORT);
    expect(props.editTemplate).not.toHaveBeenCalled();
  });
});

describe('the template new posts start with', () => {
  it('is offered on every post row, and asks about posts', () => {
    open();
    expect(toggle('House proof').getAttribute('title')).toBe('Start new proofs with this template');
    expect(toggle('Classic')).not.toBeNull();
    expect(toggle('Short')).not.toBeNull();
    expect(toggle('Short').getAttribute('title')).toBe('Start new posts with this template');
  });

  it('is none until one is chosen', () => {
    open();
    expect(target.querySelectorAll('.tpl-tag')).toHaveLength(0);
    expect(toggle('House proof').getAttribute('aria-pressed')).toBe('false');
    expect(toggle('Classic').getAttribute('aria-pressed')).toBe('false');
    expect(toggle('Short').getAttribute('aria-pressed')).toBe('false');
  });

  it('asks the parent to save the one pressed', () => {
    open();
    toggle('Short').click();
    expect(props.savePrefs).toHaveBeenCalledWith({ post_template: 'po_2' });
  });

  it('marks the default row, and only that one', () => {
    prefs.postTemplate = 'po_2';
    open();
    expect(toggle('Short').getAttribute('aria-pressed')).toBe('true');
    expect(toggle('Classic').getAttribute('aria-pressed')).toBe('false');
    const tags = [...target.querySelectorAll('.tpl-tag')];
    expect(tags.map((tag) => tag.textContent)).toEqual(['Default']);
    expect(rowOf('Short').contains(tags[0])).toBe(true);
  });

  it('is cleared by pressing it again', () => {
    prefs.postTemplate = 'po_2';
    open();
    toggle('Short').click();
    expect(props.savePrefs).toHaveBeenCalledWith({ post_template: '' });
  });

  it('moves to another row when that one is pressed', () => {
    prefs.postTemplate = 'po_2';
    open();
    toggle('Classic').click();
    expect(props.savePrefs).toHaveBeenCalledWith({ post_template: 'po_1' });
  });

  it('follows the saved preference when it changes', () => {
    open();
    prefs.postTemplate = 'po_1';
    flushSync();
    expect(toggle('Classic').getAttribute('aria-pressed')).toBe('true');
    expect(target.querySelectorAll('.tpl-tag')).toHaveLength(1);
  });
});

describe('the template New proof starts with', () => {
  const HOUSE = { id: 'pf_2', name: 'Free black', data: { bg: '#000000', layout: 'free', font: 'barlow' } };

  beforeEach(() => {
    templatesState.proof = [PROOF, HOUSE];
  });

  it('is pressed on the proof row to choose it, and pressed again to clear it', () => {
    open();
    toggle('Free black').click();
    expect(props.savePrefs).toHaveBeenCalledWith({ proof_template: 'pf_2' });
    prefs.proofTemplate = 'pf_2';
    flushSync();
    toggle('Free black').click();
    expect(props.savePrefs).toHaveBeenLastCalledWith({ proof_template: '' });
  });

  it('marks its own row and leaves the post default alone', () => {
    prefs.proofTemplate = 'pf_2';
    prefs.postTemplate = 'po_1';
    open();
    expect(toggle('Free black').getAttribute('aria-pressed')).toBe('true');
    expect(toggle('House proof').getAttribute('aria-pressed')).toBe('false');
    expect(rowOf('Free black').querySelector('.tpl-tag').textContent).toBe('Default');
    expect(rowOf('Classic').querySelector('.tpl-tag').textContent).toBe('Default');
    expect(target.querySelectorAll('.tpl-tag')).toHaveLength(2);
  });

  it('shows each proof template by a sketch of its page and its layout in words', () => {
    open();
    expect(rowOf('Free black').querySelector('svg.pts-sketch')).not.toBeNull();
    expect(rowOf('Free black').textContent).toContain('Free layout · Barlow Condensed');
    expect(rowOf('House proof').textContent).toContain('Side by side · ');
  });
});

describe('post templates per kind', () => {
  const FREE = { id: 'po_f', name: 'Free words', data: { body: '#description', kind: 'free' } };
  const PLATE = { id: 'po_p', name: 'Plate credits', data: { body: '#credits', kind: 'plate' } };
  const COMPARE = { id: 'po_c', name: 'Before after', data: { body: '#description\n\n#date', kind: 'compare' } };
  const kinds = () => [...target.querySelectorAll('[data-guide="settings.report-templates"] .tpl-kind')]
    .map((h) => h.textContent.trim());

  beforeEach(() => {
    templatesState.post = [CLASSIC, FREE, SHORT, PLATE, COMPARE];
    prefs.postKindTemplates = {};
  });
  afterEach(() => {
    prefs.postKindTemplates = {};
  });

  it('lists them under their kind, the ones from before under Geolocation', () => {
    open();
    expect(target.querySelector('[data-guide="settings.report-templates"] h3').textContent).toBe('Post templates');
    expect(kinds()).toEqual(['Geolocation', 'Map plate', 'Compare', 'Free post']);
    expect(toggle('Free words').getAttribute('title')).toBe('Start new free posts with this template');
    expect(toggle('Before after').getAttribute('title')).toBe('Start new compare posts with this template');
  });

  it('keeps a default for each kind, Geolocation\'s where it always was', () => {
    prefs.postTemplate = 'po_1';
    prefs.postKindTemplates = { free: 'po_f' };
    open();
    expect(toggle('Classic').getAttribute('aria-pressed')).toBe('true');
    expect(toggle('Free words').getAttribute('aria-pressed')).toBe('true');
    expect(toggle('Plate credits').getAttribute('aria-pressed')).toBe('false');
    expect(target.querySelectorAll('.tpl-tag')).toHaveLength(2);

    toggle('Plate credits').click();
    expect(props.savePrefs).toHaveBeenLastCalledWith({ post_kind_templates: { free: 'po_f', plate: 'po_p' } });
    toggle('Before after').click();
    expect(props.savePrefs).toHaveBeenLastCalledWith({ post_kind_templates: { free: 'po_f', compare: 'po_c' } });
    toggle('Free words').click();
    expect(props.savePrefs).toHaveBeenLastCalledWith({ post_kind_templates: {} });
    toggle('Short').click();
    expect(props.savePrefs).toHaveBeenLastCalledWith({ post_template: 'po_2' });
  });

  it('starts a new one from a kind\'s layouts, a video thread from one of its four orders', () => {
    open();
    target.querySelector('[data-new-post-template]').click();
    flushSync();
    const menu = document.querySelector('.float-menu[aria-label="New post template"]');
    const items = [...menu.querySelectorAll('.fm-item')];
    expect(items.map((b) => b.textContent.trim())).toEqual([
      'Classic', 'Coordinates only', 'Short', 'With date', 'Recap first', 'Video first', 'Proof first', 'All in one',
      'Plate', 'Before and after', 'Dates first', 'Text and source',
    ]);
    expect(items.every((b) => !b.disabled)).toBe(true);
    items.find((b) => b.textContent.trim() === 'Proof first').click();
    flushSync();
    expect(props.newTemplate).toHaveBeenCalledWith('post', expect.objectContaining({
      kind: 'video', starter: expect.objectContaining({ id: 'proof', order: 'proof' }),
    }));
    target.querySelector('[data-new-post-template]').click();
    flushSync();
    [...document.querySelectorAll('.float-menu[aria-label="New post template"] .fm-item')].find((b) => b.textContent.trim() === 'Plate').click();
    flushSync();
    expect(props.newTemplate).toHaveBeenCalledWith('post', expect.objectContaining({ kind: 'plate', starter: expect.objectContaining({ id: 'plate' }) }));
    expect(document.querySelector('.float-menu[aria-label="New post template"]')).toBeNull();
  });

  it('starts a Compare one from its before and after layout', () => {
    open();
    target.querySelector('[data-new-post-template]').click();
    flushSync();
    const menu = document.querySelector('.float-menu[aria-label="New post template"]');
    expect([...menu.querySelectorAll('.fm-head')].map((h) => h.textContent.trim())).toContain('Compare');
    [...menu.querySelectorAll('.fm-item')].find((b) => b.textContent.trim() === 'Before and after').click();
    flushSync();
    expect(props.newTemplate).toHaveBeenCalledWith('post', expect.objectContaining({
      kind: 'compare', starter: expect.objectContaining({ body: '#description\n\n#date\n\n#credits\n\n#mention' }) }));
  });
});
