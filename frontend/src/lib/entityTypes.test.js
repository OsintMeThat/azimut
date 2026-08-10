import { describe, it, expect, vi, beforeEach } from 'vitest';
// This instance is never given a registry, so it is also the "before the fetch
// lands" case: a surface must render against an empty vocabulary at first paint.
import { entityFields as coldFields, entityLabel as coldLabel } from './entityTypes.svelte.js';

const get = vi.fn();
vi.mock('./api.js', () => ({ api: { get: (...a) => get(...a) } }));

const VOCABULARY = [
  {
    type: 'person', label: 'Person', family: 'actor', icon: 'user', manual: true,
    image_gallery: true,
    hint: 'a named individual', family_reads: 'a person or organization that can act or hold ownership',
    identity_label: 'Full name', identity_placeholder: 'Name or known alias', attrs: [],
  },
  {
    type: 'place',
    label: 'Place',
    family: 'place',
    icon: 'pin',
    manual: false,
    hint: 'a saved point',
    family_reads: 'a point on the map, never a thing standing on it',
    attrs: [
      {
        key: 'radius_m',
        label: 'Uncertainty radius (m)',
        kind: 'number',
        group: 'How precise',
        rungs: [
          { label: 'This block', value: 100 },
          { label: 'This town', value: 2000 },
        ],
        minimum: 1,
        maximum: 5000000,
      },
      { key: 'footprint', label: 'Footprint', kind: 'geojson', rungs: [], minimum: null, maximum: null },
      { key: 'verbatim', label: 'As the source put it', kind: 'text', rungs: [], minimum: null, maximum: null },
    ],
  },
  { type: 'media', label: 'Media', family: 'collected', icon: 'image', manual: false, attrs: [] },
  {
    type: 'bookmark',
    label: 'Bookmark',
    family: 'document',
    icon: 'globe',
    manual: false,
    attrs: [
      { key: 'archive_url', label: 'Archived copy', kind: 'url', rungs: [], options: [] },
      {
        key: 'reliability',
        label: 'Source reliability',
        kind: 'choice',
        rungs: [],
        options: [
          { value: 'A', label: 'Completely reliable' },
          { value: 'B', label: 'Usually reliable' },
        ],
      },
    ],
  },
];

let mod;

beforeEach(async () => {
  vi.resetModules();
  get.mockReset();
  get.mockResolvedValue(VOCABULARY);
  mod = await import('./entityTypes.svelte.js');
});

