// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn();
vi.mock('../lib/api.js', () => ({ api: { get } }));

const { caseState, uiState, registerCaseChangeGuard } = await import('../lib/state.svelte.js');
const { loadEntityTypes } = await import('../lib/entityTypes.svelte.js');
const { holdsUnsaved } = await import('../lib/backButton.js');
const { default: CommandPalette } = await import('./CommandPalette.svelte');
const { default: CaseChangeGuard } = await import('./CaseChangeGuard.svelte');

const NOTE = { id: 'note-a', type: 'note', label: 'Harbour observations', attrs: { folder: 'Harbour' } };
const SHEET = { id: 'sheet-a', type: 'sheet', label: 'Geolocation index', attrs: { path: 'sheets/index.csv' } };
const CASES = [{ id: 'case-a', name: 'Harbour' }, { id: 'case-b', name: 'Airfield' }];
const TOOLS = [{ id: 'media', label: 'Media' }, { id: 'proof', label: 'Geo Proof' }, { id: 'sheet', label: 'Sheet' }];

let live;
let guardComponent;
let target;
const cleanups = [];

async function settle(ms = 0) {
  flushSync();
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  flushSync();
}

async function show(open = true) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(CommandPalette, { target, props: { open, tools: TOOLS } });
  guardComponent = mount(CaseChangeGuard, { target });
  await settle();
}

const input = () => document.querySelector('[role="combobox"]');
const options = () => [...document.querySelectorAll('[role="option"]')];
const option = (label) => options().find((node) => node.querySelector('.name').textContent === label);

async function search(text) {
  input().value = text;
  input().dispatchEvent(new Event('input', { bubbles: true }));
  await settle(160);
}

