import { describe, it, expect, vi, beforeEach } from 'vitest';
import { relationTypes as ontologyVocabulary } from '../../e2e/app.fixture.js';
// This instance is never given a registry, so it is also the "before the fetch
// lands" case: every surface renders against an empty vocabulary at first paint.
import {
  confidenceLevels as coldLevels,
  isRatable as coldRatable,
  relationOptions as coldOptions,
  relationVerb as coldVerb,
} from './relations.svelte.js';

const get = vi.fn();
const post = vi.fn();
vi.mock('./api.js', () => ({ api: { get: (...a) => get(...a), post: (...a) => post(...a) } }));

const LEVELS = [
  { value: 3, label: 'Certain', hint: 'established and corroborated' },
  { value: 2, label: 'Probable', hint: 'more likely than not' },
  { value: 1, label: 'Possible' },
  { value: -1, label: 'Ruled out' },
];

const VOCABULARY = [
  {
    type: 'located-at',
    label: 'was recorded at',
    from_types: ['capture', 'media'],
    to_types: ['place'],
    hint: 'the camera stood at this point',
    manual: true,
    ratable: true,
  },
  {
    type: 'depicts',
    label: 'shows',
    from_types: ['capture', 'media'],
    to_types: ['place'],
    manual: true,
    ratable: true,
  },
  {
    type: 'same-image-as',
    label: 'is the same picture as',
    from_types: ['media'],
    to_types: ['media'],
    manual: false,
    ratable: true,
  },
  {
    type: 'in-network',
    label: 'is in network',
    inverse_label: 'contains',
    from_types: ['ip', 'network'],
    to_types: ['network'],
    manual: true,
    ratable: true,
  },
  // Symmetric, and the one verb carrying a free note: the tie is real, what kind of
  // tie it is is a word only the analyst has.
  {
    type: 'associated-with',
    label: 'is associated with',
    inverse_label: 'is associated with',
    from_types: ['organization', 'person'],
    to_types: ['organization', 'person'],
    manual: true,
    ratable: true,
    qualifier: 'How they are tied',
  },
  // The one verb the registry heads apart: a document naming something is a pointer,
  // not a finding about where it is.
  {
    type: 'mentions',
    label: 'mentions',
    from_types: ['note', 'post'],
    to_types: ['media', 'place'],
    hint: 'refers to it, without having been made from it',
    group: 'Mentions',
    action: 'mention',
    manual: true,
    ratable: true,
  },
];

/** Answers each registry route, so a test can drop one without dropping both. */
const serve = (routes = {}) => (url) => {
  const table = {
    '/api/cases/relation-types': VOCABULARY,
    '/api/cases/confidence-levels': LEVELS,
    ...routes,
  };
  const answer = table[url];
  return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
};

let relations;

beforeEach(async () => {
  vi.resetModules();
  get.mockReset();
  post.mockReset();
  get.mockImplementation(serve());
  relations = await import('./relations.svelte.js');
});

describe('the relation vocabulary', () => {
  it('is fetched once however many surfaces ask for it', async () => {
    await Promise.all([
      relations.loadRelationTypes(),
      relations.loadRelationTypes(),
      relations.loadRelationTypes(),
    ]);
    // two routes, read together once: the vocabulary and the levels an edge may hold
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith('/api/cases/relation-types');
    expect(get).toHaveBeenCalledWith('/api/cases/confidence-levels');
  });

  it('leaves a surface usable before the fetch lands', () => {
    expect(coldVerb('located-at')).toBe('located-at');
    expect(coldOptions('place', 'media')).toEqual([]);
  });

  it('names an edge in words once the registry is in', async () => {
    await relations.loadRelationTypes();
    expect(relations.relationVerb('located-at')).toBe('was recorded at');
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
      { type: 'located-at', label: 'was recorded at', group: '', direction: 'in' },
      { type: 'depicts', label: 'shows', group: '', direction: 'in' },
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
    expect(relations.relationOptions('post', 'post')).toEqual([]);
  });

  it('carries the heading its verb declares, so a surface never sorts by type name', () => {
    const [pointer] = relations.relationOptions('note', 'place');
    expect(pointer).toEqual({
      type: 'mentions',
      label: 'mentions',
      group: 'Mentions',
      direction: 'out',
    });
    expect(relations.relationOptions('media', 'place').every((o) => o.group === '')).toBe(true);
  });

  it('keeps mentions out of the relation gesture', () => {
    expect(relations.relationOptions('note', 'place', 'relation')).toEqual([]);
    expect(relations.relationOptions('note', 'place', 'mention')).toEqual([
      { type: 'mentions', label: 'mentions', group: 'Mentions', direction: 'out' },
    ]);
    expect(relations.relationAction('mentions')).toBe('mention');
    expect(relations.relationAction('located-at')).toBe('relation');
  });

  it('puts a headed verb last however the registry declares it', async () => {
    // the first option is the default reading a picker files, and a pointer is never
    // the strongest thing a pair can say — declaration order must not decide that
    vi.resetModules();
    get.mockImplementation(
      serve({
        '/api/cases/relation-types': [
          {
            ...VOCABULARY.find((entry) => entry.type === 'mentions'),
            from_types: ['note'],
            to_types: ['place'],
          },
          {
            ...VOCABULARY.find((entry) => entry.type === 'located-at'),
            from_types: ['note'],
          },
        ],
      })
    );
    const hostile = await import('./relations.svelte.js');
    await hostile.loadRelationTypes();

    expect(hostile.relationOptions('note', 'place').map((o) => o.type)).toEqual([
      'located-at',
      'mentions',
    ]);
  });
});