describe('the entity vocabulary', () => {
  it('is fetched once however many surfaces ask for it', async () => {
    await Promise.all([mod.loadEntityTypes(), mod.loadEntityTypes(), mod.loadEntityTypes()]);

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/api/cases/entity-types');
  });

  it('reads a type as words and names its family', async () => {
    await mod.loadEntityTypes();

    expect(mod.entityLabel('place')).toBe('Place');
    expect(mod.entityFamily('person')).toBe('actor');
    expect(mod.entityFamily('media')).toBe('collected');
  });

  it('names the primary value for the selected type', async () => {
    await mod.loadEntityTypes();

    expect(mod.entityIdentityLabel('person')).toBe('Full name');
    expect(mod.entityIdentityPlaceholder('person')).toBe('Name or known alias');
    expect(mod.entityIdentityLabel('cuneiform-tablet')).toBe('Title');
  });

  it('serves the declared fields in registry order, with their bounds', async () => {
    await mod.loadEntityTypes();
    const fields = mod.entityFields('place');

    expect(fields.map((f) => f.key)).toEqual(['radius_m', 'footprint', 'verbatim']);
    // the bounds ship with the field so the form refuses what the API refuses
    expect(fields[0].minimum).toBe(1);
    expect(fields[0].rungs.map((r) => r.value)).toEqual([100, 2000]);
  });

  it('opens a heading where the registry changes group, and nowhere else', () => {
    // one type can hold two subjects — a Claim says what it states and why that is
    // believed — so the heading rides on the field that opens the block, and the
    // fields after it continue under whatever is open
    const marked = mod.withHeadings([
      { key: 'count', group: 'What it states' },
      { key: 'condition' },
      { key: 'confidence', group: 'Reasoning' },
      { key: 'method' },
    ]);

    expect(marked.map((f) => f.heads)).toEqual(['What it states', '', 'Reasoning', '']);
  });

  it('heads nothing for a type whose fields stand on their own labels', () => {
    const marked = mod.withHeadings([{ key: 'imo' }, { key: 'mmsi' }]);

    expect(marked.map((f) => f.heads)).toEqual(['', '']);
  });

  it('names the families in registry order, which is what the board filters by', async () => {
    await mod.loadEntityTypes();

    expect(mod.entityFamilies()).toEqual(['actor', 'place', 'collected', 'document']);
    expect(mod.entityTypes().map((e) => e.type)).toEqual(['person', 'place', 'media', 'bookmark']);
  });

  it('explains a type and its family in one clause, so no menu is bare jargon', async () => {
    await mod.loadEntityTypes();

    expect(mod.entityHint('place')).toBe('a saved point');
    expect(mod.familyReads('actor')).toBe('a person or organization that can act or hold ownership');
    // and nothing invented locally for a word the registry has never heard of
    expect(mod.entityHint('cuneiform-tablet')).toBe('');
    expect(mod.familyReads('artefact')).toBe('');
  });

  it('serves the icon a type is drawn with, so no screen keeps its own map', async () => {
    await mod.loadEntityTypes();

    expect(mod.typeIcon('place')).toBe('pin');
    expect(mod.typeIcon('cuneiform-tablet')).toBe(null);
  });

  it('offers only the hand-made types for creation', async () => {
    await mod.loadEntityTypes();

    // a media is born from an import and a place from a save, so neither belongs
    // in a create menu
    expect(mod.creatableTypes().map((e) => e.type)).toEqual(['person']);
    expect(mod.isManualEntityType('person')).toBe(true);
    expect(mod.isManualEntityType('media')).toBe(false);
  });

  it('says which types have presentation photos', async () => {
    await mod.loadEntityTypes();

    expect(mod.hasImageGallery('person')).toBe(true);
    expect(mod.hasImageGallery('media')).toBe(false);
  });

  it('degrades to the raw slug and no fields before the registry lands', () => {
    expect(coldLabel('vessel')).toBe('vessel');
    expect(coldFields('place')).toEqual([]);
  });

  it('drops a failed read so the next surface retries', async () => {
    vi.resetModules();
    get.mockRejectedValueOnce(new Error('offline'));
    const cold = await import('./entityTypes.svelte.js');

    await cold.loadEntityTypes();
    expect(cold.entityFields('place')).toEqual([]);

    get.mockResolvedValue(VOCABULARY);
    await cold.loadEntityTypes();
    expect(cold.entityFields('place')).toHaveLength(3);
  });

  it('has no fields for a free type it has never heard of', async () => {
    await mod.loadEntityTypes();

    expect(mod.entityFields('cuneiform-tablet')).toEqual([]);
    expect(mod.entityFamily('cuneiform-tablet')).toBe(null);
  });
});

describe('how reliable a source says it is', () => {
  const bookmark = (attrs) => ({ type: 'bookmark', attrs });

  it('reads the grade in the registry’s own words', async () => {
    await mod.loadEntityTypes();

    expect(mod.reliabilityOf(bookmark({ reliability: 'B' }))).toEqual({
      grade: 'B',
      label: 'Usually reliable',
    });
  });

  it('says nothing for an ungraded source, a type that carries no grade, or junk', async () => {
    await mod.loadEntityTypes();

    // all three render as nothing: an ungraded source is the normal case, and
    // flagging it would turn an optional field into a standing chore
    expect(mod.reliabilityOf(bookmark({}))).toBe(null);
    expect(mod.reliabilityOf({ type: 'place', attrs: { reliability: 'B' } })).toBe(null);
    expect(mod.reliabilityOf(bookmark({ reliability: 'F' }))).toBe(null);
    expect(mod.reliabilityOf(null)).toBe(null);
  });

  it('never reports the edge’s own rating as the source’s grade', async () => {
    await mod.loadEntityTypes();

    // the two axes are separate objects, and this reader only ever looks at one
    expect(mod.reliabilityOf({ type: 'bookmark', attrs: { confidence: 3 } })).toBe(null);
  });
});
