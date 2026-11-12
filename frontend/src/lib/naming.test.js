import { describe, it, expect } from 'vitest';
import {
  MAX_SLUG, NAME_PREFIX, slugify, nextName, isDefaultName,
  savedEntities, savedSlugs, savedTitles, savedTitle, specAttr, specPath,
  itemLabel, labelCoords, labelDay, ownName,
} from './naming.js';

describe('slugify — mirrors the backend api/naming.slugify', () => {
  it('preserves human text and replaces only forbidden filename characters', () => {
    expect(slugify('Collage 1', 'collage')).toBe('Collage 1');
    expect(slugify('  Rooftop! @ 12:30  ', 'proof')).toBe('Rooftop! @ 12_30');
    expect(slugify('Café déjà', 'proof')).toBe('Café déjà');
  });

  it('falls back to the caller word when nothing survives, and caps the length', () => {
    expect(slugify('', 'proof')).toBe('proof');
    expect(slugify('!!!', 'collage')).toBe('!!!');
    expect(slugify(null, 'draft')).toBe('draft');
    expect(slugify('a'.repeat(200), 'proof')).toHaveLength(MAX_SLUG);
  });

  // the cases tests/test_naming.py pins on the backend, so a name taken is judged alike
  it('drops the invisible characters a paste brings along', () => {
    expect(slugify('7H45MFQC+QR⁩', 'Proof')).toBe('7H45MFQC+QR');
    expect(slugify('⁧جسر⁩ bridge', 'Proof')).toBe('جسر bridge');
    for (const char of ['‎', '‏', '؜', '‪', '‫', '‬', '‭', '‮',
      '⁦', '⁧', '⁨', '⁩', '​', '⁠', '﻿', '­']) {
      expect(slugify(`${char}Har${char}bour${char}`, 'Proof'), JSON.stringify(char)).toBe('Harbour');
    }
    expect(slugify('⁦⁩', 'Proof')).toBe('Proof');
    expect(slugify('Port ⁩ east', 'Proof')).toBe('Port east');
  });

  it('keeps a joiner inside a word and drops one at its ends', () => {
    for (const joiner of ['‍', '‌']) {
      expect(slugify(`${joiner}Depot${joiner}`, 'Proof')).toBe('Depot');
      expect(slugify(`North ${joiner}depot`, 'Proof')).toBe('North depot');
      expect(slugify(`North${joiner} depot`, 'Proof')).toBe('North depot');
      expect(slugify(`mi${joiner}ravam`, 'Proof')).toBe(`mi${joiner}ravam`);
    }
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
    expect(slugify(`Rally ${family}`, 'Proof')).toBe(`Rally ${family}`);
  });
});

describe('nextName — the default name of a fresh item', () => {
  it('starts at 1 for each kind', () => {
    expect(nextName('collage', [])).toBe('Collage 1');
    expect(nextName('proof', new Set())).toBe('Proof 1');
    expect(nextName('draft', [])).toBe('Post 1');
  });

  it('takes the lowest free number, so deletions leave no gap to count past', () => {
    expect(nextName('proof', ['Proof 1', 'Proof 2'])).toBe('Proof 3');
    expect(nextName('proof', ['Proof 1', 'Proof 3'])).toBe('Proof 2');
  });

  it('ignores names the analyst typed', () => {
    expect(nextName('collage', ['Rooftop angle', 'Bridge'])).toBe('Collage 1');
  });

  it('numbers a name that still slugs to a distinct filename', () => {
    expect(slugify(nextName('proof', ['Proof 1']), 'proof')).toBe('Proof 2');
  });
});

describe('isDefaultName — an assigned name is not a description', () => {
  it('recognizes the names this app assigns', () => {
    expect(isDefaultName('Proof 1', 'proof')).toBe(true);
    expect(isDefaultName('  Proof 12  ', 'proof')).toBe(true);
    expect(isDefaultName('Collage 3', 'collage')).toBe(true);
    expect(isDefaultName('Post 2', 'draft')).toBe(true);
  });

  it('leaves anything the analyst typed alone', () => {
    expect(isDefaultName('Rooftop angle', 'proof')).toBe(false);
    expect(isDefaultName('Proof', 'proof')).toBe(false);
    expect(isDefaultName('Proof 1 rooftop', 'proof')).toBe(false);
    expect(isDefaultName('Collage 1', 'proof')).toBe(false); // right shape, wrong kind
    expect(isDefaultName(null, 'proof')).toBe(false);
  });
});