beforeEach(async () => {
  vi.useFakeTimers();
  get.mockReset();
  get.mockImplementation(async (path) => {
    if (path === '/api/cases/entity-types') return [
      { type: 'note', family: 'document', label: 'Note' },
      { type: 'sheet', family: 'document', label: 'Sheet' },
      { type: 'media', family: 'collected', label: 'Media' },
      { type: 'person', family: 'actor', label: 'Person' },
    ];
    const url = new URL(path, 'http://localhost');
    if (url.pathname === '/api/cases') {
      const query = url.searchParams.get('q')?.toLowerCase() ?? '';
      return CASES.filter((item) => item.name.toLowerCase().includes(query));
    }
    if (url.pathname.endsWith('/catalog/entities')) {
      const query = url.searchParams.get('q')?.toLowerCase() ?? '';
      const items = [NOTE, SHEET].filter((item) => item.label.toLowerCase().includes(query));
      return { items, total: items.length };
    }
    if (url.pathname === '/api/cases/case-b') return CASES[1];
    throw new Error(`Unexpected request: ${path}`);
  });
  await loadEntityTypes();
  get.mockClear();
  caseState.current = CASES[0];
  uiState.tool = 'media';
  uiState.openNotebook = null;
  uiState.openSheet = null;
  uiState.toasts = [];
});

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  if (live) unmount(live);
  if (guardComponent) unmount(guardComponent);
  live = null;
  target?.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('Go to', () => {
  it('reads nothing while closed and focuses the search when opened', async () => {
    await show(false);
    expect(get).not.toHaveBeenCalled();
    unmount(live);
    unmount(guardComponent);
    await show();
    expect(document.activeElement).toBe(input());
    expect(document.querySelector('[aria-label="Recently added"]')).not.toBeNull();
    expect(option(NOTE.label)).toBeDefined();
    const urls = get.mock.calls.map(([path]) => new URL(path, 'http://localhost'));
    const catalog = urls.find((url) => url.pathname.endsWith('/catalog/entities'));
    expect(catalog.searchParams.get('limit')).toBe('8');
    expect(catalog.searchParams.get('order')).toBe('-created');
    expect(catalog.searchParams.get('type')).toBe('note,sheet,media');
  });

  it('searches documents server-side and opens the chosen note', async () => {
    await show();
    await search('Harbour');
    expect(option(NOTE.label)).toBeDefined();
    expect(option(SHEET.label)).toBeUndefined();
    const request = get.mock.calls.find(([path]) => path.includes('/catalog/entities') && path.includes('q=Harbour'));
    expect(new URL(request[0], 'http://localhost').searchParams.get('limit')).toBe('20');
    option(NOTE.label).click();
    await settle();
    expect(uiState.openNotebook).toEqual({ noteId: NOTE.id });
    expect(uiState.tool).toBe('notebook');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens a sheet in Sheet instead of the Board', async () => {
    await show();
    option(SHEET.label).click();
    await settle();
    expect(uiState.tool).toBe('sheet');
    expect(uiState.openSheet).toBe(SHEET.id);
  });

  it('walks results with the arrows and opens with Enter', async () => {
    await show();
    await search('proof');
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    await settle();
    expect(options().filter((node) => node.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    expect(uiState.tool).toBe('proof');
  });

  it('keeps case changes behind the existing guard', async () => {
    await show();
    await search('Airfield');
    const guard = vi.fn(async () => false);
    cleanups.push(registerCaseChangeGuard(guard));
    option('Airfield').click();
    await settle();
    expect(guard).toHaveBeenCalledWith({ fromId: 'case-a', toId: 'case-b' });
    expect(caseState.current.id).toBe('case-a');
    expect(uiState.tool).toBe('media');
    expect(get.mock.calls.some(([path]) => path === '/api/cases/case-b')).toBe(false);
  });

  it('opens a chosen case on its overview', async () => {
    await show();
    await search('Airfield');
    option('Airfield').click();
    await settle();
    expect(caseState.current.id).toBe('case-b');
    expect(uiState.tool).toBe('overview');
  });

  it('asks before a case change can discard work, with Keep editing selected', async () => {
    cleanups.push(holdsUnsaved('proof', () => true));
    await show();
    await search('Airfield');
    option('Airfield').click();
    await settle();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog.textContent).toContain('Unsaved work');
    expect(document.activeElement.textContent).toBe('Keep editing');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(caseState.current.id).toBe('case-a');
    expect(get.mock.calls.some(([path]) => path === '/api/cases/case-b')).toBe(false);
  });

  it('changes case after the unsaved-work confirmation', async () => {
    cleanups.push(holdsUnsaved('proof', () => true));
    await show();
    await search('Airfield');
    option('Airfield').click();
    await settle();
    [...document.querySelectorAll('[role="alertdialog"] button')].find((button) => button.textContent === 'Change case').click();
    await settle();
    expect(caseState.current.id).toBe('case-b');
    expect(uiState.tool).toBe('overview');
  });

  it('discards a slow result after the query changes', async () => {
    await show();
    const normal = get.getMockImplementation();
    let release;
    get.mockImplementation((path, options) => path.includes('q=Harbour') && path.includes('/catalog/entities')
      ? new Promise((resolve) => (release = resolve))
      : normal(path, options));
    await search('Harbour');
    await search('Geolocation');
    expect(option(SHEET.label)).toBeDefined();
    release({ items: [NOTE], total: 1 });
    await settle();
    expect(option(NOTE.label)).toBeUndefined();
    expect(option(SHEET.label)).toBeDefined();
  });

  it('cancels searches on close and returns focus to the invoking control', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    await show();
    const signals = get.mock.calls.map(([, options]) => options.signal);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps tools usable when a document request fails', async () => {
    get.mockImplementation(async (path) => {
      if (path.includes('/catalog/entities')) throw new Error('Offline');
      return [];
    });
    await show();
    expect(option('Media')).toBeDefined();
    expect(document.querySelector('[role="status"]').textContent).toContain('Could not load documents.');
  });

  it('shows truncation only for a search, not for the eight recently added items', async () => {
    const normal = get.getMockImplementation();
    get.mockImplementation(async (path, options) => {
      const response = await normal(path, options);
      return path.includes('/catalog/entities') ? { ...response, total: 80 } : response;
    });
    await show();
    expect(document.querySelector('[role="status"]').textContent).not.toContain('refine your search');
    await search('Harbour');
    expect(document.querySelector('[role="status"]').textContent).toContain('Showing 1 of 80 documents');
  });

  it('keeps results during a slow search and waits for fresh results on Enter', async () => {
    await show();
    const normal = get.getMockImplementation();
    let release;
    get.mockImplementation((path, options) => path.includes('q=Geolocation') && path.includes('/catalog/entities')
      ? new Promise((resolve) => (release = resolve)) : normal(path, options));
    input().value = 'Geolocation';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    await settle(100);
    expect(option(NOTE.label)).toBeDefined();
    expect(option(SHEET.label)).toBeDefined();
    expect(option('Airfield')).toBeDefined();
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle(60);
    expect(uiState.tool).toBe('media');
    release({ items: [SHEET], total: 1 });
    await settle();
    expect(uiState.tool).toBe('sheet');
    expect(uiState.openSheet).toBe(SHEET.id);
  });

  it('starts new words from the best match and marks what they matched', async () => {
    await show();
    for (let i = 0; i < 3; i += 1) {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    }
    await settle();
    expect(options().findIndex((node) => node.getAttribute('aria-selected') === 'true')).toBe(3);
    await search('harbour');
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    expect(option(NOTE.label).querySelector('b').textContent).toBe('Harbour');
  });

  it('marks scratch sessions separately from named cases', async () => {
    const normal = get.getMockImplementation();
    get.mockImplementation((path, options) => new URL(path, 'http://localhost').pathname === '/api/cases'
      ? Promise.resolve([{ id: 'scratch-a', name: 'Scratch session', scratch: true }]) : normal(path, options));
    await show();
    expect(option('Scratch session').textContent).toContain('Scratch');
    expect(option('Scratch session').querySelector('.detail').textContent).not.toContain('Case');
  });
});
