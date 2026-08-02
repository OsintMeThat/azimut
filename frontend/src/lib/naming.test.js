import { describe, it, expect } from 'vitest';
import {
  MAX_SLUG, NAME_PREFIX, slugify, uniqueName, nextName, isDefaultName,
  savedEntities, savedSlugs, savedTitles, savedTitle,
} from './naming.js';

describe('slugify — mirrors the backend api/naming.slugify', () => {
  it('preserves human text and replaces only forbidden filename characters', () => {
    expect(slugify('Inspect 1', 'session')).toBe('Inspect 1');
    expect(slugify('  Rooftop! @ 12:30  ', 'proof')).toBe('Rooftop! @ 12_30');
    expect(slugify('Café déjà', 'proof')).toBe('Café déjà');
  });

  it('falls back to the caller word when nothing survives, and caps the length', () => {
    expect(slugify('', 'proof')).toBe('proof');
    expect(slugify('!!!', 'session')).toBe('!!!');
    expect(slugify(null, 'draft')).toBe('draft');
    expect(slugify('a'.repeat(200), 'proof')).toHaveLength(MAX_SLUG);
  });
});

describe('nextName — the default name of a fresh item', () => {
  it('starts at 1 for each kind', () => {
    expect(nextName('session', [])).toBe('Inspect 1');
    expect(nextName('proof', new Set())).toBe('Proof 1');
    expect(nextName('draft', [])).toBe('Post 1');
  });

  it('takes the lowest free number, so deletions leave no gap to count past', () => {
    expect(nextName('proof', ['Proof 1', 'Proof 2'])).toBe('Proof 3');
    expect(nextName('proof', ['Proof 1', 'Proof 3'])).toBe('Proof 2');
  });

  it('ignores names the analyst typed', () => {
    expect(nextName('session', ['Rooftop angle', 'Bridge'])).toBe('Inspect 1');
  });

  it('numbers a name that still slugs to a distinct filename', () => {
    expect(slugify(nextName('proof', ['Proof 1']), 'proof')).toBe('Proof 2');
  });
});

describe('uniqueName — a typed name that has to read apart', () => {
  it('returns the base when it is free', () => {
    expect(uniqueName('Rooftop', new Set())).toBe('Rooftop');
    expect(uniqueName('Rooftop', ['Bridge'])).toBe('Rooftop');
  });

  it('numbers past the base and any run already taken', () => {
    expect(uniqueName('Rooftop', new Set(['Rooftop']))).toBe('Rooftop 2');
    expect(uniqueName('Rooftop', ['Rooftop', 'Rooftop 2', 'Rooftop 3'])).toBe('Rooftop 4');
  });
});

describe('isDefaultName — an assigned name is not a description', () => {
  it('recognizes the names this app assigns', () => {
    expect(isDefaultName('Proof 1', 'proof')).toBe(true);
    expect(isDefaultName('  Proof 12  ', 'proof')).toBe(true);
    expect(isDefaultName('Inspect 3', 'session')).toBe(true);
    expect(isDefaultName('Post 2', 'draft')).toBe(true);
  });

  it('leaves anything the analyst typed alone', () => {
    expect(isDefaultName('Rooftop angle', 'proof')).toBe(false);
    expect(isDefaultName('Proof', 'proof')).toBe(false);
    expect(isDefaultName('Proof 1 rooftop', 'proof')).toBe(false);
    expect(isDefaultName('Inspect 1', 'proof')).toBe(false); // right shape, wrong kind
    expect(isDefaultName(null, 'proof')).toBe(false);
  });
});

describe('saved-item case queries', () => {
  const entities = [
    { label: 'Rooftop', attrs: { spec: 'proofs/.meta/rooftop.json' } },
    { label: 'Bridge', attrs: { spec: 'proofs/.meta/bridge.json' } },
    { label: 'Angle', attrs: { spec: '.inspect/angle.json' } },
    { label: 'Thread', attrs: { draft: '.drafts/thread.json' } },
    { label: 'A place', attrs: { spec: 'places/x.json' } }, // filed, but not one of ours
    { label: 'No spec' },
  ];

  it('picks only the entities of the asked-for kind', () => {
    expect(savedEntities(entities, 'proof').map((e) => e.label)).toEqual(['Rooftop', 'Bridge']);
    expect(savedEntities(entities, 'session').map((e) => e.label)).toEqual(['Angle']);
    expect(savedEntities(entities, 'draft').map((e) => e.label)).toEqual(['Thread']);
    expect(savedEntities(undefined, 'proof')).toEqual([]);
  });

  it('lists the slugs (filename without its folder and .json)', () => {
    expect(savedSlugs(entities, 'proof')).toEqual(new Set(['rooftop', 'bridge']));
    expect(savedSlugs(entities, 'session')).toEqual(new Set(['angle']));
    expect(savedSlugs(entities, 'draft')).toEqual(new Set(['thread']));
  });

  it('lists the names', () => {
    expect(savedTitles(entities, 'proof')).toEqual(new Set(['Rooftop', 'Bridge']));
  });

  it('resolves a name by slug, falling back to the slug itself', () => {
    expect(savedTitle(entities, 'proof', 'bridge')).toBe('Bridge');
    expect(savedTitle(entities, 'draft', 'thread')).toBe('Thread');
    expect(savedTitle(entities, 'proof', 'unknown')).toBe('unknown');
  });

  it('numbers a fresh name past what the case already holds', () => {
    const saved = [
      { label: 'Proof 1', attrs: { spec: 'proofs/.meta/proof-1.json' } },
      { label: 'Rooftop', attrs: { spec: 'proofs/.meta/rooftop.json' } },
    ];
    expect(nextName('proof', savedTitles(saved, 'proof'))).toBe('Proof 2');
  });
});

describe('every kind names its work the same way', () => {
  it('has one prefix per kind and no other', () => {
    // Notes joined the convention: their file is named after the title too,
    // so a fresh one is 'Note 1' the way a fresh session is 'Inspect 1'.
    expect(Object.keys(NAME_PREFIX).sort()).toEqual(['draft', 'note', 'proof', 'session']);
  });
});