describe('relatableTypes', () => {
  beforeEach(() => relations.loadRelationTypes());

  it('lists what can sit at the other end, so a picker searches only those', () => {
    expect(relations.relatableTypes('place').sort()).toEqual(['capture', 'media', 'note', 'post']);
    expect(relations.relatableTypes('media').sort()).toEqual(['note', 'place', 'post']);
    // a headed verb widens the picker like any other: a pointer still needs a target
    expect(relations.relatableTypes('post').sort()).toEqual(['media', 'place']);
  });

  it('gives relations and mentions separate target sets', () => {
    expect(relations.relatableTypes('note', 'relation')).toEqual([]);
    expect(relations.relatableTypes('note', 'mention').sort()).toEqual(['media', 'place']);
  });

  it('offers IP and nested-network links in both readable directions', () => {
    expect(relations.relatableTypes('ip', 'relation')).toEqual(['network']);
    expect(relations.relatableTypes('network', 'relation').sort()).toEqual(['ip', 'network']);
    expect(relations.relationOptions('ip', 'network', 'relation')).toContainEqual({
      type: 'in-network', label: 'is in network', group: '', direction: 'out',
    });
    expect(relations.relationOptions('network', 'ip', 'relation')).toContainEqual({
      type: 'in-network', label: 'contains', group: '', direction: 'in',
    });
    expect(relations.relationOptions('network', 'network', 'relation')).toEqual([
      { type: 'in-network', label: 'is in network', group: '', direction: 'out' },
      { type: 'in-network', label: 'contains', group: '', direction: 'in' },
    ]);
  });

  it('offers a symmetric verb once, not the same sentence twice', () => {
    // A parent network *contains* a child while the child *is in* the parent: two
    // readings, two lines. Two people are associated with each other in one word, so
    // the second line would ask the analyst to choose between two identical options.
    expect(relations.relationOptions('person', 'person', 'relation')).toEqual([
      { type: 'associated-with', label: 'is associated with', group: '', direction: 'out' },
    ]);
  });

  it('reads a symmetric row as current from the far end too', () => {
    // The regression the dedup above caused: offered once, the entity on the far end
    // found no inward reading to match, so every association read as an older
    // connection — badged out-of-matrix and stripped of its controls on exactly one
    // of the two panels showing it.
    const tie = {
      link: { id: 'l1', type: 'associated-with', provenance: { status: 'confirmed' } },
      entity: { type: 'person' },
      direction: 'in',
    };
    expect(relations.isCurrentConnection('person', tie)).toBe(true);
    expect(relations.isCurrentConnection('person', { ...tie, direction: 'out' })).toBe(true);
    // An asymmetric verb still has to match: its two readings are two findings, and
    // only one of them may be legal for a given pair.
    expect(relations.isSymmetric('in-network')).toBe(false);
    expect(relations.isSymmetric('associated-with')).toBe(true);
    expect(
      relations.isCurrentConnection('ip', {
        link: { id: 'l2', type: 'in-network', provenance: { status: 'confirmed' } },
        entity: { type: 'network' },
        direction: 'in',
      })
    ).toBe(false);
  });

  it('says which verb carries a free note, and which do not', () => {
    // It belongs to the verb, never to the edge: a note every edge could hold would
    // leave nothing saying what an edge *is*.
    expect(relations.relationQualifier('associated-with')).toBe('How they are tied');
    expect(relations.relationQualifier('in-network')).toBe('');
    expect(relations.relationQualifier('mentions')).toBe('');
    // an older registry with no such key answers the same as a verb declining one
    expect(relations.relationQualifier('nothing-like-it')).toBe('');
  });
});

