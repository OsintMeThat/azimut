import { describe, expect, it } from 'vitest';
import {
  WAYBACK_ID,
  changesKey,
  positionOf,
  releaseDate,
  releaseOf,
  releaseYearBefore,
  stepRelease,
  validRelease,
  visibleReleases,
  waybackId,
} from './wayback.js';

/** Newest first, with numbers out of date order, as Esri publishes them. */
const RELEASES = [
  { release: 26334, date: '2026-08-05' },
  { release: 64776, date: '2023-08-31' },
  { release: 25982, date: '2023-06-13' },
  { release: 10, date: '2014-02-20' },
];

describe('the id a release rides on', () => {
  it('names the release, and leaves the newest plain', () => {
    expect(waybackId(WAYBACK_ID, 64776)).toBe('esri-wayback~64776');
    expect(waybackId(WAYBACK_ID, null)).toBe('esri-wayback');
  });

  it('never decorates another basemap', () => {
    expect(waybackId('esri-world-imagery', 64776)).toBe('esri-world-imagery');
  });

  it('refuses anything that is not a whole release number', () => {
    for (const bad of [0, -3, 1.5, '64776', NaN, 1e9]) {
      expect(validRelease(bad)).toBe(false);
      expect(waybackId(WAYBACK_ID, bad)).toBe(WAYBACK_ID);
    }
  });

  it('reads the release back out of an id', () => {
    expect(releaseOf('esri-wayback~64776')).toBe(64776);
    expect(releaseOf('esri-wayback')).toBeNull();
    expect(releaseOf('sentinel2~SWIR')).toBeNull();
    expect(releaseOf('esri-wayback~../x')).toBeNull();
  });
});

describe('what the picker offers', () => {
  it('is every release until the changes are known', () => {
    expect(visibleReleases(RELEASES, null, true)).toBe(RELEASES);
  });

  it('narrows to the releases that changed the point, keeping their dates', () => {
    expect(visibleReleases(RELEASES, [64776, 10], true)).toEqual([RELEASES[1], RELEASES[3]]);
  });

  it('shows everything when asked to, whatever the changes say', () => {
    expect(visibleReleases(RELEASES, [10], false)).toBe(RELEASES);
  });

  it('dates the newest when no release is pinned, and nothing before the list', () => {
    expect(releaseDate(RELEASES, null)).toBe('2026-08-05');
    expect(releaseDate(RELEASES, 25982)).toBe('2023-06-13');
    expect(releaseDate([], null)).toBe('');
  });
});

describe('stepping through time', () => {
  const changed = [RELEASES[1], RELEASES[3]]; // 2023-08-31, 2014-02-20

  it('walks one release older or newer', () => {
    expect(stepRelease(RELEASES, RELEASES, 64776, 1)).toBe(25982);
    expect(stepRelease(RELEASES, RELEASES, 64776, -1)).toBe(26334);
  });

  it('starts from the newest when nothing is pinned', () => {
    expect(positionOf(RELEASES, RELEASES, null)).toBe(0);
    expect(stepRelease(RELEASES, RELEASES, null, 1)).toBe(64776);
  });

  it('stops at either end rather than wrapping', () => {
    expect(stepRelease(RELEASES, RELEASES, 26334, -1)).toBeUndefined();
    expect(stepRelease(RELEASES, RELEASES, 10, 1)).toBeUndefined();
  });

  it('steps from a release outside the narrowed list to its neighbouring change', () => {
    // 25982 changed nothing here; older than it is 2014, newer is 2023-08-31
    expect(stepRelease(changed, RELEASES, 25982, 1)).toBe(10);
    expect(stepRelease(changed, RELEASES, 25982, -1)).toBe(64776);
  });

  it('has nowhere to go in an empty list', () => {
    expect(stepRelease([], RELEASES, 10, 1)).toBeUndefined();
  });
});

describe('the question a point history answers', () => {
  it('is one tile at the view zoom, so a nudge inside it is the same question', () => {
    expect(changesKey(50.45, 30.51, 15)).toBe(changesKey(50.4501, 30.5101, 15));
  });

  it('is a different question in the next tile or at another zoom', () => {
    expect(changesKey(50.45, 30.51, 15)).not.toBe(changesKey(50.45, 30.53, 15));
    expect(changesKey(50.45, 30.51, 15)).not.toBe(changesKey(50.45, 30.51, 16));
  });

  it('matches the tile the backend walks, and stops at the basemap ceiling', () => {
    // engine/tiles.py project(50.45, 30.51, 15) → (19161.09, 11049.07)
    expect(changesKey(50.45, 30.51, 15)).toBe('15/19161/11049');
    expect(changesKey(50.45, 30.51, 22).startsWith('19/')).toBe(true);
  });
});

describe('the release a "then" side opens on', () => {
  const today = new Date('2026-09-23T12:00:00Z');

  it('is the newest published a year or more before today', () => {
    expect(releaseYearBefore(RELEASES, today)).toBe(64776);
    expect(releaseYearBefore(RELEASES, new Date('2024-06-13T00:00:00Z'))).toBe(25982);
  });

  it('falls back to the oldest when every release is younger', () => {
    expect(releaseYearBefore(RELEASES.slice(0, 2), new Date('2024-01-01T00:00:00Z'))).toBe(64776);
  });

  it('refuses to name the newest, which is today’s imagery again', () => {
    expect(releaseYearBefore(RELEASES.slice(0, 1), today)).toBeNull();
    expect(releaseYearBefore([], today)).toBeNull();
    expect(releaseYearBefore(undefined, today)).toBeNull();
  });
});
