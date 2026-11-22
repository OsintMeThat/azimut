// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The Export for review dialog: what leaves and what stays, said from the server's reading
 * before anything is written; the author fields, prefilled; the press with its busy state;
 * then the file's name and Show in folder.
 */

const get = vi.fn();
const post = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: { get, post } }));
const { default: ReviewExportDialog } = await import('./ReviewExportDialog.svelte');

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
const button = (words) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(words));

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
  const onclose = vi.fn();
  const onbeforeexport = vi.fn(async () => {});
  live = mount(ReviewExportDialog, { target, props: { caseId: 'c 1', noteId: 'n1', onclose, onbeforeexport, ...props } });
  return { onclose, onbeforeexport };
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

it('writes the note first, exports with the fields as typed, then offers the download and the folder', async () => {
  get.mockResolvedValue(SHOWN);
  let finish;
  post.mockImplementation((url) => (url.endsWith('/review')
    ? Promise.resolve({ job_id: 'j1', state: 'queued', file: SHOWN.file })
    : Promise.resolve({ status: 'revealed' })));
  get.mockImplementation((url) => (url.includes('/bundle/jobs/')
    ? new Promise((resolve) => { finish = resolve; })
    : Promise.resolve(SHOWN)));
  const { onbeforeexport } = show();
  await settle();
  const input = document.querySelector('input.input');
  input.value = '  Guest Analyst ';
  input.dispatchEvent(new Event('input'));
  button('Export').click();
  await settle();
  expect(onbeforeexport).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith('/api/cases/c%201/notes/n1/review', { author: 'Guest Analyst', picture: 'e_piece00001' });
  // busy while the job runs
  expect(button('Exporting…').disabled).toBe(true);
  finish({ id: 'j1', state: 'ready', file: SHOWN.file });
  await settle();
  expect(text('.review-done')).toBe(`Written: ${SHOWN.file}`);
  // the main press is the download, by the route a whole case's export uses
  const download = button('Download');
  expect(download.classList.contains('btn-primary')).toBe(true);
  const opened = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { opened.push(this.getAttribute('href')); });
  download.click();
  click.mockRestore();
  expect(opened).toEqual(['/api/cases/c%201/bundle/jobs/j1/download']);
  button('Show in folder').click();
  await settle();
  expect(post).toHaveBeenLastCalledWith('/api/cases/c%201/bundle/reveal');
});

it('says why an export failed and keeps the dialog open', async () => {
  post.mockResolvedValue({ job_id: 'j2', state: 'queued', file: SHOWN.file });
  get.mockImplementation((url) => (url.includes('/bundle/jobs/')
    ? Promise.resolve({ id: 'j2', state: 'failed', error: 'not enough free space' })
    : Promise.resolve(SHOWN)));
  const { onclose } = show();
  await settle();
  button('Export').click();
  await settle();
  expect(text('.review-problem')).toBe('Could not export the note: not enough free space');
  expect(onclose).not.toHaveBeenCalled();
  expect(button('Export').disabled).toBe(false);
});
