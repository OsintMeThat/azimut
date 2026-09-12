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
 * Is the extension this browser runs behind what the app ships?
 *
 * For a copy the app owns, the digest in its install stamp answers it — and it is
 * the only thing that can: a release that leaves the extension alone keeps its
 * version, and within a development cycle the bundled version is already the
 * app's own, so "behind" and "identical" are indistinguishable from a version.
 *
 * For a copy loaded from somebody else's folder there is no stamp to read, so the
 * version is all there is. It is also all the button can act on there, since the
 * app can only rewrite the folder it owns.
 *
 * Same road for Firefox's signed copy, and it is the one place the answer is
 * worth more than a button: nothing here can update it, but the app ships the
 * extension and therefore knows its version offline — so it can say "behind"
 * on the spot rather than wait out the browser's own daily check.
 */
function behindWhatWeShip(verdict, bundled) {
  if (verdict.status === 'absent') return false;
  if (verdict.installed) return verdict.updateAvailable;
  return extensionOutdated(verdict.detectedVersion, bundled);
}

/**
 * @param {{
 *   app?: object|null,
 *   scrapers?: Array<{dist: string, outdated?: boolean}>|null,
 *   extensionInstalled?: string|null,
 *   extensionBundled?: string,
 *   extension?: object|null,
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
  // The probes' verdict once it has come back. Until then — and if it fails —
  // the synchronous <html> marker and a version comparison, which is where this
  // badge lived before the app owned the extension's folder.
  const verdict = state?.extension ?? null;
  const extensionMissing =
    Boolean(bundled) && (verdict ? verdict.status === 'absent' : !installed);
  const extensionOld = verdict
    ? behindWhatWeShip(verdict, bundled)
    : extensionOutdated(installed, bundled);
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
