import { describe, it, expect, vi, beforeEach } from 'vitest';
// This instance is never given a registry, so it is also the "before the fetch
// lands" case: every surface renders against an empty vocabulary at first paint.
import { relationOptions as coldOptions, relationVerb as coldVerb } from './relations.svelte.js';

const get = vi.fn();
const post = vi.fn();
vi.mock('./api.js', () => ({ api: { get: (...a) => get(...a), post: (...a) => post(...a) } }));

const VOCABULARY = [
  {
    type: 'located-at',
    label: 'was shot at',
    from_types: ['capture', 'media'],
    to_types: ['place'],
    manual: true,
  },
  {
    type: 'depicts',
    label: 'shows',
    from_types: ['capture', 'media'],
    to_types: ['place'],
    manual: true,
  },
  {
    type: 'same-image-as',
    label: 'is the same picture as',
    from_types: ['media'],
    to_types: ['media'],
    manual: false,
  },
];

let relations;

beforeEach(async () => {
  vi.resetModules();
  get.mockReset();
  post.mockReset();
  get.mockResolvedValue(VOCABULARY);
  relations = await import('./relations.svelte.js');
});

describe('the relation vocabulary', () => {
  it('is fetched once however many surfaces ask for it', async () => {
    await Promise.all([
      relations.loadRelationTypes(),
      relations.loadRelationTypes(),
      relations.loadRelationTypes(),
    ]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/api/cases/relation-types');
  });

  it('leaves a surface usable before the fetch lands', () => {
    expect(coldVerb('located-at')).toBe('located-at');
    expect(coldOptions('place', 'media')).toEqual([]);
  });

  it('names an edge in words once the registry is in', async () => {
    await relations.loadRelationTypes();
    expect(relations.relationVerb('located-at')).toBe('was shot at');
    expect(relations.relationVerb('same-image-as')).toBe('is the same picture as');
    expect(relations.relationVerb('invented-by-hand')).toBe('invented-by-hand');
  });

  it('leaves the panel usable when the registry cannot be read', async () => {
    vi.resetModules();
    get.mockRejectedValue(new Error('offline'));
    const degraded = await import('./relations.svelte.js');
    await degraded.loadRelationTypes();
    expect(degraded.relationVerb('located-at')).toBe('located-at');
    expect(degraded.relationOptions('place', 'media')).toEqual([]);
  });
});

describe('relationOptions', () => {
  beforeEach(() => relations.loadRelationTypes());

  it('records which end the subject sits on, because the vocabulary is directed', () => {
    // from a place: the photo is the subject of the edge, the place its object
    expect(relations.relationOptions('place', 'media')).toEqual([
      { type: 'located-at', label: 'was shot at', direction: 'in' },
      { type: 'depicts', label: 'shows', direction: 'in' },
    ]);
    // from the photo, the same two edges run outward
    expect(relations.relationOptions('media', 'place').map((o) => o.direction)).toEqual([
      'out',
      'out',
    ]);
  });

  it('never offers a machine-only relation', () => {
    expect(relations.relationOptions('media', 'media')).toEqual([]);
  });

  it('offers nothing for a pair the ontology has no reading for', () => {
    expect(relations.relationOptions('place', 'place')).toEqual([]);
    expect(relations.relationOptions('post', 'place')).toEqual([]);
  });
});

describe('relatableTypes', () => {
  beforeEach(() => relations.loadRelationTypes());

  it('lists what can sit at the other end, so a picker searches only those', () => {
    expect(relations.relatableTypes('place').sort()).toEqual(['capture', 'media']);
    expect(relations.relatableTypes('media')).toEqual(['place']);
    expect(relations.relatableTypes('post')).toEqual([]);
  });
});

describe('saveRelation', () => {
  it('files the endpoints in the order the link type requires', async () => {
    await relations.saveRelation('case-1', 'e_place', {
      entityId: 'e_photo',
      type: 'located-at',
      direction: 'in',
    });
    expect(post).toHaveBeenCalledWith('/api/cases/case-1/links', {
      from_id: 'e_photo',
      to_id: 'e_place',
      type: 'located-at',
    });

    await relations.saveRelation('case-1', 'e_photo', {
      entityId: 'e_place',
      type: 'located-at',
      direction: 'out',
    });
    expect(post).toHaveBeenLastCalledWith('/api/cases/case-1/links', {
      from_id: 'e_photo',
      to_id: 'e_place',
      type: 'located-at',
    });
  });
});
