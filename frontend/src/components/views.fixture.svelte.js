/**
 * Reactive stand-in for `AnalysisViews.render.test.js`.
 *
 * The menu reads its case out of an effect, so a plain object would never make it
 * re-run. Runes only work in `.svelte.js` and a `vi.mock` factory runs inside the
 * `.test.js`, so the state lives here and the test hands this module back.
 */
export const caseState = $state({
  current: { id: 'case-a', name: 'Renaming' },
  rev: 0,
});
