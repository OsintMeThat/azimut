/**
 * What Settings has waiting: a newer Azimut, a newer downloader, a capture
 * extension that is behind or was never installed.
 *
 * Pure on purpose: the checks that fill the store live in state.svelte.js and
 * the dots live in App.svelte and Settings, so the placement rules are the part
 * worth testing on their own.
 */
import { shouldShowUpdate } from './appUpdate.js';
import { extensionOutdated } from './extBridge.js';

/**
 * @param {{
 *   app?: object|null,
 *   scrapers?: Array<{dist: string, outdated?: boolean}>|null,
 *   extensionInstalled?: string|null,
 *   extensionBundled?: string,
 * }|null} state  What the startup checks found (state.svelte.js updatesState).
 * @param {string} dismissedVersion  The release tag muted with "don't show again".
 */
export function updateBadges(state, dismissedVersion = '') {
  // Muting a release silences its dot too. A marker the user cannot clear
  // without upgrading is the nagging this whole feature exists to avoid.
  const app = shouldShowUpdate(state?.app ?? null, dismissedVersion);
  // A build that ships no extension has nothing to offer, so it says nothing.
  const bundled = state?.extensionBundled ?? '';
  const installed = state?.extensionInstalled ?? null;
  const extensionMissing = Boolean(bundled) && !installed;
  const extensionOld = extensionOutdated(installed, bundled);
  const scrapers = (state?.scrapers ?? []).filter((s) => s?.outdated).map((s) => s.dist);
  return {
    app,
    // Never installed and out of date are one dot on the tab but two different
    // sentences on the button, so both answers travel.
    extension: extensionMissing || extensionOld,
    extensionMissing,
    extensionOutdated: extensionOld,
    scrapers,
    // Settings keeps the app and the downloaders under System; the extension
    // has a tab of its own.
    tabs: { system: app || scrapers.length > 0, extension: extensionMissing || extensionOld },
    any: app || extensionMissing || extensionOld || scrapers.length > 0,
  };
}

/**
 * Re-judge a local scraper read against what PyPI last reported.
 *
 * A read without `?check=true` knows the installed version and nothing about
 * what's out there, so it would blank the verdict every time Settings reloads
 * the list after an update. Carrying the known `latest` across and comparing it
 * again — the backend's own rule, `version && latest !== version` — keeps the
 * badge honest both ways: it clears the moment an update lands, and it comes
 * back if a revert drops below what PyPI has.
 *
 * @param {Array<object>} fresh  Entries from a local (unchecked) read.
 * @param {Array<object>|null} previous  The last checked entries, if any.
 */
export function carryLatest(fresh, previous) {
  const known = new Map((previous ?? []).map((s) => [s.dist, s.latest]));
  return (fresh ?? []).map((entry) => {
    const latest = known.get(entry.dist);
    if (!latest) return entry;
    return { ...entry, latest, outdated: Boolean(entry.version && entry.version !== latest) };
  });
}
