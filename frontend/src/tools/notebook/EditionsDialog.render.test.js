// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The Editions dialog's What changed: the two texts picked above the list, the newest
 * against the note now at first; Compare shows each figure's sentence and the words
 * paragraph by paragraph; Write the correction from this drafts the line, which is
 * edited in place and opens the export with it. Nothing is written or sent by any press.
 */

const get = vi.fn();
const post = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: { get, post } }));
const { default: EditionsDialog } = await import('./EditionsDialog.svelte');
const { correctionFor, reloadEditions } = await import('../../lib/notes/editions.svelte.js');

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const page = (at, text) => ({
  at, edition: 'public', format: 'html', file: `Front - public - ${at.slice(0, 10)}.html`, folder: 'exports',
  sha256: 'c'.repeat(64), text_sha256: text,
});
const LISTED = {
  editions: [page('2026-11-19T14:03:00Z', B), page('2026-11-18T09:30:00Z', A),
    { at: '2026-11-17T08:00:00Z', edition: 'internal', file: 'Front - internal - 2026-11-17.pdf', folder: 'exports', pages: 3,
      pdf_sha256: 'd'.repeat(64), text_sha256: 'e'.repeat(64) }],
  kept: [B, A],
};
const COMPARED = {
  same: false,
  sentences: [
    { kind: 'chart', figure: 'chart:6', said: 'The chart “At least 41 armoured vehicles…” now counts 42, not 41.' },
    { kind: 'chart', figure: 'chart:6', said: 'The chart “At least 41 armoured vehicles…” gains the row “Harrow Tygor E1”.' },
    { kind: 'picture', figure: 'picture:3', said: '“Figure 1” shows another picture: “tygor” in place of “m-atv”.',
      short: '“Figure 1” shows another picture.' },
  ],
  paragraphs: [
    { state: 'changed', under: 'Summary', heading: false, parts: [['=', '… at least'], ['-', '41'], ['+', '42'], ['=', 'of them armoured.']] },
    { state: 'removed', under: 'Method', heading: false, parts: [['-', 'We counted once.']] },
  ],
  unchanged: 14,
  more: 0,
};

let live;
let target;
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); flushSync(); };
const button = (text) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(text));
const said = (selector) => [...document.querySelectorAll(selector)].map((node) => node.textContent.replace(/\s+/g, ' ').trim());

function memory() {
  const kept = new Map();
  return { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, String(value)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  reloadEditions(memory());
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(() => {
  if (live) unmount(live);
  live = null;
  target.remove();
});

function show(props = {}) {
  const onclose = vi.fn();
  const onexport = vi.fn();
  live = mount(EditionsDialog, { target, props: { caseId: 'c1', noteId: 'n1', title: 'Front', onclose, onexport, ...props } });
  return { onclose, onexport };
}

it('offers the kept texts above the list, the newest against the note now, and asks nothing more', async () => {
  get.mockResolvedValue(LISTED);
  show();
  await settle();
  const bar = document.querySelector('section.compare');
  expect(bar.getAttribute('aria-label')).toBe('What changed');
  const [from, to] = bar.querySelectorAll('select');
  expect([...from.options].map((option) => option.value)).toEqual([B, A]);
  expect([...to.options].map((option) => option.textContent.trim())[0]).toBe('The note now');
  expect(from.value).toBe(B);
  expect(to.value).toBe('now');
  expect(post).not.toHaveBeenCalled();
  // the list is still there, under it
  expect(document.querySelectorAll('ul.list li')).toHaveLength(3);
});

it('has no What changed while no public text was kept', async () => {
  get.mockResolvedValue({ editions: LISTED.editions, kept: [] });
  show();
  await settle();
  expect(document.querySelector('section.compare')).toBeNull();
});

it('shows each figure in a sentence and the words paragraph by paragraph', async () => {
  get.mockResolvedValue(LISTED);
  post.mockResolvedValue(COMPARED);
  show();
  await settle();
  button('Compare').click();
  await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/c1/notes/n1/editions/compare', { before: B, after: 'now' });
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog.getAttribute('aria-label')).toBe('What changed');
  expect(said('.between p')[0]).toMatch(/^From Edition 2 · 19 Nov( 2026)?, \d\d:\d\d · HTML to the note now$/);
  expect(said('.sentences li')).toEqual([
    'The chart “At least 41 armoured vehicles…” now counts 42, not 41.',
    'The chart “At least 41 armoured vehicles…” gains the row “Harrow Tygor E1”.',
    '“Figure 1” shows another picture: “tygor” in place of “m-atv”.',
  ]);
  const first = document.querySelector('.para');
  expect(first.querySelector('del').textContent).toBe('41');
  expect(first.querySelector('ins').textContent).toBe('42');
  expect(said('.para .place')).toEqual(['Under “Summary”', 'Under “Method” · paragraph taken out']);
  expect(said('.tally')[0]).toBe('14 paragraphs unchanged.');
  // back to the list, as it was
  button('‹ Editions').click();
  flushSync();
  expect(document.querySelector('section.compare')).not.toBeNull();
});

it('says so when the two texts are the same, and offers no correction', async () => {
  get.mockResolvedValue(LISTED);
  post.mockResolvedValue({ same: true, sentences: [], paragraphs: [], unchanged: 0, more: 0 });
  show();
  await settle();
  button('Compare').click();
  await settle();
  expect(document.querySelector('[role="dialog"]').textContent).toContain('Nothing changed: the two texts are the same.');
  expect(button('Write the correction')).toBeUndefined();
});

it('drafts the correction, lets it be edited, and opens the export with it', async () => {
  get.mockResolvedValue(LISTED);
  post.mockResolvedValue(COMPARED);
  const { onexport } = show();
  await settle();
  button('Compare').click();
  await settle();
  expect(button('Export with this line')).toBeUndefined();
  button('Write the correction from this').click();
  flushSync();
  const field = document.querySelector('#correction-line');
  expect(field.value).toBe('The chart “At least 41 armoured vehicles…” now counts 42, not 41. '
    + '“Figure 1” shows another picture. Text revised in “Summary” and “Method”.');
  expect(field.maxLength).toBe(300);
  field.value = 'The armoured count is now at least 42; Figure 1 shows the right vehicle.';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  expect(correctionFor('c1', 'n1')).toBe('');
  button('Export with this line').click();
  expect(onexport).toHaveBeenCalledTimes(1);
  expect(correctionFor('c1', 'n1')).toBe('The armoured count is now at least 42; Figure 1 shows the right vehicle.');
  // the press asked nothing of the server
  expect(post).toHaveBeenCalledTimes(1);
});
