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
  loadEntityTypes: () => Promise.resolve(),
}));
vi.mock('../lib/relations.svelte.js', () => ({
  loadRelationTypes: () => Promise.resolve(),
  relationOptions: (_subject, other, action) =>
    action === 'claim' && ['place', 'media'].includes(other)
      ? [{ type: 'about', direction: 'out' }]
      : [],
}));
vi.mock('../lib/entityIcon.js', () => ({ entityIcon: () => 'pin' }));

const { default: TemporalTargetPicker } = await import('./TemporalTargetPicker.svelte');

const ROWS = [
  { id: 'selected', type: 'place', label: 'North quay' },
  { id: 'locked', type: 'media', label: 'Interview frame' },
  { id: 'free', type: 'place', label: 'Old warehouse' },
];

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
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
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
  const input = root.querySelector('input[aria-label="Search the case…"]');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  apiGet.mockReset();
});

describe('TemporalTargetPicker', () => {
  it('asks only for endpoint types allowed by the served relation registry', async () => {
    apiGet.mockResolvedValue({ items: [] });
    const root = open();

    click(root, 'Add');
    await settle();

    expect(apiGet).toHaveBeenCalledWith(
      '/api/cases/case-1/catalog/entities?limit=200&type=place%2Cmedia'
    );
    expect(root.textContent).toContain('No matching case items');
  });

  it('keeps locked and selected endpoints unavailable, while adding and removing another', async () => {
    apiGet.mockResolvedValue({ items: ROWS });
    const root = open();

    click(root, 'Add');
    await settle();

    const results = [...root.querySelectorAll('.results > button')];
    expect(results.map((button) => button.disabled)).toEqual([true, true, false]);

    results[2].click();
    flushSync();
    expect(root.querySelector('button[title="Remove Old warehouse"]')).toBeTruthy();
    expect(results[2].disabled).toBe(true);

    root.querySelector('button[title="Remove Old warehouse"]').click();
    flushSync();
    expect(root.querySelector('button[title="Remove Old warehouse"]')).toBeNull();
    expect(results[2].disabled).toBe(false);
  });

  it('keeps the newest search result when an older request finishes last', async () => {
    let resolveFirst;
    let resolveSecond;
    apiGet
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    const root = open({ selected: [], locked: [] });

    click(root, 'Add');
    await settle();
    type(root, 'warehouse');
    await settle();

    expect(apiGet).toHaveBeenNthCalledWith(
      2,
      '/api/cases/case-1/catalog/entities?limit=200&type=place%2Cmedia&q=warehouse'
    );

    resolveSecond({ items: [ROWS[2]] });
    await settle();
    resolveFirst({ items: [ROWS[0]] });
    await settle();

    expect(root.querySelector('.results').textContent).toContain('Old warehouse');
    expect(root.querySelector('.results').textContent).not.toContain('North quay');
  });

  it('recovers from a failed search with an empty result', async () => {
    apiGet.mockRejectedValue(new Error('offline'));
    const root = open({ selected: [], locked: [] });

    click(root, 'Add');
    expect(root.textContent).toContain('Searching…');
    await settle();

    expect(root.textContent).toContain('No matching case items');
  });
});
