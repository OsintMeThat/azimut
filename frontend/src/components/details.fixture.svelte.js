/**
 * Reactive stand-ins for `EntityDetails.render.test.js`.
 *
 * The seeding bug this guards against lives in Svelte's dependency tracking, so a
 * plain object standing in for `caseState` proves nothing: the effect under test
 * would simply never re-run. Runes only work in `.svelte.js`, and a `vi.mock`
 * factory runs inside the `.test.js`, so the reactive fixtures live here and the
 * test hands this module back as the mock.
 */
import { formatCoords } from '../lib/coords.js';

export const entity = $state({
  id: 'e1',
  type: 'place',
  label: 'Quay 4',
  attrs: { lat: 1, lon: 2, radius_m: 500, method: 'roofline match' },
  provenance: { by: 'user', at: '2026-01-01T00:00:00Z', status: 'confirmed' },
});

export const caseState = $state({
  current: { id: 'c1', entities: [entity], folders: [] },
  rev: 0,
});

/** What `/media/item` answers with, for the tests that make `entity` a media.
 *  Reactive too: the Source field is gated on how the file entered the case, and
 *  a test flips that between an import and a download. */
export const mediaItem = $state({
  path: 'media/shot.png',
  filename: 'shot.png',
  title: 'shot',
  kind: 'image',
  size: 1024,
  sha256: 'a'.repeat(64),
  source: { type: 'upload', original_name: 'shot.png' },
});

export const reloadCase = () => Promise.resolve();
export const toast = () => {};

/** The panel's one entry point for writing a pair. The real one renders in the
 *  format the analyst chose; this fixture carries no settings, so it renders the
 *  decimal degrees an unset preference gives. */
export const fmtCoords = (lat, lon) => formatCoords(lat, lon);
