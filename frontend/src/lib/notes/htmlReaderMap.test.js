import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';

/**
 * A map in an exported HTML report, read (`notes_html_assets/reader.map.js`, spliced into `reader.js`):
 * the figure as the engine writes it (`mapFigure.fixture.html`, held to the engine by
 * `tests/test_notes_maps.py`), in a fresh window with motion turned down so every move lands
 * at once, and the stage given the size a browser would lay it out at.
 */

const ASSETS = new URL('../../../../src/azimut/engine/notes_html_assets/', import.meta.url);
// as the export writes a page holding a map: the map's script spliced into the reader's, its style after the reader's
const READER = readFileSync(new URL('reader.js', ASSETS), 'utf8').replace('  /* az:map */\n', readFileSync(new URL('reader.map.js', ASSETS), 'utf8'));
const CSS = readFileSync(new URL('reader.css', ASSETS), 'utf8') + readFileSync(new URL('reader.map.css', ASSETS), 'utf8');
const FIGURE = readFileSync(new URL('./mapFigure.fixture.html', import.meta.url), 'utf8');

let window;
afterEach(async () => {
  await window?.happyDOM.close();
  window = null;
});

async function report(body = FIGURE, { web = '' } = {}) {
  window = new Window({
    url: 'file:///report.html', width: 1440, height: 900,
    settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true },
  });
  window.matchMedia = (query) => ({ matches: query.includes('reduce') || query.includes('min-width'), addEventListener() {}, removeEventListener() {} });
  // the stage as a browser lays it out: as wide as the column, as tall as its ground is
  for (const [name, value] of [['clientWidth', 800], ['clientHeight', 574]]) {
    Object.defineProperty(window.HTMLElement.prototype, name, {
      configurable: true, get() { return this.classList?.contains('az-map-stage') ? value : 0; },
    });
  }
  window.document.write(`<!doctype html><html lang="en" data-look="report"${web ? ` data-web="${web}"` : ''}><head><style>${CSS}</style></head>`
    + `<body><main class="az-body">${body}<figure class="az-figure" data-kind="proof" id="fig-1"></figure></main><script>${READER}</script></body></html>`);
  await window.happyDOM.waitUntilComplete();
  return window.document;
}

