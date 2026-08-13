/**
 * Reactive stand-ins for `EntityDetails.render.test.js`.
 *
 * The seeding bug this guards against lives in Svelte's dependency tracking, so a
 * plain object standing in for `caseState` proves nothing: the effect under test
 * would simply never re-run. Runes only work in `.svelte.js`, and a `vi.mock`
 * factory runs inside the `.test.js`, so the reactive fixtures live here and the
 * test hands this module back as the mock.
 */
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

export const reloadCase = () => Promise.resolve();
export const toast = () => {};
