// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The Archive every link dialog: what a press would do, said from the plan alone; the
 * ticks; the press; a row per link as the run goes, Stop and Keep going; and once it
 * ends, what it did and Try again.
 */

const get = vi.fn();
const post = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: { get, post } }));
vi.mock('../../lib/state.svelte.js', () => ({ toast: vi.fn() }));
const { default: ArchiveLinks } = await import('./ArchiveLinks.svelte');
const { forgetRuns, POLL_MS } = await import('../../lib/notes/linkArchive.svelte.js');

const FOLDER = 'Links of “Front”';
const LINKS = [
  { url: 'https://www.aljazeera.com/a', text: 'Al Jazeera, 10 Sep', state: 'todo', copy: '', made: '', held: false },
  { url: 'https://www.bbc.com/b', text: 'BBC, 5 Oct', state: 'todo', copy: '', made: '', held: true },
  { url: 'https://example.org/c', text: 'Mereja', state: 'archived', copy: 'https://web.archive.org/web/20260302120000/https://example.org/c',
    made: '2026-03-02', held: true },
];
const PLAN = { links: LINKS, total: 3, todo: 2, archived: 1, filed: 1, more_internal: 2, folder: FOLDER, max: 500, run: null };

const counts = (archived, failed = 0) => ({ total: 2, archived, new: archived, kept: 0, older: 0, failed });
const RUNNING = {
  state: 'running', internal: false, fresh: false, folder: FOLDER, left: 720, counts: counts(1),
  links: [
    { url: LINKS[0].url, text: LINKS[0].text, state: 'new', copy: 'https://web.archive.org/web/20261118093000/https://www.aljazeera.com/a',
      made: '2026-11-18T09:30:00Z' },
    { url: LINKS[1].url, text: LINKS[1].text, state: 'saving' },
  ],
};
const ENDED = {
  ...RUNNING, state: 'done', left: 0, counts: counts(1, 1),
  links: [RUNNING.links[0], { url: LINKS[1].url, text: LINKS[1].text, state: 'failed', reason: 'The page no longer answers.' }],
};

let live;
let target;
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); flushSync(); };
const button = (text) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(text));
const rows = () => [...document.querySelectorAll('.links li')].map((node) => node.textContent.replace(/\s+/g, ' ').trim());
const head = () => document.querySelector('.head').textContent.replace(/\s+/g, ' ').trim();

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(() => {
  if (live) unmount(live);
  live = null;
  target.remove();
  forgetRuns();
  vi.useRealTimers();
});

function show(props = {}) {
  const onclose = vi.fn();
  live = mount(ArchiveLinks, { target, props: { caseId: 'c1', noteId: 'n1', title: 'Front', onclose, ...props } });
  return { onclose };
}

it('says what the press does before anything goes, and reaches nothing on opening', async () => {
  get.mockResolvedValue(PLAN);
  show();
  await settle();
  expect(get).toHaveBeenCalledWith('/api/cases/c1/notes/n1/archive');
  expect(post).not.toHaveBeenCalled();
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog.getAttribute('aria-label')).toBe('Archive every link of this note');
  expect(dialog.textContent).toContain('Sends each address to the Internet Archive (web.archive.org)');
  expect(dialog.textContent).toContain('The archive learns which pages the note cites');
  expect(dialog.textContent).toContain('Links of the public edition (3)');
  expect(dialog.textContent).toContain('Links in internal passages stay out unless you tick the next line.');
  expect(dialog.textContent).toContain('Include internal passages (2 more links)');
  expect(dialog.textContent).toContain('Make fresh copies, even where one is under 30 days old');
  expect(head()).toBe('2 links to archive · 1 archived already · 1 filed as a bookmark');
  expect(rows()).toEqual(['Al Jazeera, 10 Sep to archive · new bookmark', 'BBC, 5 Oct to archive', 'Mereja archived 2 Mar']);
  expect(document.querySelector('.links li:last-child a').getAttribute('href')).toBe(LINKS[2].copy);
  expect(document.querySelector('.filed').textContent).toBe(`Links the case lacks are filed as bookmarks in the folder ${FOLDER}.`);
  expect(button('Archive 2 links').disabled).toBe(false);
});

it('reads the plan again with the internal passages ticked in', async () => {
  get.mockResolvedValueOnce(PLAN).mockResolvedValueOnce({ ...PLAN, total: 5, todo: 4, more_internal: 0 });
  show();
  await settle();
  const internal = [...document.querySelectorAll('input[type="checkbox"]')][0];
  internal.checked = true;
  internal.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  expect(get).toHaveBeenLastCalledWith('/api/cases/c1/notes/n1/archive?internal=true');
  expect(document.querySelector('[role="dialog"]').textContent).toContain('Links of the note (5)');
  expect(button('Archive 4 links')).toBeTruthy();
});

