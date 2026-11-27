// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('../lib/api.js', () => ({ api: { get: vi.fn(async () => []) } }));
vi.mock('../lib/findExample.js', () => ({ openFindExample: vi.fn() }));
vi.mock('../lib/journeyHere.js', () => ({ gatherFacts: vi.fn(async () => ({})), hereOn: vi.fn() }));
vi.mock('../lib/showInApp.svelte.js', () => ({ showInApp: vi.fn() }));
vi.mock('../lib/practiceCase.js', () => ({
  openPractice: vi.fn(),
  isPractice: vi.fn((open) => open?.name === 'Practice: Port of Los Angeles'),
  checkAnswer: vi.fn(() => ({ metres: 120, right: true })),
}));

const { openFindExample } = await import('../lib/findExample.js');
const { gatherFacts, hereOn } = await import('../lib/journeyHere.js');
const { showInApp } = await import('../lib/showInApp.svelte.js');
const { openPractice } = await import('../lib/practiceCase.js');
const { caseState, uiState } = await import('../lib/state.svelte.js');
const { default: GuideDialog } = await import('./GuideDialog.svelte');
const { EXTENSION_SITES, EXTENSION_TABS, JOURNEYS, KEYMAP, FIXES, PAGES, SETTINGS_TABS, landingFor, stepAs, stepMarks } = await import('../lib/guide.js');

let live;
let onclose;

/** The guide opened on `at`; a journey's welcome passed by its first start unless `welcome` keeps it. */
async function open(at, props = {}, { welcome = false } = {}) {
  onclose = vi.fn();
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(GuideDialog, { target, props: { at, onclose, ...props } });
  flushSync();
  await Promise.resolve();
  const start = document.querySelector('.welcome .starts .go');
  if (start && !welcome) {
    start.click();
    flushSync();
  }
}

const entry = (label) => [...document.querySelectorAll('.menu .entry')].find((b) => b.textContent.trim() === label);
const current = (selector) => document.querySelector(`${selector}[aria-current]`)?.textContent.trim();
const lines = () => [...document.querySelectorAll('.legend .mark')];
const frames = () => [...document.querySelectorAll('.frame')];
const pins = () => [...document.querySelectorAll('.pin')];
const press = (node) => {
  node.click();
  flushSync();
};
function hover(node, on = true) {
  node.dispatchEvent(new MouseEvent(on ? 'mouseenter' : 'mouseleave'));
  flushSync();
}

/** The trail's waypoints, one by its name, and what the bubble says to press. */
const nodes = () => [...document.querySelectorAll('.trail .point')];
const node = (label) => nodes().find((one) => one.querySelector('.step-name').textContent.trim() === label);
const said = () => document.querySelector('.bubble .press')?.textContent;
const nowhere = () => ({ kind: null, scene: null, done: [], here: null, next: [], facts: [] });
/** The stage lights a control once its screen is in. */
async function settle() {
  await new Promise((done) => setTimeout(done, 350));
  flushSync();
}
/** Press the bubble's way on, to the screen it lands on. */
async function pressOn() {
  press(document.querySelector('.bubble .go'));
  await settle();
}

// happy-dom's own animations reject when cut short: a journey's screens fade in and out
beforeEach(() => {
  Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });
  // happy-dom lays nothing out: the trail is given the width a browser would measure
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
});

