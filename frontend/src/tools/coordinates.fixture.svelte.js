/**
 * Reactive stand-in for `Coordinates.render.test.js`.
 *
 * The tab reads the map's point out of an effect, so a plain object would never
 * make it run again when the test moves the map. Runes only work in
 * `.svelte.js` and a `vi.mock` factory runs inside the `.test.js`, so the state
 * lives here and the test hands this module back.
 */
export const uiState = $state({ tool: 'coordinates', mapPoint: null, gotoCoords: null });

export const caseState = $state({ current: null });

/** Put the fixture back the way every test starts. */
export function resetCoordinatesFixture() {
  uiState.tool = 'coordinates';
  uiState.mapPoint = null;
  uiState.gotoCoords = null;
  caseState.current = null;
}
