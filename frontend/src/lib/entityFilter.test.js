import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADDED,
  AXES,
  QUESTIONS,
  activeAxes,
  askQuestion,
  chipsOf,
  clearAxis,
  emptyFilter,
  hasTerm,
  isFiltering,
  loadFilter,
  orderFor,
  saveFilter,
  sinceFor,
  toQuery,
  toggleValue,
} from './entityFilter.js';

/** A localStorage stand-in — the test env has no DOM. */
function fakeStorage(seed = {}) {
  const store = { ...seed };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
    all: () => store,
  };
}

const at = (filter) => ({ ...emptyFilter(), ...filter });

describe('the question is a value', () => {
  it('starts with every key present, so nothing downstream guesses', () => {
    const filter = emptyFilter();
    for (const axis of AXES) expect(hasTerm(filter, axis.key)).toBe(false);
    expect(isFiltering(filter)).toBe(false);
  });

  it('counts a typed term as asking something, since the table narrows on it', () => {
    expect(isFiltering(at({ q: 'bridge' }))).toBe(true);
  });

  it('holds several values on the axes where that is one question', () => {
    // "accounts and people" is one question about the case, not two filters
    expect(toggleValue(['account'], 'person')).toEqual(['account', 'person']);
    expect(toggleValue(['account', 'person'], 'account')).toEqual(['person']);
    expect(activeAxes(at({ types: ['account', 'person'] }))).toEqual(['type']);
  });

  it('treats a field with no value as half an act, and drops it whole', () => {
    // picked, values just fetched: it is a term being built, and asked as one it
    // would empty the table between two clicks
    const half = at({ attrKey: 'kind' });
    expect(hasTerm(half, 'field')).toBe(true);
    expect(toQuery(half).attr).toBe('kind');
    expect(toQuery(half).value).toBeUndefined();
    expect(clearAxis(half, 'field').attrKey).toBe('');
  });

  it('takes the whole folder term out at once, reach included', () => {
    const filed = at({ folder: '/field-work', recursive: true });
    const cleared = clearAxis(filed, 'folder');
    expect(cleared.folder).toBe('');
    expect(cleared.recursive).toBe(false);
    expect(cleared.unfiled).toBe(false);
  });
});

describe('the questions every case is asked', () => {
  it('drops its terms in as ordinary chips, which is how the language is taught', () => {
    for (const question of QUESTIONS) {
      const asked = askQuestion(emptyFilter(), question.id);
      expect(isFiltering(asked)).toBe(true);
      expect(chipsOf(asked).length).toBe(1);
    }
  });

  it('asks the case for what nothing connects to, which no column reports', () => {
    const loose = askQuestion(emptyFilter(), 'loose');
    expect(toQuery(loose).unlinked).toBe(true);
    expect(chipsOf(loose)[0].text).toBe('Nothing linked');
  });
});

describe('the question as a request', () => {
  it('sends only the terms that are set', () => {
    const params = toQuery(emptyFilter());
    for (const value of Object.values(params)) {
      expect(value === undefined || Array.isArray(value)).toBe(true);
    }
  });

  it('lets unfiled win over a path, as the catalog does', () => {
    const params = toQuery(at({ unfiled: true, folder: '/field-work', recursive: true }));
    expect(params.unfiled).toBe(true);
    expect(params.folder).toBeUndefined();
    expect(params.recursive).toBeUndefined();
  });

  it('resolves a relative range against today on every request', () => {
    // a preset is a standing question — "this week" means this week whenever it is
    // asked — where a date typed by hand is an absolute bound and stays put
    const now = Date.parse('2026-08-10T12:00:00Z');
    expect(sinceFor('7d', now)).toBe('2026-08-03');
    expect(toQuery(at({ added: '7d' }), { now }).since).toBe('2026-08-03');
    expect(toQuery(at({ since: '2026-01-01', until: '2026-02-01' })).since).toBe('2026-01-01');
    expect(toQuery(at({ since: '2026-01-01', until: '2026-02-01' })).until).toBe('2026-02-01');
  });

  it('offers every range the menu shows', () => {
    const now = Date.parse('2026-08-10T12:00:00Z');
    for (const range of ADDED) expect(sinceFor(range.value, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('carries the types it was handed rather than resolving families itself', () => {
    // the family layer is server vocabulary and the registry is a Svelte module, so
    // this stays pure
    expect(toQuery(at({ families: ['actor'] }), { types: ['person', 'account'] }).types).toEqual([
      'person',
      'account',
    ]);
  });
});

describe('the question in words', () => {
  it('writes one chip per term, in the order the menu offers them', () => {
    const filter = at({
      families: ['actor'],
      types: ['media'],
      status: 'suggested',
      attrKey: 'kind',
      attrValue: 'video',
      linked: 'place',
    });
    expect(chipsOf(filter, { type: (t) => t.toUpperCase() }).map((chip) => chip.axis)).toEqual([
      'family',
      'type',
      'status',
      'field',
      'linked',
    ]);
  });

  it('says a field is still being built rather than reading as a live filter', () => {
    expect(chipsOf(at({ attrKey: 'kind' }))[0].text).toContain('pick a value');
    expect(chipsOf(at({ attrKey: 'kind', attrValue: 'video' }))[0].text).toBe('kind = video');
  });

  it('says how far a folder chip reaches', () => {
    expect(chipsOf(at({ folder: '/a' }))[0].text).toBe('Folder: /a');
    expect(chipsOf(at({ folder: '/a', recursive: true }))[0].text).toBe('Folder: /a and under');
    expect(chipsOf(at({ unfiled: true }))[0].text).toBe('Unfiled');
  });

  it('falls back to the slug for a type the vocabulary has never heard of', () => {
    expect(chipsOf(at({ types: ['vessel'] }))[0].text).toBe('Type: vessel');
  });
});

describe('where a sort is answered', () => {
  it('names the two columns the store can order the whole case by', () => {
    expect(orderFor('created', true)).toBe('-created');
    expect(orderFor('label', false)).toBe('label');
  });

  it('leaves every other heading to the rows already loaded', () => {
    expect(orderFor('folder', false)).toBe('');
    expect(orderFor('', false)).toBe('');
  });
});

describe('remembering the question', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage());
  });

  it('keeps it per case, so two cases do not inherit each other’s filters', () => {
    saveFilter('c_one', at({ status: 'suggested' }));
    expect(loadFilter('c_one').status).toBe('suggested');
    expect(loadFilter('c_two').status).toBe('');
  });

  it('forgets it the moment nothing is being asked', () => {
    saveFilter('c_one', at({ status: 'suggested' }));
    saveFilter('c_one', emptyFilter());
    expect(loadFilter('c_one')).toEqual(emptyFilter());
  });

  it('fills in a key an older build never wrote', () => {
    vi.stubGlobal(
      'localStorage',
      fakeStorage({ 'azimut:board-filter:c_one': JSON.stringify({ status: 'suggested' }) })
    );
    expect(loadFilter('c_one')).toEqual({ ...emptyFilter(), status: 'suggested' });
  });

  it('survives a hostile or absent localStorage (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
      removeItem() {
        throw new Error('denied');
      },
    });
    expect(loadFilter('c_one')).toEqual(emptyFilter());
    expect(() => saveFilter('c_one', at({ status: 'suggested' }))).not.toThrow();
  });
});
