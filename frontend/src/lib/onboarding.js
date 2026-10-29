/**
 * What Azimut shows before any work (components/Onboarding.svelte): the welcome and
 * the tour a newcomer opens with, and the pages a new version shows those who already
 * know it.
 *
 * Both are kept with the workspace (`tour` and `whats_new_seen` in settings.json), so
 * another browser on the same workspace doesn't start a newcomer's tour over, and the
 * settings backup carries them to another machine. The tour resumes where it was left,
 * even on a reload. The welcome and What's new, closed without a choice, wait for the
 * next start rather than the next reload: a tab reloaded is not the app opened. That
 * is this browser's own convenience, in its session storage.
 *
 * What's new lives in whatsNew.json, one entry a version. An entry is a `draft` until
 * its release, which refuses to ship one (tests/test_whats_new.py).
 */
import WHATS_NEW from './whatsNew.json';

/**
 * The tour: the four stages in the order an investigation runs, each a picture of the
 * guide with one control lit. `where` names the stage as the rail does.
 */
export const TOUR = [
  {
    where: { icon: 'folder', label: 'Your case' },
    shot: 'start',
    anchor: 'start.case',
    label: 'The open case',
    title: 'Start with a case',
    text: 'A case is one investigation, kept as a folder on your computer. Everything you save goes into the one named here.',
  },
  {
    where: { icon: 'download', label: 'Sources' },
    shot: 'media',
    anchor: 'media.link',
    label: 'Paste a link',
    title: 'Bring in what you are looking at',
    text: 'Paste a link to a post. Azimut downloads its photos and videos and keeps where they came from.',
  },
  {
    where: { icon: 'satellite', label: 'Map' },
    shot: 'satellite-refs',
    anchor: 'map.ref',
    label: 'Your photo over the map',
    title: 'Find where it was taken',
    text: 'Hold the photo over satellite imagery and look for what matches: a bridge, a crane, a shoreline.',
  },
  {
    where: { icon: 'proof', label: 'Compose' },
    shot: 'proof-result',
    title: 'Prove it',
    text: 'A proof sets the photo beside the map with the matches marked, ready to publish.',
  },
];

/** A version's three numbers: "0.3.3", "v0.3.3" and "0.3.3.dev4" all read [0, 3, 3]. */
export function versionParts(version) {
  const found = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? ''));
  return found ? found.slice(1).map(Number) : null;
}

/** Below zero when `a` comes before `b`. */
function order(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The versions of `book` up to `current` and past `seen`, newest first. */
function versionsBetween(current, seen, book) {
  const now = versionParts(current);
  if (!now) return [];
  const last = versionParts(seen);
  return Object.keys(book)
    .filter((version) => {
      const parts = versionParts(version);
      return parts && order(parts, now) <= 0 && (!last || order(parts, last) > 0);
    })
    .sort((a, b) => order(versionParts(b), versionParts(a)));
}

/**
 * What a reader on `current` has not seen since `seen`, newest version first: someone
 * who skipped a version reads both.
 */
export function newsSince(current, seen, book = WHATS_NEW) {
  return versionsBetween(current, seen, book).flatMap((version) => pagesOf(version, book));
}

/** The pages of the newest version up to `current`, for What's new opened by hand. */
export function newsOf(current, book = WHATS_NEW) {
  const [newest] = versionsBetween(current, '', book);
  return newest ? pagesOf(newest, book) : [];
}

/** A version's pages, each saying which version it is from. */
function pagesOf(version, book) {
  return book[version].pages.map((page) => ({ ...page, version }));
}

/**
 * What the app opens with, or null: the tour where it was left, the welcome for a
 * workspace with nothing in it yet, or what a new version brings.
 *
 * `tour` and `seen` are the settings, `hasCases` whether the workspace holds any case,
 * `closed` whether the welcome or What's new was already put away this start.
 */
export function onStart({ tour, seen, version, hasCases, closed = false }, book = WHATS_NEW) {
  if (/^[1-9]$/.test(tour ?? '')) return { kind: 'tour', step: Math.min(Number(tour), TOUR.length) - 1 };
  if (closed) return null;
  if (!tour && !hasCases) return { kind: 'welcome' };
  const pages = newsSince(version, seen, book);
  return pages.length ? { kind: 'news', pages } : null;
}

const CLOSED = 'azimut:onboardingClosed';

/** Whether the welcome or What's new was put away earlier in this start. */
export function closedThisStart(version) {
  try {
    return sessionStorage.getItem(CLOSED) === version;
  } catch {
    return false;
  }
}

/** Put away without a choice: back at the next start, not at the next reload. */
export function closeForThisStart(version) {
  try {
    sessionStorage.setItem(CLOSED, version);
  } catch {
    /* it shows again on a reload, which is all a refused storage costs */
  }
}
