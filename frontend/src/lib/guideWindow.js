/**
 * The guide in a tab of its own, to follow on a second screen while working in the first.
 *
 * The tab is the guide alone (`#guide?page=…`, mounted by `main.js` in place of the app),
 * and its address is where the reader stands, so a reload or a second press of the
 * button lands on the same page. What the guide would do to the app (open a tool, go to
 * the issue report) it asks of the tab that detached it, which is the one being worked
 * in: a message between two tabs of the same page, nothing on the network.
 */
import { buildHash, splitHash } from './hash.js';
import { JOURNEYS, MENU_ITEMS } from './guide.js';

export const GUIDE_ROUTE = 'guide';
/** The tab the guide opens in, so a second press brings that tab back rather than adding one. */
const GUIDE_TAB = 'azimut-guide';
/** The app tab a guide opened by itself, when no app tab detached it. */
const APP_TAB = 'azimut-app';
const KEY = 'azimut:guide';

/** Whether this address is the guide's own tab. */
export function isGuideTab(hash) {
  return splitHash(hash).route === GUIDE_ROUTE;
}

/** Where the reader stands, as the guide tab's address: the page, its tab, a journey's step. */
export function guideHash({ item, tool = null, step = 0 }) {
  const params = { page: item };
  if (tool) params.tab = tool;
  if (step) params.step = String(step);
  return buildHash(GUIDE_ROUTE, params);
}

/**
 * …and back. An address can be typed, so each part is checked against the guide: an
 * unknown page opens the start, a tab the page lacks its first, a step past the end the first.
 */
export function readGuidePlace(params) {
  const item = MENU_ITEMS.find((entry) => entry.id === params.get('page')) ?? MENU_ITEMS[0];
  const tab = params.get('tab');
  const tool = item.tools.includes(tab) ? tab : (item.tools[0] ?? null);
  const journey = JOURNEYS.find((one) => `journey:${one.id}` === item.id);
  // a journey with a result has one step past its last, where the result is shown
  const last = journey ? journey.steps.length - (journey.result ? 0 : 1) : 0;
  const raw = Number(params.get('step'));
  const step = Number.isInteger(raw) && raw > 0 && raw <= last ? raw : 0;
  return { item: item.id, tool, step };
}

const here = () => `${location.pathname}${location.search}`;

/** Open the guide in its tab, on the reader's place. Null when the browser refused the tab. */
export function openGuideTab(place) {
  return window.open(`${here()}${guideHash(place)}`, GUIDE_TAB);
}

/** A tab of this app the guide can talk to, or null once it is closed or has gone elsewhere. */
function reachable(tab) {
  try {
    return tab && !tab.closed && tab.location.origin === location.origin ? tab : null;
  } catch {
    return null; // a tab now on another site refuses to be read
  }
}

let appTab = null;

/**
 * Ask the app to do something from the guide's tab: `{ open: <tool> }`, `{ report: true }`
 * or `{ example: true }`.
 *
 * It goes to the tab that detached the guide. A guide opened from its address alone has
 * none, so the app opens in a tab of its own on what was asked, and later asks go there.
 * An address cannot say to file the example, so that one is asked again once the tab has loaded.
 */
export function askApp(ask) {
  const tab = reachable(window.opener) ?? reachable(appTab);
  if (tab) {
    tab.postMessage({ [KEY]: ask }, location.origin);
    tab.focus();
    return;
  }
  const route = ask.report ? 'settings' : ask.example ? 'horizon' : ask.open;
  appTab = window.open(`${here()}#${route}`, APP_TAB);
  if (ask.example) appTab?.addEventListener('load', () => appTab.postMessage({ [KEY]: ask }, location.origin));
}

/**
 * In the app: do what a guide tab asks. Only this page's own tabs are heard, and only
 * a tool the app has.
 */
export function listenToGuide({ tools, open, report, example }) {
  const onmessage = (event) => {
    if (event.origin !== location.origin) return;
    const ask = event.data?.[KEY];
    if (ask?.report === true) report();
    else if (ask?.example === true) example();
    else if (tools.includes(ask?.open)) open(ask.open);
  };
  window.addEventListener('message', onmessage);
  return () => window.removeEventListener('message', onmessage);
}