describe('saved-item case queries', () => {
  const entities = [
    { label: 'Rooftop', attrs: { spec: 'proofs/.meta/rooftop.json' } },
    { label: 'Bridge', attrs: { spec: 'proofs/.meta/bridge.json' } },
    { label: 'Angle', attrs: { spec: '.collages/angle.json' } },
    { label: 'Thread', attrs: { draft: '.drafts/thread.json' } },
    { label: 'A place', attrs: { spec: 'places/x.json' } }, // filed, but not one of ours
    { label: 'No spec' },
  ];

  it('builds the spec path a filed entity actually carries', () => {
    // The tools look an item up by this exact string to tell whether it is still
    // filed, so it has to name the hidden folders the case really uses — a stale
    // `exports/` matched nothing and warned "deleted" on every save.
    expect(specPath('collage', 'angle')).toBe('.collages/angle.json');
    expect(specPath('proof', 'rooftop')).toBe('proofs/.meta/rooftop.json');
    expect(specPath('draft', 'thread')).toBe('.drafts/thread.json');
    // and the same string the filed entities carry, so a lookup by it hits
    for (const [kind, slug] of [['collage', 'angle'], ['proof', 'rooftop'], ['draft', 'thread']]) {
      expect(entities.some((e) => e.attrs?.[specAttr(kind)] === specPath(kind, slug))).toBe(true);
    }
  });

  it('names the attribute each kind stores its spec under', () => {
    expect(specAttr('collage')).toBe('spec');
    expect(specAttr('proof')).toBe('spec');
    expect(specAttr('draft')).toBe('draft'); // posts are the odd one out
  });

  it('picks only the entities of the asked-for kind', () => {
    expect(savedEntities(entities, 'proof').map((e) => e.label)).toEqual(['Rooftop', 'Bridge']);
    expect(savedEntities(entities, 'collage').map((e) => e.label)).toEqual(['Angle']);
    expect(savedEntities(entities, 'draft').map((e) => e.label)).toEqual(['Thread']);
    expect(savedEntities(undefined, 'proof')).toEqual([]);
  });

  it('lists the slugs (filename without its folder and .json)', () => {
    expect(savedSlugs(entities, 'proof')).toEqual(new Set(['rooftop', 'bridge']));
    expect(savedSlugs(entities, 'collage')).toEqual(new Set(['angle']));
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
    // so a fresh one is 'Note 1' the way a fresh collage is 'Collage 1'.
    expect(Object.keys(NAME_PREFIX).sort()).toEqual(['collage', 'draft', 'note', 'proof']);
  });
});

describe('a label, for an item with no name of its own', () => {
  const now = new Date(2026, 10, 11, 10, 0);

  it('reads a technical name as no name, and keeps the analyst\'s', () => {
    expect(['Post 41', 'Proof 3', ' Post 2 ', 'Post', 'Post 4b', 'Harbour'].map((name) => ownName(name, name.includes('Proof') ? 'proof' : 'draft')))
      .toEqual(['', '', '', 'Post', 'Post 4b', 'Harbour']);
    expect(ownName('Proof 3', 'draft')).toBe('Proof 3');
  });

  it('says a day as a card does, the year added outside this one, a written date as written', () => {
    expect(labelDay('2026-11-09', now)).toBe('9 Nov');
    expect(labelDay('2025-10-24 14:30 UTC+3', now)).toBe('24 Oct 2025');
    // an instant is this machine's day
    const instant = new Date(2026, 1, 3, 23, 30).toISOString();
    expect(labelDay(instant, now)).toBe('3 Feb');
    expect(['', null, 'yesterday', '24/10/2025', '2026-13-01'].map((value) => labelDay(value, now))).toEqual(['', '', '', '', '']);
  });

  it('says a point in four decimals', () => {
    expect(labelCoords([15.471234, 45.322109])).toBe('15.4712, 45.3221');
    expect(labelCoords({ lat: -3.5, lon: 120 })).toBe('-3.5000, 120.0000');
    expect(labelCoords(null)).toBe('');
  });

  it('is the name given, else the place and the day, else the point, else Untitled', () => {
    const facts = { place: 'Al Jawf, Yemen', when: [null, '2026-11-09'], coords: [15.47, 45.32] };
    expect(itemLabel('proof', 'Rooftop angle', facts, now)).toBe('Rooftop angle');
    expect(itemLabel('proof', 'Proof 3', facts, now)).toBe('Al Jawf, Yemen · 9 Nov');
    // the first date that says a day wins
    expect(itemLabel('draft', 'Post 41', { ...facts, when: ['not a date', '2025-01-02', '2026-11-09'] }, now)).toBe('Al Jawf, Yemen · 2 Jan 2025');
    expect(itemLabel('draft', 'Post 41', { ...facts, place: '' }, now)).toBe('15.4700, 45.3200 · 9 Nov');
    expect(itemLabel('draft', 'Post 41', { place: 'Marib, Yemen' }, now)).toBe('Marib, Yemen');
    expect(itemLabel('draft', 'Post 41', { when: ['2026-11-09'] }, now)).toBe('Untitled post');
    expect(itemLabel('proof', '', {}, now)).toBe('Untitled proof');
  });
});
