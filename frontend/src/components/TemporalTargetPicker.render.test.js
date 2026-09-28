// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const apiGet = vi.fn();
const TYPES = [
  { type: 'place' },
  { type: 'media' },
  { type: 'claim' },
];

vi.mock('../lib/api.js', () => ({ api: { get: apiGet } }));
vi.mock('../lib/entityTypes.svelte.js', () => ({
  entityTypes: () => TYPES,
  entityLabel: (type) => ({ place: 'Place', media: 'Media', claim: 'Claim' })[type] ?? type,
  entityFields: () => [],
  loadEntityTypes: () => Promise.resolve(),
}));
vi.mock('../lib/relations.svelte.js', () => ({
  loadRelationTypes: () => Promise.resolve(),
  relationOptions: (_subject, other, action) =>
    action === 'claim' && ['place', 'media'].includes(other)
      ? [{ type: 'about', direction: 'out' }, { type: 'cites', direction: 'out' }]
      : [],
}));
vi.mock('../lib/entityIcon.js', () => ({ entityIcon: () => 'pin' }));

const { default: TemporalTargetPicker } = await import('./TemporalTargetPicker.svelte');

const ROWS = [
  { id: 'selected', type: 'place', label: 'North quay' },
  { id: 'locked', type: 'media', label: 'Interview frame' },
  { id: 'free', type: 'place', label: 'Old warehouse', provenance: { at: '2026-08-01T09:00:00Z' } },
  { id: 'clip', type: 'media', label: 'clip.mp4', attrs: { kind: 'video' }, thumb: '.thumbs/clip.jpg' },
];
const SUMMARY = { total: 4, by_type: { place: 2, media: 2 } };

/** The summary for the kinds, and the page for everything else. */
function serve(page) {
  apiGet.mockImplementation((url) =>
    url.includes('/catalog/summary') ? Promise.resolve(SUMMARY) : page(url));
}

let live = null;

function open(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(TemporalTargetPicker, {
    target,
    props: {
      caseId: 'case-1',
      relationType: 'about',
      label: 'About',
      hint: 'What the statement concerns',
      selected: [ROWS[0]],
      locked: [ROWS[1]],
      ...props,
    },
  });
  flushSync();
  return target;
}

async function settle() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  flushSync();
}

function click(root, text) {
  const button = [...root.querySelectorAll('button')].find(
    (candidate) => candidate.textContent.trim() === text
  );
  expect(button, `button ${text}`).toBeTruthy();
  button.click();
  flushSync();
  return button;
}

function type(root, value) {
  const input = root.querySelector('input[type="search"]');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

const pageCalls = () => apiGet.mock.calls.map(([url]) => url).filter((url) => url.includes('/catalog/entities'));
const names = (root) => [...root.querySelectorAll('[role="option"] .name')].map((node) => node.textContent);

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  apiGet.mockReset();
});

describe('TemporalTargetPicker', () => {
  it('asks only for endpoint types allowed by the served relation registry, with their pictures', async () => {
    serve(() => Promise.resolve({ items: [] }));
    const root = open();

    click(root, 'Add');
    await settle();

    expect(pageCalls()).toEqual(['/api/cases/case-1/catalog/entities?limit=30&type=place%2Cmedia&previews=true']);
    expect(root.textContent).toContain('Nothing of this kind in the case yet');
  });

  it('leaves out what is already attached, and adds and removes another', async () => {
    serve(() => Promise.resolve({ items: ROWS }));
    const root = open();

    click(root, 'Add');
    await settle();
    expect(names(root)).toEqual(['Old warehouse', 'clip.mp4']);

    root.querySelector('[role="option"]').dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    flushSync();
    expect(root.querySelector('button[title="Remove Old warehouse"]')).toBeTruthy();
    expect(names(root)).toEqual(['clip.mp4']);

    root.querySelector('button[title="Remove Old warehouse"]').click();
    flushSync();
    expect(names(root)).toEqual(['Old warehouse', 'clip.mp4']);
  });

  it('says what each row is, and shows the picture a file has', async () => {
    serve(() => Promise.resolve({ items: ROWS }));
    const root = open({ selected: [], locked: [] });
    click(root, 'Add');
    await settle();

    const rows = [...root.querySelectorAll('[role="option"]')];
    expect(rows[2].textContent).toContain('Place · added 1 Aug 2026');
    expect(rows[3].textContent).toContain('Media · video');
    expect(rows[3].querySelector('img').getAttribute('src')).toBe('/files/case-1/.thumbs/clip.jpg');
  });

  it('offers the kinds the case holds as chips, and narrows to one', async () => {
    serve(() => Promise.resolve({ items: ROWS }));
    const root = open({ selected: [], locked: [] });
    click(root, 'Add');
    await settle();

    const kinds = [...root.querySelectorAll('[aria-label="Kinds"] button')].map((button) => button.textContent.trim());
    expect(kinds).toEqual(['All', 'Place2', 'Media2']);
    click(root, 'Media2');
    await settle();
    expect(pageCalls().at(-1)).toBe('/api/cases/case-1/catalog/entities?limit=30&type=media&previews=true');
  });

  it('lists evidence newest first', async () => {
    serve(() => Promise.resolve({ items: [] }));
    const root = open({ relationType: 'cites', label: 'Evidence', selected: [], locked: [] });
    click(root, 'Add');
    await settle();
    expect(pageCalls()[0]).toBe('/api/cases/case-1/catalog/entities?limit=30&type=place%2Cmedia&order=-created&previews=true');
    expect(root.querySelector('input[type="search"]').placeholder).toBe('Find a file, capture, proof, page or note…');
  });

  it('keeps the newest search result when an older request finishes last', async () => {
    let resolveFirst;
    let resolveSecond;
    const pending = [
      new Promise((resolve) => { resolveFirst = resolve; }),
      new Promise((resolve) => { resolveSecond = resolve; }),
    ];
    let call = 0;
    serve(() => pending[call++]);
    const root = open({ selected: [], locked: [] });

    click(root, 'Add');
    await settle();
    type(root, 'warehouse');
    await settle();

    expect(pageCalls()[1]).toBe('/api/cases/case-1/catalog/entities?limit=30&type=place%2Cmedia&q=warehouse&previews=true');

    resolveSecond({ items: [ROWS[2]] });
    await settle();
    resolveFirst({ items: [ROWS[0]] });
    await settle();

    expect(names(root)).toEqual(['Old warehouse']);
  });

  it('recovers from a failed search with an empty result', async () => {
    serve(() => Promise.reject(new Error('offline')));
    const root = open({ selected: [], locked: [] });

    click(root, 'Add');
    expect(root.textContent).toContain('Searching…');
    await settle();

    expect(root.textContent).toContain('Nothing of this kind in the case yet');
  });
});
