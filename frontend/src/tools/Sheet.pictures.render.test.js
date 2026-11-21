// @vitest-environment happy-dom
/**
 * A picture of the case in a sheet, drawn as a picture.
 *
 * A sheet made from a picture wall's rows arrives with its labels in the cells and its
 * pictures as links (`engine/sheets.adopt_chips`). The grid draws each linked picture's
 * thumbnail under its label, never the `[[media:…]]` code, and a cell's `@` in a picture
 * column leads with the case's pictures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const WALL_SHEET = {
  id: 'e_sheet',
  title: 'Wall rows',
  path: 'sheets/Wall rows.csv',
  columns: ['id', 'Picture', '#', 'Model'],
  rows: [
    ['r1', '#1', '1', 'Cougar'],
    ['r2', '#2', '2', 'M-ATV'],
    // a row pasted a moment ago, before the save that reads its chip
    ['r3', '[[media:e_frame3|#3]]', '3', 'Kirpi'],
    ['r4', '#4', '4', 'Kozak'],
  ],
  meta: {
    version: 6, widths: {}, hidden: [], sort: null, colours: {}, frozen: null,
    roles: { Picture: { kind: 'picture' } },
    links: { r1: { Picture: 'e_frame1' }, r2: { Picture: 'e_frame2' }, r4: { Picture: 'e_clip4' } },
  },
  pictures: {
    e_frame1: { label: 'frame-1.jpg', type: 'media', kind: 'image', thumb: 'media/.thumbs/f1.jpg' },
    e_frame2: { label: 'frame-2.jpg', type: 'media', kind: 'image', thumb: 'media/frame-2.jpg' },
    e_frame3: { label: 'frame-3.jpg', type: 'media', kind: 'image', thumb: 'media/.thumbs/f3.jpg' },
    e_clip4: { label: 'clip-4.mp4', type: 'media', kind: 'video', thumb: '' },
  },
  stamp: '1000-64',
  assigned: false,
};

const get = vi.fn();
const put = vi.fn(async (_path, body) => ({ status: 'saved', stamp: '2000-64', ...body }));
const post = vi.fn(async () => ({}));
const patch = vi.fn(async () => ({}));
const del = vi.fn(async () => ({}));
vi.mock('../lib/api.js', () => ({ api: { get, put, post, patch, del }, ApiError: Error }));

const toast = vi.fn();
const uiState = { tool: 'sheet', mapSheetPoints: null, timelineRange: null };
const reloadCase = vi.fn(async () => {});
vi.mock('../lib/state.svelte.js', async () => {
  const { caseState } = await import('../components/views.fixture.svelte.js');
  return { caseState, toast, uiState, reloadCase };
});
vi.mock('../components/EntityDetails.svelte', async () => await import('../components/Modal.svelte'));

const { default: Sheet } = await import('./Sheet.svelte');

let live = null;
let target = null;

async function settle() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  flushSync();
}

const PICTURES = [
  { id: 'e_frame1', type: 'media', label: 'frame-1.jpg', thumb: 'media/.thumbs/f1.jpg' },
  { id: 'e_proof1', type: 'proof', label: 'Rooftop', thumb: 'proofs/.meta/rooftop.jpg' },
];

function route(path) {
  if (path.endsWith('/sheets')) {
    return Promise.resolve({ sheets: [{ id: WALL_SHEET.id, title: WALL_SHEET.title, path: WALL_SHEET.path, rows: 4, columns: 4 }] });
  }
  if (path.includes('/catalog/summary')) return Promise.resolve({ total: 3, by_type: { media: 2, proof: 1 } });
  if (path.includes('/catalog/entities')) return Promise.resolve({ items: PICTURES, next_cursor: null, total: 2 });
  if (path.includes('/sheets/')) return Promise.resolve(structuredClone(WALL_SHEET));
  if (path.includes('/entity-types') || path.includes('/relation-types') || path.includes('/confidence-levels')) {
    return Promise.resolve([]);
  }
  return Promise.resolve({});
}

async function open() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(Sheet, { target });
  await settle();
  target.querySelector('.home .sheet')?.click();
  await settle();
}

const rows = () => [...target.querySelectorAll('.rows:not(.ghost) .row')];
const cellAt = (row, index) => rows()[row].querySelectorAll('.cell:not(.gutter)')[index];

beforeEach(async () => {
  get.mockReset();
  get.mockImplementation(route);
  post.mockClear();
  const { caseState } = await import('../components/views.fixture.svelte.js');
  caseState.id = 'case-a';
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target = null;
  document.body.innerHTML = '';
});

describe('a picture column of a sheet made from a wall', () => {
  it('draws each linked picture from its thumbnail, under its label, and never the code', async () => {
    await open();
    const first = cellAt(0, 1);
    expect(first.querySelector('img').getAttribute('src')).toBe('/files/case-a/media/.thumbs/f1.jpg');
    expect(first.querySelector('.value').textContent.trim()).toBe('#1');
    // an image the case holds no thumbnail of is drawn from itself
    expect(cellAt(1, 1).querySelector('img').getAttribute('src')).toBe('/files/case-a/media/frame-2.jpg');
    // a chip still held as text reads as its picture and its label
    expect(cellAt(2, 1).querySelector('img').getAttribute('src')).toBe('/files/case-a/media/.thumbs/f3.jpg');
    expect(cellAt(2, 1).textContent).not.toContain('[[');
    // a video with no still is its chip
    expect(cellAt(3, 1).querySelector('img')).toBeNull();
    expect(cellAt(3, 1).querySelector('.cell-chip').textContent.trim()).toBe('#4');
    expect(target.querySelector('.rows').textContent).not.toContain('[[');
  });

  it('leads the cell’s @ with the case’s pictures and their thumbnails', async () => {
    await open();
    cellAt(0, 1).querySelector('.cell-link').click();
    await settle();
    const asked = get.mock.calls.map(([path]) => path).filter((path) => path.includes('/catalog/entities'));
    const params = new URLSearchParams(asked[0].split('?')[1]);
    expect(params.get('type')).toBe('media,capture,proof');
    expect(params.get('previews')).toBe('true');
    // the cell's words are not a search for a picture called "#1"
    expect(params.get('q')).toBeNull();
    const chips = [...document.querySelectorAll('.picker .types .chip')];
    expect(chips[0].textContent.trim()).toBe('Pictures');
    expect(chips[0].classList.contains('on')).toBe(true);
    const thumbs = [...document.querySelectorAll('.picker .result img.thumb')].map((node) => node.getAttribute('src'));
    expect(thumbs).toEqual(['/files/case-a/media/.thumbs/f1.jpg', '/files/case-a/proofs/.meta/rooftop.jpg']);
  });

  it('asks what a picture picked there draws, so its thumbnail shows at once', async () => {
    await open();
    cellAt(0, 1).querySelector('.cell-link').click();
    await settle();
    post.mockImplementation(async (path) => (path.endsWith('/pictures')
      ? { pictures: { e_proof1: { label: 'Rooftop', type: 'proof', kind: 'image', thumb: 'proofs/.meta/rooftop.jpg' } } }
      : {}));
    [...document.querySelectorAll('.picker .result')][1].click();
    await settle();
    const [path, body] = post.mock.calls.find(([called]) => called.endsWith('/pictures'));
    expect(path).toBe('/api/cases/case-a/sheets/e_sheet/pictures');
    expect(body).toEqual({ ids: ['e_proof1'] });
    expect(cellAt(0, 1).querySelector('img').getAttribute('src')).toBe('/files/case-a/proofs/.meta/rooftop.jpg');
    expect(cellAt(0, 1).querySelector('.value').textContent.trim()).toBe('#1');
  });
});
