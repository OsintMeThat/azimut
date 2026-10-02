import { describe, expect, it } from 'vitest';
import {
  BOARD_GROUPS,
  boardGroup,
  defaultLayout,
  eventWords,
  groupCounts,
  groupOfType,
  groupOpen,
  holdsSubjects,
  loadLayout,
  normalizeLayout,
  saveLayout,
  spanWords,
  typesOfGroup,
  viewLayout,
  waitingOf,
} from './boardGroups.js';

const FAMILIES = {
  person: 'actor',
  organization: 'actor',
  account: 'identifier',
  email: 'identifier',
  place: 'place',
  vehicle: 'asset',
  'equipment-type': 'class',
  claim: 'claim',
  media: 'collected',
  capture: 'collected',
  proof: 'document',
  bookmark: 'document',
};
const familyOf = (type) => FAMILIES[type] ?? null;

function memory() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
}

describe('board groups', () => {
  it('reads the case as who, what and where before its material', () => {
    expect(BOARD_GROUPS.map((group) => group.label)).toEqual([
      'People & organizations',
      'Accounts & identifiers',
      'Places',
      'Things',
      'Equipment types',
      'Events',
      'Files',
      'Work',
      'Other',
    ]);
    const kinds = BOARD_GROUPS.map((group) => group.kind);
    // every subject group comes before every material group
    expect(kinds.lastIndexOf('subject')).toBeLessThan(kinds.indexOf('material'));
  });

  it('puts a type in the group of its family, and a free type in Other', () => {
    expect(groupOfType('person', familyOf).id).toBe('actor');
    expect(groupOfType('email', familyOf).id).toBe('identifier');
    expect(groupOfType('capture', familyOf).id).toBe('collected');
    expect(groupOfType('invented', familyOf).id).toBe('other');
  });

  it('lists a group’s types among the ones the case holds', () => {
    const caseTypes = ['media', 'person', 'organization', 'place', 'claim'];
    expect(typesOfGroup(boardGroup('actor'), caseTypes, familyOf)).toEqual([
      'organization',
      'person',
    ]);
    expect(typesOfGroup(boardGroup('asset'), caseTypes, familyOf)).toEqual([]);
  });

  it('adds a per-type count up per group', () => {
    const counts = groupCounts({ person: 2, organization: 1, media: 20, mystery: 1 }, familyOf);
    expect(counts.actor).toBe(3);
    expect(counts.collected).toBe(20);
    expect(counts.other).toBe(1);
    expect(counts.place).toBe(0);
  });

  it('knows a case of files only holds no subject', () => {
    expect(holdsSubjects({ media: 2, capture: 9, bookmark: 1 }, familyOf)).toBe(false);
    expect(holdsSubjects({ media: 2, place: 1 }, familyOf)).toBe(true);
  });
});

describe('which groups are open', () => {
  const actor = boardGroup('actor');
  const files = boardGroup('collected');

  it('opens the subjects and folds the material', () => {
    expect(groupOpen(actor, {})).toBe(true);
    expect(groupOpen(files, {})).toBe(false);
  });

  it('opens the material when the case has no subject to show instead', () => {
    expect(groupOpen(files, { subjects: false })).toBe(true);
  });

  it('keeps the analyst’s own fold', () => {
    expect(groupOpen(actor, { folds: { actor: false } })).toBe(false);
    expect(groupOpen(files, { folds: { collected: true } })).toBe(true);
  });

  it('opens every group under a question, unless folded during it', () => {
    expect(groupOpen(files, { filtering: true, folds: { collected: false } })).toBe(true);
    expect(groupOpen(files, { filtering: true, asked: { collected: false } })).toBe(false);
  });
});

describe('the layout', () => {
  it('defaults to groups, most noted first, nothing folded', () => {
    expect(defaultLayout()).toEqual({ group: 'kind', sort: '-events', folds: {} });
  });

  it('reshapes a stored value it cannot trust', () => {
    expect(normalizeLayout({ group: 'flat', sort: 'size', folds: { actor: 'no', place: false, nope: true } }))
      .toEqual({ group: 'kind', sort: '-events', folds: { place: false } });
    expect(normalizeLayout(null)).toEqual(defaultLayout());
  });

  it('is kept per case on this machine', () => {
    const storage = memory();
    saveLayout('case-a', { group: 'none', sort: 'label', folds: { actor: false } }, storage);
    expect(loadLayout('case-a', storage)).toEqual({ group: 'none', sort: 'label', folds: { actor: false } });
    expect(loadLayout('case-b', storage)).toEqual(defaultLayout());
    storage.setItem('azimut:board-layout:case-c', '{broken');
    expect(loadLayout('case-c', storage)).toEqual(defaultLayout());
  });

  it('opens a view saved before the groups flat, as it was saved', () => {
    expect(viewLayout({ order: 'label', sortKey: 'label', sortDesc: false })).toEqual({
      group: 'none',
      sort: '-events',
    });
    expect(viewLayout({ group: 'kind', groupSort: 'label' })).toEqual({ group: 'kind', sort: 'label' });
  });
});

describe('what a row says', () => {
  it('writes the span of its events short, reading the half-open end as the day it is', () => {
    expect(spanWords('2026-03-12T00:00:00.000000Z', '2026-03-13T00:00:00.000000Z')).toBe('12 Mar 2026');
    expect(spanWords('2026-03-11T00:00:00.000000Z', '2026-03-20T00:00:00.000000Z')).toBe('11–19 Mar 2026');
    expect(spanWords('2026-03-11T00:00:00.000000Z', '2026-04-03T00:00:00.000000Z')).toBe('11 Mar – 2 Apr 2026');
    expect(spanWords('2025-12-30T00:00:00.000000Z', '2026-01-03T00:00:00.000000Z')).toBe('Dec 2025 – Jan 2026');
    expect(spanWords(null, null)).toBe('');
  });

  it('counts events in words', () => {
    expect(eventWords(1)).toBe('1 event');
    expect(eventWords(12)).toBe('12 events');
  });

  it('shows as waiting only what has something to answer', () => {
    const waiting = waitingOf({
      by_status: { suggested: 3 },
      unlinked: 0,
      lacks: { source: 1, assessment: 4 },
    });
    expect(waiting).toEqual([
      { id: 'review', count: 3, words: 'to review' },
      { id: 'unsourced', count: 1, words: 'event without a source' },
      { id: 'unassessed', count: 4, words: 'events not assessed' },
    ]);
    expect(waitingOf(null)).toEqual([]);
  });
});