const pointer = (node, type) => node.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: 20, clientY: 20 }));
const tap = (node) => { pointer(node, 'pointerdown'); pointer(node, 'pointerup'); };
const key = (node, name) => node.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
const settle = async () => {
  for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const width = (doc) => Number(doc.querySelector('svg.az-map-svg').getAttribute('viewBox').split(' ')[2]);
const shape = (doc, id) => doc.querySelector(`.az-f[data-id="${id}"]`);

describe('a map in the report', () => {
  it('is built over its drawing: the tools, a timeline of its days on the last one, and its steps', async () => {
    const doc = await report();
    expect([...doc.querySelectorAll('.az-map-tools button')].map((button) => button.getAttribute('aria-label'))).toEqual(['Zoom in', 'Zoom out', 'The whole map', 'Full screen']);
    const slider = doc.querySelector('.az-map-time input[type="range"]');
    expect([slider.max, slider.value]).toEqual(['4', '4']);
    expect(doc.querySelector('.az-map-now-day').textContent).toBe('16 Nov 2026');
    expect(doc.querySelector('.az-map-now-count').textContent).toBe('Day 5 of 5');
    // a step's chip is short: its own label, or its day; the whole sentence is its title
    const chips = [...doc.querySelectorAll('.az-map-steps button')];
    expect(chips.map((chip) => chip.textContent)).toEqual(['120 Oct', '2The road']);
    expect(chips[0].title).toBe('Seen on the heights.');
    expect(shape(doc, 'l0f0').getAttribute('tabindex')).toBe('0');
    expect(shape(doc, 'l0f0').getAttribute('role')).toBe('button');
  });

  it('zooms in and out with its tools and the keyboard, no deeper than its ground stays sharp, and comes back whole', async () => {
    const doc = await report();
    const whole = width(doc);
    doc.querySelector('[data-act="in"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(width(doc)).toBeCloseTo(whole / 2, 1);
    // the fixture's ground is small: three times the whole map is as deep as it goes
    key(doc.querySelector('.az-map-stage'), '+');
    expect(width(doc)).toBeCloseTo(whole / 3, 1);
    expect(doc.querySelector('[data-act="in"]').disabled).toBe(true);
    // a mark keeps its size on the screen: its scale follows the zoom
    const scale = Number(/scale\(([\d.]+)\)/.exec(shape(doc, 'p0').getAttribute('transform'))[1]);
    key(doc.querySelector('.az-map-stage'), '0');
    expect(width(doc)).toBeCloseTo(whole, 1);
    expect(Number(/scale\(([\d.]+)\)/.exec(shape(doc, 'p0').getAttribute('transform'))[1])).toBeCloseTo(scale * 3, 3);
  });

  it('opens a mark’s card on a press or Enter, and Escape closes it and gives the focus back', async () => {
    const doc = await report();
    tap(shape(doc, 'l1f0').querySelector('use'));
    const card = doc.querySelector('.az-map-card');
    expect(card.hidden).toBe(false);
    expect(card.querySelector('.az-map-card-title').textContent).toBe('#1');
    expect(card.querySelector('.az-map-card-day').textContent).toBe('15 November 2026');
    expect([...card.querySelectorAll('.az-map-card-links a')].map((link) => [link.textContent, link.getAttribute('href'), link.target]))
      .toEqual([['Source: x.com ↗', 'https://x.com/desk/status/1', '_blank']]);
    expect(shape(doc, 'l1f0').classList.contains('az-picked')).toBe(true);
    key(card, 'Escape');
    expect(card.hidden).toBe(true);
    expect(doc.activeElement).toBe(shape(doc, 'l1f0'));
    key(shape(doc, 'l1f1'), 'Enter');
    expect(card.hidden).toBe(false);
    expect(card.querySelector('.az-map-card-title').textContent).toBe('#2');
  });

  it('walks its days on the slider: a mark shows between its days, a moved line leaves a trace', async () => {
    const doc = await report();
    const slider = doc.querySelector('.az-map-time input[type="range"]');
    expect(shape(doc, 'l0f0s1').classList.contains('az-off')).toBe(true);
    expect(shape(doc, 'l0f0s1').classList.contains('az-past')).toBe(true);
    slider.value = '1';
    slider.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(doc.querySelector('.az-map-now-day').textContent).toBe('14 Oct 2026');
    expect(slider.getAttribute('aria-valuetext')).toBe('14 October 2026');
    expect(shape(doc, 'l0f0s1').classList.contains('az-off')).toBe(false);
    expect(shape(doc, 'l0f0').classList.contains('az-past')).toBe(true);
    expect(shape(doc, 'l1f0').classList.contains('az-off')).toBe(true);
    expect(doc.querySelector('.az-label[data-for="l1f0"]').classList.contains('az-off')).toBe(true);
  });

  it('spreads marks that would cover one another, a leader to each true spot', async () => {
    const doc = await report();
    const leaders = [...doc.querySelectorAll('.az-leaders .az-leader')].map((leader) => leader.dataset.for).sort();
    expect(leaders).toEqual(['l1f0', 'l1f1']);
    const at = (id) => /translate\(([\d.]+) ([\d.]+)\)/.exec(shape(doc, id).getAttribute('transform')).slice(1).map(Number);
    expect(Math.hypot(at('l1f0')[0] - at('l1f1')[0], at('l1f0')[1] - at('l1f1')[1])).toBeGreaterThan(20);
    expect([shape(doc, 'l1f0').dataset.x, shape(doc, 'l1f0').dataset.y]).not.toEqual(at('l1f0').map(String));
  });

  it('flies to a step, on its day, and a step about a proof opens the proof’s card', async () => {
    const doc = await report();
    const whole = width(doc);
    doc.querySelector('.az-map-steps button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(doc.querySelector('.az-map-now-day').textContent).toBe('20 Oct 2026');
    expect(width(doc)).toBeLessThan(whole);
    expect(doc.querySelector('.az-map-steps button').getAttribute('aria-current')).toBe('step');
    // what the step says shows under the row, not only on hover
    expect(doc.querySelector('.az-map-step-said').textContent).toBe('Seen on the heights.');
    doc.querySelectorAll('.az-map-steps button')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(doc.querySelector('.az-map-step-said').textContent).toBe('');
    doc.querySelector('.az-map-steps button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const card = doc.querySelector('.az-map-card');
    expect(card.querySelector('.az-map-card-title').textContent).toBe('Heights');
    expect(card.querySelector('.az-map-card-proof').getAttribute('href')).toBe('#fig-1');
  });

  it('is moved by a story’s cards: a step’s card flies it, the card of words shows it whole', async () => {
    const doc = await report();
    const map = doc.querySelector('figure.az-map').azMap;
    const whole = width(doc);
    map.story('1');
    expect(width(doc)).toBeLessThan(whole);
    expect(doc.querySelector('.az-map-card').hidden).toBe(true);
    map.story('');
    expect(width(doc)).toBeCloseTo(whole, 1);
    expect(doc.querySelector('.az-map-now-day').textContent).toBe('16 Nov 2026');
  });

  it('reads whole without its data, and with none of it leaves the figure as written', async () => {
    const doc = await report(FIGURE.replace(/<script type="application\/json"[^]*?<\/script>/, ''));
    expect(doc.querySelector('.az-map-tools')).toBeNull();
    expect(doc.querySelector('.az-map-day').textContent).toContain('16 November 2026');
  });
});

/** The fixture's figure with its data changed by `change`, as a block's settings change it. */
function withData(change) {
  return FIGURE.replace(/(<script type="application\/json" class="az-map-data">)(.*?)(<\/script>)/s, (_, open, json, close) => {
    const data = JSON.parse(json);
    change(data);
    return `${open}${JSON.stringify(data)}${close}`;
  });
}

describe('a map on the whole screen', () => {
  /** The browser's own full screen for an element, as a browser has it: a request, who holds it, and its event. */
  function fakeScreen(doc) {
    const screen = { holder: null, asked: 0, exits: 0 };
    const give = (next) => {
      screen.holder = next;
      doc.dispatchEvent(new window.Event('fullscreenchange'));
    };
    Object.defineProperty(doc, 'fullscreenElement', { configurable: true, get: () => screen.holder });
    window.HTMLElement.prototype.requestFullscreen = async function requestFullscreen() { screen.asked += 1; give(this); };
    doc.exitFullscreen = async () => { screen.exits += 1; give(null); };
    screen.leave = () => give(null);
    return screen;
  }
  /** The stage laid out at `w` by `h`, as the screen lays it once the figure holds it. */
  function laidAt(doc, w, h) {
    const stage = doc.querySelector('.az-map-stage');
    Object.defineProperty(stage, 'clientWidth', { configurable: true, get: () => w });
    Object.defineProperty(stage, 'clientHeight', { configurable: true, get: () => h });
  }
  const press = (node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const screenButton = (doc) => doc.querySelector('[data-act="full"]');
  const box = (doc) => doc.querySelector('svg.az-map-svg').getAttribute('viewBox').split(' ').map(Number);

  it('takes the whole screen on its button, its timeline, steps and legend with it, and gives it back on the button, Esc or the browser’s exit', async () => {
    const doc = await report();
    const screen = fakeScreen(doc);
    const figure = doc.querySelector('figure.az-map');
    const button = screenButton(doc);
    expect([button.getAttribute('aria-label'), button.title]).toEqual(['Full screen', 'The map on the whole screen']);
    expect(button.closest('.az-map-screen').parentNode).toBe(doc.querySelector('.az-map-tools'));
    press(button);
    await settle();
    // the figure itself, so what goes with the map comes along
    expect(screen.holder).toBe(figure);
    expect(figure.classList.contains('az-full')).toBe(true);
    for (const part of ['.az-map-time', '.az-map-steps-row', '.az-map-legend']) expect(figure.querySelector(part)).not.toBeNull();
    expect([button.getAttribute('aria-label'), button.title]).toEqual(['Exit full screen', 'Back to the page (Esc)']);
    expect(button.querySelector('path').getAttribute('d')).toMatch(/^M8 3v3/);
    press(button);
    await settle();
    expect([screen.exits, figure.classList.contains('az-full'), button.getAttribute('aria-label')]).toEqual([1, false, 'Full screen']);
    // Esc, before the card or anything else hears it
    press(button);
    await settle();
    key(figure.querySelector('.az-f[data-id="p0"]'), 'Escape');
    await settle();
    expect([screen.exits, figure.classList.contains('az-full')]).toEqual([2, false]);
    // the browser's own exit
    press(button);
    await settle();
    screen.leave();
    expect(figure.classList.contains('az-full')).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Full screen');
  });

  it('covers the window where the browser has no full screen for it, the page held still and found where it was', async () => {
    const doc = await report();
    delete window.HTMLElement.prototype.requestFullscreen;
    const figure = doc.querySelector('figure.az-map');
    const main = doc.querySelector('main');
    window.scrollTo = vi.fn();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1234 });
    press(screenButton(doc));
    await settle();
    expect([...figure.classList]).toEqual(expect.arrayContaining(['az-full', 'az-overlay']));
    // the page under it does not scroll, and nothing round the map paints over it
    expect(doc.documentElement.classList.contains('az-locked')).toBe(true);
    expect(main.style.zIndex).toBe('2147483000');
    expect(screenButton(doc).getAttribute('aria-label')).toBe('Exit full screen');
    key(doc.body, 'Escape');
    expect(figure.classList.contains('az-full') || figure.classList.contains('az-overlay')).toBe(false);
    expect(doc.documentElement.classList.contains('az-locked')).toBe(false);
    expect(main.style.zIndex).toBe('');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 1234);
    // a frame that may not have the screen refuses it: the figure covers the window as well
    window.HTMLElement.prototype.requestFullscreen = async () => { throw new TypeError('Permissions check failed'); };
    press(screenButton(doc));
    await settle();
    expect(figure.classList.contains('az-overlay')).toBe(true);
    press(screenButton(doc));
    expect(figure.classList.contains('az-overlay')).toBe(false);
  });

  it('lays the drawing again on the screen’s size: the same middle, larger, the map whole in the middle of a stage of another shape', async () => {
    const doc = await report();
    fakeScreen(doc);
    doc.querySelector('[data-act="in"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const [x, y, w, h] = box(doc);
    const middle = [x + w / 2, y + h / 2];
    // the screen is wider than the map: the same part shows, more of it on the sides, nothing squeezed
    laidAt(doc, 1600, 574.15);
    press(screenButton(doc));
    await settle();
    const [x2, y2, w2, h2] = box(doc);
    expect(x2 + w2 / 2).toBeCloseTo(middle[0], 0);
    expect(y2 + h2 / 2).toBeCloseTo(middle[1], 0);
    expect(h2).toBeCloseTo(h, 0);
    expect(w2 / h2).toBeCloseTo(1600 / 574.15, 3);
    // the whole map stands in the middle, clipped to what the page frames
    doc.querySelector('[data-act="fit"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const world = doc.querySelector('.az-map-world');
    expect(Number.parseFloat(world.style.width)).toBe(800);
    expect(world.style.transform).toBe('translate(400.00px, 0.00px) scale(1.00000)');
    // how far each edge of the map is from the stage's: what the drawing clips to, where its tools go
    const frame = doc.querySelector('.az-map-frame');
    expect(['t', 'r', 'b', 'l'].map((edge) => frame.style.getPropertyValue(`--az-${edge}`))).toEqual(['0.0px', '400.0px', '0.0px', '400.0px']);
    // given back, it is the map's shape again
    laidAt(doc, 800, 574);
    press(screenButton(doc));
    await settle();
    expect(world.style.width).toBe('');
    expect(['t', 'r', 'b', 'l'].map((edge) => frame.style.getPropertyValue(`--az-${edge}`))).toEqual(['', '', '', '']);
    expect(box(doc)).toEqual([0, 0, 1600, 1148.3]);
  });

  it('zooms with the wheel alone on the whole screen, where there is no page to scroll', async () => {
    const doc = await report();
    fakeScreen(doc);
    const stage = doc.querySelector('.az-map-stage');
    const whole = box(doc)[2];
    stage.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 }));
    expect(box(doc)[2]).toBe(whole);
    expect(doc.querySelector('.az-map-hint').classList.contains('az-on')).toBe(true);
    press(screenButton(doc));
    await settle();
    stage.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 }));
    expect(box(doc)[2] / (whole / 1.25)).toBeCloseTo(1, 3);
  });

  it('names a day on its timeline only where the name has room, the one at an end set inside the track', async () => {
    const doc = await report();
    const ticks = doc.querySelector('.az-map-ticks');
    const said = () => [...ticks.querySelectorAll('li[data-month]')].map((tick) => [tick.dataset.month, tick.className]);
    // laid out wide, every day is named
    Object.defineProperty(ticks, 'clientWidth', { configurable: true, get: () => 700 });
    window.dispatchEvent(new window.Event('resize'));
    expect(said()).toEqual([['6 Oct', 'az-start'], ['14 Oct', ''], ['20 Oct', ''], ['15 Nov', ''], ['16 Nov', 'az-end']]);
    // narrow, as beside a map on the whole screen: the names that would run into one another are left out
    Object.defineProperty(ticks, 'clientWidth', { configurable: true, get: () => 200 });
    window.dispatchEvent(new window.Event('resize'));
    expect(said().filter(([, name]) => !name.includes('az-unnamed')).map(([day]) => day)).toEqual(['6 Oct', '20 Oct', '15 Nov']);
  });

  it('gives the screen back before it is printed', async () => {
    const doc = await report();
    const screen = fakeScreen(doc);
    press(screenButton(doc));
    await settle();
    window.dispatchEvent(new window.Event('beforeprint'));
    await settle();
    expect([screen.exits, doc.querySelector('figure.az-map').classList.contains('az-full')]).toEqual([1, false]);
  });
});

