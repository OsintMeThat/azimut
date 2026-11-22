// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The export dialog's For review branch: what leaves and what stays, said from the server's
 * reading before anything is written; the author fields, prefilled; then what the dialog's own
 * buttons call: `send()`, `download()` and `reveal()`.
 */

const get = vi.fn();
const post = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: { get, post } }));
const { default: ReviewExport } = await import('./ReviewExport.svelte');

const SHOWN = {
  title: 'Harbour article',
  file: 'Harbour article (for review).azimut.zip',
  groups: [
    { key: 'note', label: 'Note', count: 1, names: ['Harbour article'] },
    { key: 'chapters', label: 'Chapters', count: 1, names: ['Background'] },
    { key: 'pictures', label: 'Pictures', count: 14, names: ['Photo', 'Gate proof'] },
    { key: 'layers', label: 'Map layers', count: 2, names: ['Checkpoints', 'Working checkpoints'] },
    { key: 'sources', label: 'Sources', count: 3, names: ['@harbourwatch', 'Tower', 'Harbour watch thread'] },
  ],
  maps: ['Situation'],
  map_count: 1,
  size: 3 * 1024 * 1024,
  internal: 2,
  author: 'Guest Writer',
  picture: 'e_piece00001',
  pictures: [{ value: 'e_piece00001', label: 'Piece' }, { value: 'logo', label: 'Your logo' }],
};

let live;
let target;
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); flushSync(); };
const text = (selector) => document.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim();