afterEach(() => {
  delete Element.prototype.animate;
  delete HTMLElement.prototype.clientWidth;
  if (live) unmount(live);
  caseState.current = null;
  live = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('the guide over a tool', () => {
  it('opens on the tab of the tool it was asked from, its picture numbered', async () => {
    await open('media');
    expect(current('.menu .entry')).toBe('Sources');
    expect(current('.tabs .tab')).toBe('Media');
    expect(document.querySelector('.shot img')).not.toBeNull();
    expect(lines()).toHaveLength(PAGES.media.marks.length);
    expect(pins().map((pin) => pin.textContent.trim())).toEqual(PAGES.media.marks.map((_, i) => String(i + 1)));
  });

  it('shows only its numbers at rest, so no frame crosses another', async () => {
    await open('media');
    expect(document.querySelector('.frame.on')).toBeNull();
    expect(document.querySelector('.veil').classList.contains('on')).toBe(false);
  });

  it('rings the control of the line being read, names it by its number and dims the rest', async () => {
    await open('media');
    hover(lines()[3]);
    const lit = document.querySelectorAll('.frame.on');
    expect(lit).toHaveLength(1);
    expect(document.querySelector('.veil').classList.contains('on')).toBe(true);
    expect(document.querySelector('.shot .name').textContent).toBe(PAGES.media.marks[3].title);
    expect(pins().map((pin) => pin.classList.contains('dim'))).toEqual(PAGES.media.marks.map((_, i) => i !== 3));
    hover(lines()[3], false);
    expect(frames().some((frame) => frame.classList.contains('on'))).toBe(false);
    expect(document.querySelector('.shot .name')).toBeNull();
  });

  it('lights the line from its number on the picture too', async () => {
    await open('media');
    hover(pins()[1]);
    expect(document.querySelectorAll('.legend li')[1].classList.contains('on')).toBe(true);
  });

  it('lists the subtleties under the picture, under a heading that says they are tips', async () => {
    await open('media');
    const tips = document.querySelector('section.tips');
    expect(tips.getAttribute('aria-label')).toBe('Tips');
    expect(tips.querySelector('.tips-head').textContent.trim()).toBe('Tips');
    expect([...tips.querySelectorAll('li strong')].map((t) => t.textContent)).toEqual(
      PAGES.media.tips.map((tip) => tip.title)
    );
  });

  it('opens the tool it explains, and closes', async () => {
    await open('media');
    uiState.tool = 'settings';
    press(document.querySelector('.go'));
    expect(uiState.tool).toBe('media');
    expect(onclose).toHaveBeenCalled();
  });
});

describe('a number that leads somewhere', () => {
  it('shows the screen its control opens, with the way back', async () => {
    await open('media');
    const leads = pins().filter((pin) => pin.classList.contains('leads'));
    expect(leads).toHaveLength(PAGES.media.marks.filter((mark) => mark.opens).length);
    const at = PAGES.media.marks.findIndex((mark) => mark.title === 'Open in…');
    press(pins()[at]);
    expect(document.querySelector('.trail').textContent).toContain('Open in…');
    expect(document.querySelector('.lead').textContent).toBe(PAGES.media.marks[at].opens.lead);
    expect(lines()).toHaveLength(1);
    press(document.querySelector('.trail button'));
    expect(document.querySelector('.trail')).toBeNull();
    expect(lines()).toHaveLength(PAGES.media.marks.length);
  });

  it('is offered from the line as well as from the number', async () => {
    await open('satellite');
    const offers = [...document.querySelectorAll('.legend .leads')];
    expect(offers.length).toBe(PAGES.satellite.marks.filter((mark) => mark.opens).length);
    press(offers[0]);
    expect(document.querySelector('.trail')).not.toBeNull();
  });

  it('forgets the trail when another tab is picked', async () => {
    await open('media');
    press(pins().find((pin) => pin.classList.contains('leads')));
    press([...document.querySelectorAll('.tabs .tab')].find((tab) => tab.textContent.trim() === 'Files'));
    expect(document.querySelector('.trail')).toBeNull();
    expect(current('.tabs .tab')).toBe('Files');
  });
});

describe('a journey', () => {
  const geolocate = JOURNEYS.find((journey) => journey.id === 'geolocate');
  const build = JOURNEYS.find((journey) => journey.id === 'create-an-analyzer');
  const step = (id, kind) => stepAs(geolocate.steps.find((one) => one.id === id), kind);

  it('fills the guide, its menu folded away until asked for', async () => {
    await open(`journey:${build.id}`);
    expect(document.querySelector('.guide.immersed')).not.toBeNull();
    press(document.querySelector('.menu-toggle'));
    expect(document.querySelector('.guide.immersed')).toBeNull();
    press(entry('Sources'));
    expect(document.querySelector('.guide.immersed')).toBeNull();
    expect(document.querySelector('.trail')).toBeNull();
  });

  it('draws its steps as a trail, and plays the one pressed over its screen', async () => {
    await open(`journey:${build.id}`);
    expect(nodes().map((one) => one.querySelector('.step-name').textContent.trim())).toEqual([...build.steps.map((one) => one.label), 'Result']);
    expect(current('.trail .point')).toMatch(new RegExp(`^1\\s*${build.steps[0].label}$`));
    press(node(build.steps[3].label));
    await settle();
    expect(said()).toBe(stepMarks(build.steps[3])[0].text);
  });

  it('walks a step’s actions one by one, then lands on the step they lead to', async () => {
    await open(`journey:${geolocate.id}`);
    press(node('Search the map'));
    await settle();
    expect(said()).toBe(step('satellite').does['sat.search']);
    press(document.querySelector('.bubble .go'));
    await settle();
    expect(said()).toBe(step('satellite').does['sat.answer']);
    press(document.querySelector('.bubble .go'));
    await settle();
    expect(said()).toBe(step('satellite').does['map.ground']);
    await pressOn();
    expect(current('.trail .point')).toBe('Does it match?');
    expect(document.querySelector('.landing.on').textContent).toContain(step('satellite').then);
  });

  it('forks on a question, each answer leading to its own step, and goes back the way it came', async () => {
    await open(`journey:${geolocate.id}`);
    press(node('Where?'));
    const cards = [...document.querySelectorAll('.fork .choice')];
    expect(cards.map((card) => card.querySelector('strong').textContent)).toEqual(['Not yet', 'I have an idea of the area']);
    press(cards[0]);
    await settle();
    expect(current('.trail .point')).toBe('Reverse search');
    expect(node('Reverse search').classList.contains('optional')).toBe(true);
    press([...document.querySelectorAll('.bubble .quiet')].find((b) => b.textContent.trim() === 'Back'));
    expect(current('.trail .point')).toBe('Where?');
  });

  it('opens every journey on its welcome, then starts where its start leads', async () => {
    for (const journey of JOURNEYS) {
      await open(`journey:${journey.id}`, {}, { welcome: true });
      expect(document.querySelector('.welcome h3').textContent).toBe(journey.title);
      expect(document.querySelector('.welcome .example').textContent).toMatch(/One example/);
      expect(document.querySelector('.trail .point[aria-current]')).toBeNull();
      document.querySelector('.welcome .starts .go').click();
      flushSync();
      await settle();
      expect(document.querySelector('.welcome')).toBeNull();
      expect(document.querySelector('.bubble, .fork')).not.toBeNull();
      unmount(live);
      live = null;
      document.body.innerHTML = '';
    }
  });

  it('lists the journeys last in its menu', async () => {
    await open('start');
    const heads = [...document.querySelectorAll('.menu .group')].map((one) => one.textContent.trim());
    expect(heads).toEqual(['Tools', 'Reference', 'Journeys']);
  });

  it('reads on for a video once its start is picked', async () => {
    await open(`journey:${geolocate.id}`);
    await settle();
    // the way being read is said on every step: a photo's until a video's is picked
    expect(document.querySelector('.bubble .branch').textContent.trim()).toBe('A photo');
    press(node('A video'));
    await settle();
    expect(document.querySelector('.bubble .branch').textContent.trim()).toBe('A video');
    // a video comes in and is watched: three actions, the last one only shown
    press(document.querySelector('.bubble .go'));
    await settle();
    press(document.querySelector('.bubble .go'));
    await settle();
    await pressOn();
    // the region is asked next, then a video is opened in Inspect from its own card in Media
    expect(current('.trail .point')).toBe('Where?');
    expect(document.querySelector('.fork .branch').textContent.trim()).toBe('A video');
    press([...document.querySelectorAll('.fork .choice')].find((card) => card.textContent.includes('I have an idea of the area')));
    await settle();
    expect(said()).toBe(step('mark', 'video').does['media.open-in-video']);
    press(document.querySelector('.bubble .show'));
    expect(showInApp).toHaveBeenCalledWith(expect.objectContaining({ tool: 'media', anchor: 'media.open-in-video' }));
    press(node('A photo'));
    await settle();
    // a photo comes in and is read: three actions, the last one only shown
    press(document.querySelector('.bubble .go'));
    await settle();
    press(document.querySelector('.bubble .go'));
    await settle();
    await pressOn();
    expect(current('.trail .point')).toBe('Where?');
  });

  it('ends on what it made, past its last step', async () => {
    await open(`journey:${build.id}`);
    press(node(build.steps.at(-1).label));
    await settle();
    // each of the last step's actions in turn, then on to what it made
    for (const _ of build.steps.at(-1).marks) await pressOn();
    expect(current('.trail .point')).toBe('Result');
    expect(document.querySelector('.result .said').textContent).toBe(build.result.text);
    // the journey says from its title that it is one example
    expect(document.querySelector('h2 .caveat-mark').getAttribute('title')).toMatch(/One example/);
    expect(document.querySelector('.bubble')).toBeNull();
  });

  it('shows the control being read in the app: the guide closes on its tool, the control ringed', async () => {
    await open(`journey:${geolocate.id}`);
    press(node('Capture'));
    await settle();
    press(document.querySelector('.bubble .show'));
    expect(onclose).toHaveBeenCalled();
    expect(showInApp).toHaveBeenCalledWith(expect.objectContaining({ tool: 'satellite', anchor: 'sat.capture' }));
  });

  it('opens the case panel on the To-do for the step that happens there', async () => {
    await open(`journey:${geolocate.id}`);
    press(node('Geolocate'));
    await settle();
    press(document.querySelector('.bubble .show'));
    expect(showInApp).toHaveBeenCalledWith(expect.objectContaining({ anchor: 'toast.action', sidebar: 'todo' }));
  });

  describe('over the open case', () => {
    const scene = {
      kind: 'photo',
      scene: 'bridge_channel',
      done: ['photo', 'where', 'mark', 'geolocate', 'satellite', 'sure', 'spot'],
      here: 'how',
      next: ['capture', 'elsewhere'],
      facts: [
        { text: '2 leads', ok: true },
        { text: 'no capture yet', ok: false },
      ],
    };

    beforeEach(() => {
      gatherFacts.mockClear();
      gatherFacts.mockResolvedValue({});
      hereOn.mockReturnValue(nowhere());
      openPractice.mockClear();
    });

    it('pins where the practice case stands, and opens on that step', async () => {
      caseState.current = { id: 'c1', name: 'Practice: Port of Los Angeles' };
      hereOn.mockReturnValue(scene);
      await open(`journey:${geolocate.id}`);
      await vi.waitFor(() => expect(document.querySelector('.point.here')).not.toBeNull());
      flushSync();
      expect(gatherFacts).toHaveBeenCalledWith('c1');
      expect(document.querySelector('.point.here .step-name').textContent.trim()).toBe('Capture where?');
      expect(nodes().filter((one) => one.classList.contains('done'))).toHaveLength(7);
      expect(current('.trail .point')).toBe('Capture where?');
      const chip = document.querySelector('.case-chip').textContent;
      expect(chip).toContain('Practice: Port of Los Angeles');
      expect(chip).toContain('bridge_channel');
      expect(chip).toContain('2 leads');
      expect(document.querySelector('.fork .choice.next')).not.toBeNull();
    });

    it('reads no other case: the trail follows the reader alone', async () => {
      caseState.current = { id: 'c2', name: 'Harbour' };
      await open(`journey:${geolocate.id}`);
      await Promise.resolve();
      expect(gatherFacts).not.toHaveBeenCalled();
      expect(document.querySelector('.point.here, .pin, .case-chip')).toBeNull();
      press(node('Search the map'));
      await settle();
      press(document.querySelector('.bubble .go'));
      await settle();
      press(document.querySelector('.bubble .go'));
      await settle();
      await pressOn();
      expect(node('Search the map').classList.contains('walked')).toBe(true);
      expect(node('Does it match?').classList.contains('current')).toBe(true);
    });

    it('only shows the way with no case open, and offers the practice case', async () => {
      await open(`journey:${geolocate.id}`);
      expect(gatherFacts).not.toHaveBeenCalled();
      expect(document.querySelector('.point.here')).toBeNull();
      press(document.querySelector('.head .practice'));
      expect(onclose).toHaveBeenCalled();
      expect(openPractice).toHaveBeenCalledTimes(1);
    });

    it('says how close the practice case came, on its result', async () => {
      caseState.current = { id: 'p1', name: 'Practice: Port of Los Angeles' };
      gatherFacts.mockResolvedValue({ point: { lat: 33.74, lon: -118.278 } });
      hereOn.mockReturnValue({ ...nowhere(), kind: 'photo', scene: 'bridge_channel', done: ['photo'], here: 'post' });
      await open(`journey:${geolocate.id}`);
      await vi.waitFor(() => expect(document.querySelector('.point.here')).not.toBeNull());
      flushSync();
      press(node('Your answer'));
      expect(document.querySelector('.verdict').textContent).toContain('Found');
      expect(document.querySelector('.verdict').textContent).toContain('120 m');
      expect(document.querySelector('.head .practice')).toBeNull();
    });
  });

  describe('Search with Find, past its last step', () => {
    const search = JOURNEYS.find((journey) => journey.id === 'search-with-find');
    const tryIt = () => [...document.querySelectorAll('.result button')].find((b) => b.textContent.includes('Try this search'));

    async function onResult(props) {
      await open(`journey:${search.id}`, props);
      press(node('Result'));
    }

    it('shows the place confirmed, and offers the search itself', async () => {
      await onResult();
      expect(document.querySelector('.shot')).not.toBeNull();
      openFindExample.mockClear();
      press(tryIt());
      expect(onclose).toHaveBeenCalled();
      expect(openFindExample).toHaveBeenCalledTimes(1);
    });

    it('asks the app when the guide stands in a tab of its own', async () => {
      const app = { closed: false, location: { origin: location.origin }, postMessage: vi.fn(), focus: vi.fn() };
      vi.spyOn(window, 'opener', 'get').mockReturnValue(app);
      openFindExample.mockClear();
      await onResult({ detached: true });
      press(tryIt());
      expect(app.postMessage).toHaveBeenCalledWith({ 'azimut:guide': { example: true } }, location.origin);
      expect(openFindExample).not.toHaveBeenCalled();
    });

    it('leaves it off a step and off another journey', async () => {
      await open(`journey:${search.id}`);
      expect(tryIt()).toBeUndefined();
      live && unmount(live);
      document.body.innerHTML = '';
      const other = JOURNEYS.find((journey) => journey.result && !journey.result.example);
      await open(`journey:${other.id}`);
      press(node('Result'));
      expect(tryIt()).toBeUndefined();
    });
  });

  it('is reached from a tool at the step it is used at', async () => {
    await open('satellite');
    const link = [...document.querySelectorAll('.journey')].find((b) => b.textContent.includes('Geolocate a photo'));
    press(link);
    expect(current('.menu .entry')).toBe('Geolocate a photo or a video');
    // the map search is the first thing done on the map
    expect(current('.trail .point')).toBe('Search the map');
  });
});

describe('the extension, in tabs', () => {
  it('opens on setting it up, with the tabs that follow it', async () => {
    await open('extension');
    expect(current('.menu .entry')).toBe('Capture extension');
    expect([...document.querySelectorAll('.tabs .tab')].map((tab) => tab.textContent.trim())).toEqual(
      EXTENSION_TABS.map((tab) => tab.label)
    );
    expect(current('.tabs .tab')).toBe('Install');
    expect(lines()).toHaveLength(PAGES.extension.marks.length);
    // a tab of the page explains it rather than opening a tool
    expect(document.querySelector('.go')).toBeNull();
  });

  it('shows the popup and the tools on their own pictures', async () => {
    await open('extension');
    const tab = (label) => [...document.querySelectorAll('.tabs .tab')].find((b) => b.textContent.trim() === label);
    press(tab('Capture'));
    expect(document.querySelector('.lead').textContent).toBe(PAGES['extension-capture'].lead);
    expect(lines()).toHaveLength(PAGES['extension-capture'].marks.length);
    press(tab('Tools on the map'));
    expect(lines()).toHaveLength(PAGES['extension-tools'].marks.length);
  });

  it('says where it works, Street View included, in a table', async () => {
    await open('extension');
    press([...document.querySelectorAll('.tabs .tab')].find((b) => b.textContent.trim() === 'Where it works'));
    const rows = [...document.querySelectorAll('.sites tbody tr')];
    expect(rows).toHaveLength(EXTENSION_SITES.rows.length);
    expect(rows.map((row) => row.querySelector('th').firstChild.textContent.trim())).toContain('Street View');
    expect(document.querySelectorAll('.sites .names span')).toHaveLength(EXTENSION_SITES.sites.length);
    const street = rows.find((row) => row.textContent.includes('Street View'));
    expect(street.querySelectorAll('.yes')).toHaveLength(1);
    expect(street.textContent).toContain('not in Street View');
    expect(document.querySelectorAll('.sites .elsewhere .card-block')).toHaveLength(EXTENSION_SITES.elsewhere.length);
  });
});

describe('the reference', () => {
  it('lists every key by where it is pressed', async () => {
    await open('start');
    press(entry('Shortcuts'));
    expect([...document.querySelectorAll('.keys h3')].map((h) => h.textContent)).toEqual(KEYMAP.map((g) => g.where));
    expect(document.querySelectorAll('.keys kbd').length).toBe(KEYMAP.flatMap((g) => g.keys).length);
  });

  it('answers every symptom', async () => {
    await open('start');
    press(entry('When something does not work'));
    expect(document.querySelectorAll('.fixes .card-block')).toHaveLength(FIXES.length);
  });

  it('opens Settings on its own page from the gear, a tab per section', async () => {
    await open('settings');
    expect(current('.menu .entry')).toBe('Settings');
    expect(current('.tabs .tab')).toBe('General');
    expect([...document.querySelectorAll('.tabs .tab')].map((tab) => tab.textContent.trim())).toEqual(
      SETTINGS_TABS.map((tab) => tab.label)
    );
    press([...document.querySelectorAll('.tabs .tab')].find((tab) => tab.textContent.trim() === 'System'));
    expect(lines()).toHaveLength(PAGES['settings-system'].marks.length);
    // a section of Settings explains it rather than opening a tool
    expect(document.querySelector('.go')).toBeNull();
  });

  it('ends what to do when something does not work on reporting it, in Settings, System', async () => {
    await open('start');
    press(entry('When something does not work'));
    uiState.tool = 'media';
    press(document.querySelector('.report button'));
    expect(uiState.tool).toBe('settings');
    expect(uiState.settingsTab).toBe('system');
    expect(onclose).toHaveBeenCalled();
  });
});

describe('the tour', () => {
  it('is taken again from the start page, over the app', async () => {
    uiState.onboarding = null;
    await open('start');
    press([...document.querySelectorAll('.side button')].find((b) => b.textContent.includes('Take the tour')));
    expect(onclose).toHaveBeenCalled();
    expect(uiState.onboarding).toEqual({ kind: 'tour', step: 0 });
    uiState.onboarding = null;
  });

  it('is offered on the start page only', async () => {
    await open('media');
    expect([...document.querySelectorAll('.side button')].some((b) => b.textContent.includes('Take the tour'))).toBe(false);
  });
});

describe('the way out', () => {
  it('closes from its own header', async () => {
    await open('media');
    press(document.querySelector('.head button[aria-label="Close"]'));
    expect(onclose).toHaveBeenCalled();
  });

  it('moves to a tab of its own on the step being read, and closes here', async () => {
    const journey = JOURNEYS[0];
    const tab = vi.spyOn(window, 'open').mockReturnValue({});
    await open(`journey:${journey.id}`);
    press(nodes()[1]);
    press(document.querySelector('.head button[aria-label="Open in a new tab"]'));
    const [url, name] = tab.mock.calls[0];
    expect(url).toContain(`#guide?page=journey%3A${journey.id}&step=1`);
    expect(name).toBe('azimut-guide');
    expect(onclose).toHaveBeenCalled();
  });

  it('stays open when the browser refuses the tab', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    await open('media');
    press(document.querySelector('.head button[aria-label="Open in a new tab"]'));
    expect(onclose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});

describe('in a tab of its own', () => {
  const journey = JOURNEYS[0];
  const detached = (place) => open(undefined, { detached: true, place });
  let opener;
  function withOpener() {
    opener = { closed: false, location: { origin: location.origin }, postMessage: vi.fn(), focus: vi.fn() };
    vi.spyOn(window, 'opener', 'get').mockReturnValue(opener);
  }

  it('fills the tab on its place, with no way out but closing the tab', async () => {
    await detached({ item: `journey:${journey.id}`, tool: null, step: 1 });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('main.detached .guide')).not.toBeNull();
    expect(current('.trail .point')).toBe(journey.steps[1].label);
    expect(document.querySelector('.head button[aria-label="Close"]')).toBeNull();
    expect(document.querySelector('.head button[aria-label="Open in a new tab"]')).toBeNull();
  });

  it('keeps where the reader stands in its address, for a reload', async () => {
    await detached({ item: `journey:${journey.id}`, tool: null, step: 0 });
    press(nodes()[1]);
    expect(location.hash).toBe(`#guide?page=journey%3A${journey.id}&step=1`);
    press(entry('Sources'));
    expect(location.hash).toMatch(/^#guide\?page=[^&]+&tab=/);
  });

  it('opens a tool in the tab it was detached from, and stays', async () => {
    withOpener();
    await detached({ ...landingFor('media'), step: 0 });
    uiState.tool = 'settings';
    press(document.querySelector('.go'));
    expect(opener.postMessage).toHaveBeenCalledWith({ 'azimut:guide': { open: 'media' } }, location.origin);
    expect(uiState.tool).toBe('settings');
    expect(document.querySelector('main.detached')).not.toBeNull();
  });

  it('sends a report to that tab too', async () => {
    withOpener();
    await detached({ item: 'start', tool: null, step: 0 });
    press(entry('When something does not work'));
    press(document.querySelector('.report button'));
    expect(opener.postMessage).toHaveBeenCalledWith({ 'azimut:guide': { report: true } }, location.origin);
  });
});