it('presses with the ticks, then shows each link as the run goes, and Stop asks it to stop', async () => {
  get.mockResolvedValueOnce(PLAN);
  post.mockResolvedValueOnce({ run: { ...RUNNING, state: 'queued', counts: counts(0), links: RUNNING.links.map((link) => ({ ...link, state: 'waiting' })) } });
  show();
  await settle();
  const fresh = [...document.querySelectorAll('input[type="checkbox"]')][1];
  fresh.checked = true;
  fresh.dispatchEvent(new Event('change', { bubbles: true }));
  button('Archive 2 links').click();
  await settle();
  expect(post).toHaveBeenCalledWith('/api/cases/c1/notes/n1/archive', { internal: false, fresh: true });
  expect(head()).toBe('0 of 2 archived about 12 minutes left · you can close this');
  expect(rows()).toEqual(['Al Jazeera, 10 Sep waiting', 'BBC, 5 Oct waiting']);
  // the ticks are what the run was asked, no longer choices
  expect([...document.querySelectorAll('input[type="checkbox"]')].every((box) => box.disabled)).toBe(true);

  get.mockResolvedValue({ run: RUNNING });
  await vi.advanceTimersByTimeAsync(POLL_MS);
  await settle();
  expect(head()).toBe('1 of 2 archived about 12 minutes left · you can close this');
  expect(rows()[0]).toMatch(/^Al Jazeera, 10 Sep new copy, 18 Nov \d\d:\d\d$/);
  expect(rows()[1]).toBe('BBC, 5 Oct saving…');
  expect(document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('50');
  expect(button('Keep going in the background')).toBeTruthy();

  post.mockResolvedValueOnce({ run: { ...RUNNING, state: 'stopping' } });
  button('Stop').click();
  await settle();
  expect(post).toHaveBeenLastCalledWith('/api/cases/c1/notes/n1/archive/stop', {});
  expect(head()).toContain('stopping after this link');
  expect(button('Stop').disabled).toBe(true);
});

it('keeps the run on screen once it ends, with Try again for what failed', async () => {
  get.mockResolvedValueOnce({ ...PLAN, run: { ...RUNNING } });
  const { onclose } = show();
  await settle();
  expect(head()).toContain('1 of 2 archived');
  get.mockResolvedValueOnce({ run: ENDED });
  await vi.advanceTimersByTimeAsync(POLL_MS);
  await settle();
  expect(head()).toBe('1 of 2 archived · 1 failed');
  expect(rows()[1]).toBe('BBC, 5 Oct The page no longer answers.');
  expect(document.querySelector('.links li:last-child').dataset.state).toBe('failed');

  get.mockResolvedValueOnce({ ...PLAN, links: [LINKS[1]], total: 1, todo: 1, archived: 0, filed: 0, run: ENDED });
  post.mockResolvedValueOnce({ run: { ...RUNNING, state: 'queued', counts: { ...counts(0), total: 1 }, links: [{ ...RUNNING.links[1], state: 'waiting' }] } });
  button('Try the 1 again').click();
  await settle();
  expect(post).toHaveBeenLastCalledWith('/api/cases/c1/notes/n1/archive', { internal: false, fresh: false });
  expect(rows()).toEqual(['BBC, 5 Oct waiting']);
  button('Keep going in the background').click();
  expect(onclose).toHaveBeenCalled();
});

it('says why a run stopped, and a refused press in the dialog', async () => {
  const stopped = { ...ENDED, state: 'stopped', reason: 'Could not reach the Internet Archive. What was done is kept.' };
  get.mockResolvedValueOnce(PLAN).mockResolvedValueOnce({ run: stopped });
  post.mockResolvedValueOnce({ run: { ...RUNNING } });
  show();
  await settle();
  button('Archive 2 links').click();
  await settle();
  await vi.advanceTimersByTimeAsync(POLL_MS);
  await settle();
  expect(head()).toBe('1 of 2 archived · 1 failed Could not reach the Internet Archive. What was done is kept.');
  expect(button('Close')).toBeTruthy();

  unmount(live);
  live = null;
  forgetRuns();
  get.mockResolvedValueOnce(PLAN);
  post.mockRejectedValueOnce(new Error('The links of this note are being archived already.'));
  show();
  await settle();
  button('Archive 2 links').click();
  await settle();
  expect(document.querySelector('[role="alert"]').textContent).toBe('The links of this note are being archived already.');
});

it('has nothing to press when every link has a copy', async () => {
  get.mockResolvedValue({ ...PLAN, links: [LINKS[2]], total: 1, todo: 0, archived: 1, filed: 0, more_internal: 0 });
  show();
  await settle();
  expect(button('Every link is archived').disabled).toBe(true);
  expect(document.querySelector('[role="dialog"]').textContent).not.toContain('Include internal passages');
});

it('lists the links still to archive first, each saying why it failed last time', async () => {
  const archived = { ...LINKS[0], state: 'archived', copy: 'https://web.archive.org/web/20261118093000/https://www.aljazeera.com/a', made: '2026-11-18' };
  get.mockResolvedValue({ ...PLAN, links: [archived, LINKS[1], LINKS[2]], todo: 1, archived: 2, filed: 0, more_internal: 0, run: ENDED });
  show();
  await settle();
  expect(rows()).toEqual(['BBC, 5 Oct last time: the page no longer answers.', 'Al Jazeera, 10 Sep archived 18 Nov', 'Mereja archived 2 Mar']);
  expect(document.querySelector('.links li:first-child .said').classList.contains('again')).toBe(true);
  expect(document.querySelector('[role="dialog"]').textContent).toContain('Last time 1 of 2 archived · 1 failed; the press tries the rest again.');
});
