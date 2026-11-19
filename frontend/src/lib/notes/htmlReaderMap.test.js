import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
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
const width = (doc) => Number(doc.querySelector('svg.az-map-svg').getAttribute('viewBox').split(' ')[2]);
const shape = (doc, id) => doc.querySelector(`.az-f[data-id="${id}"]`);

describe('a map in the report', () => {
  it('is built over its drawing: the tools, a timeline of its days on the last one, and its steps', async () => {
    const doc = await report();
    expect([...doc.querySelectorAll('.az-map-tools button')].map((button) => button.getAttribute('aria-label'))).toEqual(['Zoom in', 'Zoom out', 'The whole map']);
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

describe('a map shown otherwise, as its block says', () => {
  it('has no timeline when it says so, and still shows its day', async () => {
    const doc = await report(withData((data) => { data.timeline = false; }));
    expect(doc.querySelector('.az-map-time')).toBeNull();
    expect(shape(doc, 'l1f1').classList.contains('az-off')).toBe(false);
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