describe('the complete browser ontology', () => {
  let complete;

  beforeEach(async () => {
    vi.resetModules();
    get.mockImplementation(
      serve({ '/api/cases/relation-types': ontologyVocabulary })
    );
    complete = await import('./relations.svelte.js');
    await complete.loadRelationTypes();
  });

  it('makes every manual endpoint reachable through its own frontend gesture', () => {
    for (const entry of ontologyVocabulary.filter((row) => row.manual)) {
      for (const fromType of entry.from_types) {
        for (const toType of entry.to_types) {
          expect(
            complete.relatableTypes(fromType, entry.action),
            `${entry.type}: ${fromType} must reach ${toType}`
          ).toContain(toType);
          expect(
            complete.relationOptions(fromType, toType, entry.action),
            `${entry.type}: ${fromType} must offer its outward reading for ${toType}`
          ).toContainEqual({
            type: entry.type,
            label: entry.label,
            group: entry.group,
            direction: 'out',
          });
        }
      }
    }
  });

  it('keeps relation, mention and Claim connectors out of each other’s buttons', () => {
    for (const entry of ontologyVocabulary.filter((row) => row.manual)) {
      const otherActions = ['relation', 'mention', 'claim'].filter(
        (action) => action !== entry.action
      );
      for (const action of otherActions) {
        expect(
          complete.relationOptions(entry.from_types[0], entry.to_types[0], action)
            .some((option) => option.type === entry.type),
          `${entry.type} leaked into ${action}`
        ).toBe(false);
      }
    }
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

describe('how sure an edge says the analyst is', () => {
  it('serves the levels the API declares, coarsest word last', async () => {
    await relations.loadRelationTypes();

    expect(relations.confidenceLevels().map((l) => l.value)).toEqual([3, 2, 1, -1]);
    expect(relations.confidenceLabel(-1)).toBe('Ruled out');
    expect(relations.confidenceLabel(2)).toBe('Probable');
  });

  it('reads an unrated edge as nothing at all, never as a level', async () => {
    await relations.loadRelationTypes();

    // absent is the lack of a rating, so it has no word and is not in the list
    expect(relations.confidenceLabel(null)).toBe('');
    expect(relations.confidenceLabel(undefined)).toBe('');
    expect(relations.confidenceLevels().some((l) => l.value == null)).toBe(false);
  });

  it('says which link types may carry a rating at all', async () => {
    await relations.loadRelationTypes();

    expect(relations.isRatable('located-at')).toBe(true);
    // a derivation is not in this registry, so it can never be offered one
    expect(relations.isRatable('derived-from')).toBe(false);
  });

  it('offers no level before the registry lands, so no surface guesses one', () => {
    expect(coldLevels()).toEqual([]);
    expect(coldRatable('located-at')).toBe(false);
  });

  it('drops a failed read so the next surface retries both routes', async () => {
    vi.resetModules();
    get.mockImplementation(serve({ '/api/cases/confidence-levels': new Error('offline') }));
    const cold = await import('./relations.svelte.js');

    await cold.loadRelationTypes();
    // one route failing leaves the whole registry empty rather than half-loaded
    expect(cold.confidenceLevels()).toEqual([]);
    expect(cold.relationVerb('located-at')).toBe('located-at');

    get.mockImplementation(serve());
    await cold.loadRelationTypes();
    expect(cold.confidenceLevels()).toHaveLength(4);
    expect(cold.relationVerb('located-at')).toBe('was recorded at');
  });
});

describe('the vocabulary explains itself', () => {
  it('says what a verb means, where the words alone are ambiguous', async () => {
    await relations.loadRelationTypes();

    expect(relations.relationHint('located-at')).toBe('the camera stood at this point');
    // nothing invented locally for a verb the registry has never heard of
    expect(relations.relationHint('bewitches')).toBe('');
  });

  it('says which verbs head their own section, and does not decide it here', async () => {
    await relations.loadRelationTypes();

    expect(relations.relationGroup('mentions')).toBe('Mentions');
    expect(relations.relationGroup('located-at')).toBe('');
    expect(relations.relationGroup('bewitches')).toBe('');
  });

  it('places a rating on the scale for the control that offers it', async () => {
    await relations.loadRelationTypes();

    expect(relations.confidenceHint(3)).toBe('established and corroborated');
    expect(relations.confidenceHint(null)).toBe('');
  });
});

describe('directed and media-aware endpoints', () => {
  it('uses the inverse reading and refuses a non-media file kind', async () => {
    vi.resetModules();
    get.mockImplementation(
      serve({
        '/api/cases/relation-types': [
          {
            ...VOCABULARY[0],
            label: 'was recorded at',
            inverse_label: 'was recorded here',
            from_media_kinds: ['image', 'video', 'audio'],
          },
        ],
      })
    );
    const directed = await import('./relations.svelte.js');
    await directed.loadRelationTypes();

    const place = { type: 'place', attrs: {} };
    const audio = { type: 'media', attrs: { kind: 'audio' } };
    const file = { type: 'media', attrs: { kind: 'file' } };
    expect(directed.relationOptions(place, audio)[0].label).toBe('was recorded here');
    expect(directed.relationOptions(place, file)).toEqual([]);
    expect(directed.relatableTypes(audio)).toEqual(['place']);
    expect(directed.relatableTypes(file)).toEqual([]);
    expect(directed.relationReading('located-at', 'in')).toBe('was recorded here');
  });

  it('recognizes whether a stored row still fits the current matrix', async () => {
    await relations.loadRelationTypes();
    const subject = { type: 'media', attrs: { kind: 'image' } };
    const current = {
      link: { type: 'located-at' },
      entity: { type: 'place', attrs: {} },
      direction: 'out',
    };
    const older = { ...current, direction: 'in' };

    expect(relations.isCurrentConnection(subject, current)).toBe(true);
    expect(relations.isCurrentConnection(subject, older)).toBe(false);
  });
});
