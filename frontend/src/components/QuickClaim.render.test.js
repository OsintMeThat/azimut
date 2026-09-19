// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The quick claim form, filled the way an analyst fills it: the entity it was
 * opened from already in its seat, only the fields that entity's family calls for,
 * a sentence that writes itself until one is typed, and one request that files the
 * whole observation.
 */

const CONDITIONS = [
  { value: 'intact', label: 'Intact' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'destroyed', label: 'Destroyed' },
  { value: 'abandoned', label: 'Abandoned' },
];
const TYPES = [
  { type: 'equipment-type', family: 'class', label: 'Equipment type', attrs: [] },
  { type: 'vehicle', family: 'asset', label: 'Vehicle', attrs: [] },
  { type: 'person', family: 'actor', label: 'Person', attrs: [] },
  { type: 'place', family: 'place', label: 'Place', attrs: [] },
  { type: 'media', family: 'collected', label: 'Media', attrs: [] },
  {
    type: 'claim',
    family: 'claim',
    label: 'Claim',
    attrs: [
      { key: 'count', label: 'How many', kind: 'number', minimum: 1, maximum: 100000 },
      { key: 'condition', label: 'Condition', kind: 'choice', options: CONDITIONS },
      {
        key: 'confidence',
        label: 'Confidence',
        kind: 'choice',
        options: [
          { value: 'certain', label: 'Certain' },
          { value: 'probable', label: 'Probable' },
        ],
      },
    ],
  },
];
const verb = (type, to) => ({ type, label: type, action: 'claim', manual: true, from_types: ['claim'], to_types: to });
const RELATIONS = [
  verb('about', ['equipment-type', 'vehicle', 'person', 'place', 'media']),
  verb('at', ['place']),
  verb('cites', ['media']),
];

const get = vi.fn(async (url) => {
  if (url.includes('/entity-types')) return TYPES;
  if (url.includes('/relation-types')) return RELATIONS;
  if (url.includes('/confidence-levels')) return [];
  return { items: [] };
});
const post = vi.fn(async () => ({ entity: { id: 'claim-1' } }));
vi.mock('../lib/api.js', () => ({ api: { get, post } }));

const reloadCase = vi.fn(async () => {});
const toast = vi.fn();
vi.mock('../lib/state.svelte.js', () => ({ reloadCase, toast }));

const { default: QuickClaim, claimSeat } = await import('./QuickClaim.svelte');

let live = null;
let target = null;

async function settle() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  flushSync();
}

async function open(entity, props = {}) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(QuickClaim, { target, props: { caseId: 'case-a', entity, ...props } });
  await settle();
}

const statement = () => target.querySelector('.quick-claim textarea');
const count = () => target.querySelector('input[type="number"]');
const conditionSelect = () =>
  [...target.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'destroyed'));
const addButton = () => [...target.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add claim');

function type(element, value) {
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function choose(element, value) {
  element.value = value;
  element.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

const MODEL = { id: 'model-1', type: 'equipment-type', label: 'T-72B3' };

beforeEach(() => vi.clearAllMocks());

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

describe('filed from a model', () => {
  it('asks how many and in what state, and writes the sentence from them', async () => {
    await open(MODEL);

    expect(count()).not.toBeNull();
    expect(conditionSelect()).not.toBeUndefined();
    expect(statement().value).toBe('T-72B3 seen');

    type(count(), '2');
    choose(conditionSelect(), 'destroyed');
    expect(statement().value).toBe('2 × T-72B3 destroyed');
  });

  it('files the observation about the model in one request, then refreshes the case', async () => {
    const onsaved = vi.fn();
    await open(MODEL, { onsaved });
    type(count(), '2');
    choose(conditionSelect(), 'destroyed');

    addButton().click();
    await settle();

    expect(post).toHaveBeenCalledWith('/api/cases/case-a/timeline/claims', {
      statement: '2 × T-72B3 destroyed',
      when: null,
      time_role: null,
      confidence: null,
      count: 2,
      condition: 'destroyed',
      about: ['model-1'],
      at: [],
      cites: [],
    });
    expect(reloadCase).toHaveBeenCalled();
    expect(onsaved).toHaveBeenCalled();
  });

  it('keeps a sentence the analyst wrote when a field changes under it', async () => {
    await open(MODEL);
    type(statement(), 'Two tanks burning near the bridge');
    type(count(), '3');

    expect(statement().value).toBe('Two tanks burning near the bridge');
    const rewrite = [...target.querySelectorAll('button')].find((b) => b.textContent.includes('Rewrite from the fields'));
    rewrite.click();
    flushSync();
    expect(statement().value).toBe('3 × T-72B3 seen');
  });
});

describe('filed from something else', () => {
  it('asks a named object for its state and never for a count', async () => {
    await open({ id: 'v-1', type: 'vehicle', label: 'Bridge truck' });
    expect(count()).toBeNull();
    expect(conditionSelect()).not.toBeUndefined();
  });

  it('asks a person for neither', async () => {
    await open({ id: 'p-1', type: 'person', label: 'Ivan' });
    expect(count()).toBeNull();
    expect(conditionSelect()).toBeUndefined();
    expect(statement().value).toBe('Ivan seen');
  });

  it('seats a place where it was seen', async () => {
    await open({ id: 'place-1', type: 'place', label: 'Crossroads' });
    expect(statement().value).toBe('Seen at Crossroads');

    type(statement(), 'Convoy seen at Crossroads');
    addButton().click();
    await settle();
    expect(post.mock.calls[0][1]).toMatchObject({ about: [], at: ['place-1'], cites: [] });
  });

  it('seats a video as the evidence and leaves the sentence to the analyst', async () => {
    await open({ id: 'm-1', type: 'media', label: 'clip.mp4', attrs: { kind: 'video' } });
    expect(statement().value).toBe('');
    expect(addButton().disabled).toBe(true);

    type(statement(), 'A column heading east');
    addButton().click();
    await settle();
    expect(post.mock.calls[0][1]).toMatchObject({ about: [], at: [], cites: ['m-1'] });
  });
});

describe('claimSeat', () => {
  it('offers no seat on a claim itself, which has its own editor', async () => {
    await open(MODEL); // lands both registries
    expect(claimSeat({ id: 'c', type: 'claim', label: 'x' })).toBeNull();
    expect(claimSeat(MODEL)).toEqual({ slot: 'about', count: true, condition: true });
  });
});