beforeEach(() => {
  vi.clearAllMocks();
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(() => {
  if (live) unmount(live);
  live = null;
  target.remove();
});

function show(props = {}) {
  const prepare = vi.fn(async () => {});
  live = mount(ReviewExport, { target, props: { caseId: 'c 1', noteId: 'n1', prepare, ...props } });
  return { prepare, body: live };
}

it('says what leaves and what stays before anything is written', async () => {
  get.mockResolvedValue(SHOWN);
  show();
  await settle();
  expect(get).toHaveBeenCalledWith('/api/cases/c%201/notes/n1/review');
  expect(post).not.toHaveBeenCalled();
  const rows = [...document.querySelectorAll('.review-groups li')].map((node) => node.textContent.replace(/\s+/g, ' ').trim());
  expect(rows).toEqual([
    'Note (1) Harbour article',
    'Chapters (1) Background',
    'Pictures (14) Photo, Gate proof, and 12 more',
    'Map layers (2) Checkpoints, Working checkpoints',
    'Sources (3) @harbourwatch, Tower, Harbour watch thread',
    'Maps (1) Situation',
  ]);
  expect(text('.review-head')).toBe('What leaves 3 MB');
  expect(text('.review-stays')).toBe('2 internal passages, left out of the text, and the rest of the case.');
  expect(document.body.textContent).toContain('their metadata included; a published page strips it.');
  expect(text('.review-invite')).toBe('Want it published on osintmethat.com under your name? Send this file at '
    + 'osintmethat.com/contribute: it is read first, and nothing goes online before you agree.');
  const link = document.querySelector('.review-invite a');
  expect(link.getAttribute('href')).toBe('https://osintmethat.com/contribute');
  expect(link.getAttribute('rel')).toContain('noopener');
});

it('prefills the author from the note, and reads again when another picture is picked', async () => {
  get.mockResolvedValue(SHOWN);
  show();
  await settle();
  expect(document.querySelector('input.input').value).toBe('Guest Writer');
  const select = document.querySelector('select');
  expect([...select.options].map((option) => [option.value, option.textContent])).toEqual(
    [['e_piece00001', 'Piece'], ['logo', 'Your logo'], ['', 'None']]);
  get.mockResolvedValue({ ...SHOWN, picture: 'logo' });
  select.value = 'logo';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  expect(get).toHaveBeenLastCalledWith('/api/cases/c%201/notes/n1/review?picture=logo');
});

it('says the author signs the maps too, only when map pages go with the article', async () => {
  get.mockResolvedValue(SHOWN);
  show();
  await settle();
  expect(document.querySelector('.review-signs')).toBeNull();
  unmount(live);
  get.mockResolvedValue({ ...SHOWN, groups: [...SHOWN.groups, { key: 'pages', label: 'Map pages', count: 1, names: ['Harbour map'] }] });
  show();
  await settle();
  expect(text('.review-signs')).toBe('These sign the article and its maps.');
});

it('writes the note first, exports with the fields as typed, then downloads and shows the folder', async () => {
  post.mockImplementation((url) => (url.endsWith('/review')
    ? Promise.resolve({ job_id: 'j1', state: 'queued', file: SHOWN.file })
    : Promise.resolve({ status: 'revealed' })));
  get.mockImplementation((url) => (url.includes('/bundle/jobs/')
    ? Promise.resolve({ id: 'j1', state: 'ready', file: SHOWN.file })
    : Promise.resolve(SHOWN)));
  const { prepare, body } = show();
  await settle();
  const input = document.querySelector('input.input');
  input.value = '  Guest Analyst ';
  input.dispatchEvent(new Event('input'));
  await body.send();
  await settle();
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith('/api/cases/c%201/notes/n1/review', { author: 'Guest Analyst', picture: 'e_piece00001', videos: true });
  expect(text('.review-done')).toBe(`Written: ${SHOWN.file}`);
  const opened = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { opened.push(this.getAttribute('href')); });
  body.download();
  click.mockRestore();
  expect(opened).toEqual(['/api/cases/c%201/bundle/jobs/j1/download']);
  await body.reveal();
  expect(post).toHaveBeenLastCalledWith('/api/cases/c%201/bundle/reveal');
});

it('says why an export failed and stays on what leaves', async () => {
  post.mockResolvedValue({ job_id: 'j2', state: 'queued', file: SHOWN.file });
  get.mockImplementation((url) => (url.includes('/bundle/jobs/')
    ? Promise.resolve({ id: 'j2', state: 'failed', error: 'not enough free space' })
    : Promise.resolve(SHOWN)));
  const { body } = show();
  await settle();
  await body.send();
  await settle();
  expect(text('.review-problem')).toBe('Could not export the note: not enough free space');
  expect(document.querySelector('.review-done')).toBeNull();
  expect(document.querySelector('.review-groups')).not.toBeNull();
});

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const WITH_VIDEOS = { ...SHOWN, size: 900 * MB, videos: { count: 2, size: 525 * MB }, send_videos: true, limit: GB };
const box = () => document.querySelector('.review-videos input');

it('sends the source videos by default, and the size follows the box', async () => {
  get.mockResolvedValue(WITH_VIDEOS);
  post.mockResolvedValue({ job_id: 'j3', state: 'queued', file: SHOWN.file });
  show();
  await settle();
  expect(text('.review-videos')).toBe('Source videos (525 MB)');
  expect(document.querySelector('.review-videos').title).toBe('Videos the page only cites, never plays');
  expect(box().checked).toBe(true);
  expect(text('.review-head')).toBe('What leaves 900 MB');
  expect(document.querySelector('.review-limit')).toBeNull();
  box().click();
  flushSync();
  expect(text('.review-head')).toBe('What leaves 375 MB');
  // left behind by hand under the limit: nothing to say
  expect(document.querySelector('.review-limit')).toBeNull();
});

it('leaves the source videos behind when the whole would pass 1 GB, and says so', async () => {
  get.mockResolvedValue({ ...WITH_VIDEOS, size: GB + 200 * MB, send_videos: false });
  post.mockResolvedValue({ job_id: 'j4', state: 'queued', file: SHOWN.file });
  get.mockImplementation((url) => (url.includes('/bundle/jobs/')
    ? Promise.resolve({ id: 'j4', state: 'ready', file: SHOWN.file })
    : Promise.resolve({ ...WITH_VIDEOS, size: GB + 200 * MB, send_videos: false })));
  const { body } = show();
  await settle();
  expect(box().checked).toBe(false);
  expect(text('.review-head')).toBe('What leaves 699 MB');
  expect(text('.review-limit')).toBe(
    'osintmethat.com/contribute takes files up to 1 GB, so the source videos stay behind; tick to send them anyway.');
  box().click();
  flushSync();
  expect(text('.review-limit')).toBe('This is over the 1 GB the site takes.');
  box().click();
  flushSync();
  await body.send();
  expect(post).toHaveBeenCalledWith('/api/cases/c%201/notes/n1/review', { author: 'Guest Writer', picture: 'e_piece00001', videos: false });
});

it('says a file over 1 GB even without its videos is over what the site takes', async () => {
  get.mockResolvedValue({ ...WITH_VIDEOS, size: GB + 600 * MB, send_videos: false });
  show();
  await settle();
  expect(box().checked).toBe(false);
  expect(text('.review-limit')).toBe('This is over the 1 GB the site takes.');
});

it('shows no box when no source video goes', async () => {
  get.mockResolvedValue({ ...WITH_VIDEOS, videos: { count: 0, size: 0 } });
  show();
  await settle();
  expect(document.querySelector('.review-videos')).toBeNull();
});