describe('a map shown otherwise, as its block says', () => {
  it('has no timeline when it says so, and still shows its day', async () => {
    const doc = await report(withData((data) => { data.timeline = false; }));
    expect(doc.querySelector('.az-map-time')).toBeNull();
    expect(shape(doc, 'l1f1').classList.contains('az-off')).toBe(false);
  });

  it('opens on the part its block opens it on, held whole, and its whole map is a press away', async () => {
    const whole = width(await report());
    const doc = await report(withData((data) => { data.opens = [43.45, 12.7, 43.55, 12.78]; }));
    // held whole on the stage's shape: as close as its height lets it be, more of its sides shown
    expect(width(doc)).toBeLessThan(whole * 0.6);
    const [west, south, east, north] = doc.querySelector('figure.az-map').azMap.seen();
    expect(west).toBeLessThanOrEqual(43.45 + 1e-6);
    expect(east).toBeGreaterThanOrEqual(43.55 - 1e-6);
    expect(south).toBeCloseTo(12.7, 2);
    expect(north).toBeCloseTo(12.78, 2);
    doc.querySelector('[data-act="fit"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(width(doc)).toBeCloseTo(whole, 1);
  });

  it('plays its days at its own pace, and takes its scale away when it says so', async () => {
    const doc = await report(withData((data) => { data.speed = 2200; data.scale = 'off'; }));
    expect(doc.querySelector('.az-map-scale')).toBeNull();
    const intervals = [];
    const real = window.setInterval;
    window.setInterval = (run, ms) => { intervals.push(ms); return real.call(window, run, ms); };
    doc.querySelector('.az-map-play').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(intervals).toEqual([2200]);
  });

  it('counts a crowd past its own number, and never with crowds off', async () => {
    // five marks on one spot: spread under the default dozen, a count to press past two
    const crowded = (data) => {
      for (let n = 0; n < 4; n += 1) data.features.push({ ...data.features[2], id: `c${n}`, of: `c${n}`, from: null, coords: [43.495, 12.745] });
    };
    const markup = (change) => withData(change).replace('</g><g class="az-labels"',
      `${[0, 1, 2, 3].map((n) => `<g class="az-f az-point" data-id="c${n}" data-of="c${n}" data-x="760.4" data-y="614.8" data-s="1" data-colour="#e53935"></g>`).join('')}</g><g class="az-labels"`);
    const spread = await report(markup(crowded));
    expect(spread.querySelectorAll('.az-bubble')).toHaveLength(0);
    await window.happyDOM.close();
    const counted = await report(markup((data) => { crowded(data); data.crowds = 2; }));
    expect(counted.querySelectorAll('.az-bubble')).toHaveLength(1);
    expect(counted.querySelector('.az-bubble-count').textContent).toBe('6');
    await window.happyDOM.close();
    const never = await report(markup((data) => { crowded(data); data.crowds = 0; }));
    expect(never.querySelectorAll('.az-bubble')).toHaveLength(0);
  });

  it('keeps a line’s or an area’s name on its middle at every zoom, at the size of the others', async () => {
    const named = FIGURE.replace('<g class="az-labels" aria-hidden="true">',
      '<g class="az-labels" aria-hidden="true"><text class="az-label" data-for="l0f0s1" data-x="400.0" data-y="300.0" x="400.0" y="306.2" font-size="18.18" text-anchor="middle">Forward line</text>');
    const doc = await report(named);
    const label = doc.querySelector('.az-label[data-x]');
    const size = Number(label.getAttribute('font-size'));
    doc.querySelector('[data-act="in"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(label.getAttribute('x')).toBe('400.0');
    expect(Number(label.getAttribute('font-size'))).toBeCloseTo(size / 2, 1);
  });
});

describe('a page with no map', () => {
  it('keeps the reader it had: no map code, and the place the map code goes', () => {
    const plain = readFileSync(new URL('reader.js', ASSETS), 'utf8');
    expect(plain).toContain('  /* az:map */\n');
    expect(plain).not.toMatch(/function mapOf|az-map-stage/);
    expect(READER).toMatch(/function mapOf/);
    expect(READER).not.toMatch(/https?:\/\/|fetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
  });
});
