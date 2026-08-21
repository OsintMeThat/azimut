/**
 * The outgoing shape, as the two rules that keep it honest on the browser's side.
 *
 * A `locked` column is the one role that is written by the app **and** carries a link:
 * the whole point of those cells is that they open the entity the case filled them from.
 * Every other written role points at nothing, so offering the `@` on one would offer a
 * link to nowhere.
 *
 * And the sheet this shape builds must not offer the proofs build. That road downloads
 * what a column of addresses points at; here the proofs already exist, so a button
 * saying "build them" would be a button with nothing to do.
 */
import { describe, expect, it } from 'vitest';
import { canBuild, columnKinds } from './sheetBuild.js';
import { COMPUTED_NATURES, ROLE_KINDS, normalizeRole } from './sheetRoles.js';

/** The shape as the server builds it. Mirrors `engine/sheetfromcase.proof_columns`. */
const TABLE = {
  columns: ['id', 'Title', 'Source media', 'Place', 'Coordinates', 'In case', 'Status', 'Notes'],
  rows: [['r1', 'Rooftop shot', 'GX010234', 'Rooftop', '47.10000, 37.50000', 'YES', 'done', '']],
};
const META = {
  roles: {
    Title: { kind: 'locked' },
    'Source media': { kind: 'locked' },
    Place: { kind: 'locked' },
    Coordinates: { kind: 'computed', of: 'point', from: 'Place' },
    'In case': { kind: 'computed', of: 'in_case' },
    Status: { kind: 'state', values: ['to do', 'in progress', 'done', 'ruled out'] },
  },
  links: { r1: { Title: 'e1', 'Source media': 'e2', Place: 'e3' } },
  built: { r1: 'e1' },
};

describe('the roles the outgoing shape declares', () => {
  it('knows the locked kind and the in_case nature', () => {
    expect(ROLE_KINDS).toContain('locked');
    expect(COMPUTED_NATURES).toContain('in_case');
  });

  it('keeps a locked role down to its kind, since it has nothing else to say', () => {
    expect(normalizeRole({ kind: 'locked' })).toEqual({ kind: 'locked' });
    // Fields a kind does not use are dropped rather than carried.
    expect(normalizeRole({ kind: 'locked', values: ['a'], of: 'point' })).toEqual({
      kind: 'locked',
    });
  });

  it('accepts in_case as a computed nature and asks it for no column', () => {
    const clean = normalizeRole({ kind: 'computed', of: 'in_case' });
    expect(clean.of).toBe('in_case');
    // It reads `built`, not a named column: nothing to follow and nothing to count.
    expect(clean.from).toBeUndefined();
    expect(clean.columns).toBeUndefined();
  });

  it('falls back rather than storing a nature nobody implements', () => {
    expect(normalizeRole({ kind: 'computed', of: 'invented' }).of).toBe('has_point');
  });
});

describe('what this sheet is not', () => {
  it('does not offer the proofs build, because there is nothing left to fetch', () => {
    expect(canBuild(columnKinds(TABLE, META))).toBe(false);
  });

  it('holds no address column at all, which is what makes that true', () => {
    expect(Object.values(columnKinds(TABLE, META))).not.toContain('url');
  });

  it('still offers it on the incoming template, which is the other direction', () => {
    const incoming = {
      columns: ['id', 'Title', 'Source media', 'Geolocation proof', 'Coordinates'],
      rows: [],
    };
    const roles = {
      roles: {
        'Source media': { kind: 'url' },
        'Geolocation proof': { kind: 'url' },
        Coordinates: { kind: 'latlon' },
      },
    };
    expect(canBuild(columnKinds(incoming, roles))).toBe(true);
  });
});
