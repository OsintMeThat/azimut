/**
 * A reactive stand-in for the app's `uiState` in tests that drive the keys one
 * tool writes and another reads (a saved item to open, a pair handed over).
 * A plain object would take the write and never wake the effect behind it.
 */
export const uiState = $state({
  tool: 'detect', openAnalyzer: null, lookAt: null, gotoCoords: null, mapView: null, mapPoint: null,
});
