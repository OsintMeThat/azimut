// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The case's notes, to pick one: Notes in the sidebar pins one to the side
 * through this list, and the note on the side picks what it shows from it.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: { get } }));

const { default: NotePicker } = await import('./NotePicker.svelte');

const row = (id, title, updated, extra = {}) => ({ id, title, folder: '', updated_at: updated, look: null, includes: 0, ...extra });

let target;
let app;
let anchor;

afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  anchor?.remove();
  document.querySelectorAll('.float-menu').forEach((node) => node.remove());
  app = null;
  vi.clearAllMocks();
});

async function picker(items, props = {}) {
  get.mockResolvedValue({ items });
  target = document.createElement('div');
  anchor = document.createElement('button');
  document.body.append(target, anchor);
  app = mount(NotePicker, { target, props: { caseId: 'c1', anchor, onpick: vi.fn(), onclose: vi.fn(), ...props } });
  for (let round = 0; round < 4; round += 1) await Promise.resolve();
  flushSync();
}

const menu = () => document.querySelector('.float-menu');
const names = () => [...menu().querySelectorAll('.fm-item .fm-grow')].map((node) => node.textContent.trim());
const press = (words) => [...menu().querySelectorAll('button')].find((button) => button.textContent.trim() === words).click();

describe('the notes to pick from', () => {
  it('lists Case notes first, then the notes last written, read from the case', async () => {
    await picker([
      row('case', 'Case notes', '2026-11-04T10:00:00Z'),
      row('n1', 'Old lead', '2026-09-01T10:00:00Z', { folder: 'Leads' }),
      row('n2', 'Weekly', '2026-11-01T10:00:00Z', { look: { style: 'brief' } }),
    ]);
    expect(get).toHaveBeenCalledWith('/api/cases/c1/notes/index');
    expect(names()).toEqual(['Case notes', 'Weekly', 'Old lead']);
    expect(menu().textContent).toContain('Leads');
    expect(menu().querySelector('input')).toBeNull();
  });

  it('hands up the note pressed, null for Case notes', async () => {
    const onpick = vi.fn();
    await picker([row('n1', 'Old lead', '2026-09-01T10:00:00Z')], { onpick });
    press('Old lead');
    press('Case notes');
    expect(onpick.mock.calls).toEqual([['n1'], [null]]);
  });

  it('marks the note already showing, and none when nothing is', async () => {
    await picker([row('n1', 'Old lead', '2026-09-01T10:00:00Z')], { current: 'n1' });
    expect([...menu().querySelectorAll('[aria-current="true"]')].map((node) => node.textContent.trim())).toEqual(['Old lead']);
    unmount(app);
    app = null;
    document.querySelectorAll('.float-menu').forEach((node) => node.remove());
    await picker([row('n1', 'Old lead', '2026-09-01T10:00:00Z')]);
    expect(menu().querySelector('[aria-current]')).toBeNull();
  });

  it('finds a note by its name or folder once there are many', async () => {
    const many = Array.from({ length: 8 }, (_, index) => row(`n${index}`, `Lead ${index}`, `2026-10-0${index + 1}T10:00:00Z`));
    many.push(row('n9', 'Rooftop', '2026-09-01T10:00:00Z', { folder: 'Yemen' }));
    await picker(many);
    const field = menu().querySelector('input[aria-label="Find a note"]');
    field.value = 'yemen';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(names()).toEqual(['Rooftop']);
    field.value = 'nothing like it';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(menu().textContent).toContain('No note by that name.');
  });

  it('opens a note in the Notebook, or the Notebook\'s home, when offered', async () => {
    const onnotebook = vi.fn();
    const onhome = vi.fn();
    await picker([row('n1', 'Old lead', '2026-09-01T10:00:00Z')], { onnotebook, onhome, intro: 'Pick a note to keep on the side as you work.' });
    expect(menu().textContent).toContain('Pick a note to keep on the side as you work.');
    menu().querySelector('button[aria-label="Open Old lead in the Notebook"]').click();
    menu().querySelector('button[aria-label="Open Case notes in the Notebook"]').click();
    expect(onnotebook.mock.calls).toEqual([['n1'], [null]]);
    press('All notes in the Notebook');
    expect(onhome).toHaveBeenCalled();
  });

  it('offers neither without a way to open them', async () => {
    await picker([row('n1', 'Old lead', '2026-09-01T10:00:00Z')]);
    expect(menu().querySelector('.open')).toBeNull();
    expect(menu().textContent).not.toContain('All notes in the Notebook');
  });

  it('keeps Case notes on offer when the list cannot be read', async () => {
    get.mockRejectedValue(new Error('offline'));
    target = document.createElement('div');
    anchor = document.createElement('button');
    document.body.append(target, anchor);
    app = mount(NotePicker, { target, props: { caseId: 'c1', anchor, onpick: vi.fn(), onclose: vi.fn() } });
    for (let round = 0; round < 4; round += 1) await Promise.resolve();
    flushSync();
    expect(names()).toEqual(['Case notes']);
    expect(menu().textContent).toContain('The notes could not be listed.');
  });
});
