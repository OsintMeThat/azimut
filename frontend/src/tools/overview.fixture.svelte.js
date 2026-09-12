/**
 * Reactive stand-in for `Overview.render.test.js`.
 *
 * The page re-reads the case out of an effect, so a plain object would never make it
 * run again when the test opens or closes a case. Runes only work in `.svelte.js` and
 * a `vi.mock` factory runs inside the `.test.js`, so the state lives here.
 *
 * Its own file rather than the views fixture next door: this one carries the case
 * `list` — the front door offers the cases you have, and the header prefers the
 * list's stamp over the manifest's.
 */
export const caseState = $state({
  current: null,
  list: [],
  folders: [],
  loading: false,
  rev: 0,
});

export const uiState = $state({ tool: 'overview', settingsTab: null, guideSection: null });

export const prefs = $state({ updateDismissedVersion: '', units: 'metric' });

export const updatesState = $state({
  app: null,
  scrapers: null,
  extensionInstalled: null,
  extensionBundled: '',
  extension: null,
});

/** Put the fixture back the way every test starts. */
export function resetOverviewFixture() {
  caseState.current = null;
  caseState.list = [];
  caseState.rev = 0;
  uiState.tool = 'overview';
  uiState.settingsTab = null;
  uiState.guideSection = null;
  prefs.updateDismissedVersion = '';
  prefs.units = 'metric';
  updatesState.app = null;
  updatesState.extensionInstalled = null;
  updatesState.extensionBundled = '';
  updatesState.extension = null;
}
