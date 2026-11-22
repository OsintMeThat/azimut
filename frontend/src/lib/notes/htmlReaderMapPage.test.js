import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { geojson, layers } from '../../../../src/azimut/engine/notes_html_assets/reader.live.js';

/**
 * A map page, read (`notes_html_assets/reader.mappage.js`, spliced after the map's part): the page
 * the engine writes for a web map, its title over the map of `mapFigure.fixture.html` (its legend
 * keyed as a map page's is), the note's other words after it. Its panel of search, layers and words,
 * the address that keeps where it looks, the sheet on a phone; the fuller card every map now gives;
 * the counter a web folder may carry (`reader.count.js`); and the live map's part of the same rules.
 */

const ASSETS = new URL('../../../../src/azimut/engine/notes_html_assets/', import.meta.url);
const asset = (name) => readFileSync(new URL(name, ASSETS), 'utf8');
const READER = asset('reader.js').replace('  /* az:map */\n', asset('reader.map.js') + asset('reader.mappage.js'));
const COUNTER = asset('reader.count.js');
const CSS = asset('reader.css') + asset('reader.map.css') + asset('reader.mappage.css');
const KEYS = { Line: ['line', 'Features'], Vehicles: ['point', 'Destroyed'], Proofs: ['point', 'Proofs'] };
const FIGURE = readFileSync(new URL('./mapFigure.fixture.html', import.meta.url), 'utf8')
  .replace(/<li data-layer="(\w+)" data-group="([^"]*)">/g, (_, layer, group) => `<li data-layer="${layer}" data-group="${group}" data-kind="${KEYS[layer][0]}" data-key="${KEYS[layer][1]}">`);
const PAGE = `<div class="az-mappage">
<header class="az-mappage-head" id="top"><div class="az-mappage-titles"><h1 class="az-title" dir="auto">Armour on the road</h1>
<p class="az-mappage-sub" dir="auto">The line and the armour, 15 and 16 November.</p></div>
<p class="az-mappage-by"><span class="az-mappage-site">Desk</span><span class="az-mappage-views" data-counter="desk" hidden></span></p></header>
<main class="az-mappage-main" id="main">FIGURE</main>
<section class="az-mappage-about" id="about" aria-label="About this map"><div class="az-body az-mappage-text"><p>Each marker is one vehicle.</p></div></section>
</div>`;

let window;
afterEach(async () => {
  await window?.happyDOM.close();
  window = null;
  vi.useRealTimers();
});

/** The fixture's figure with one feature's card replaced. */
function withCard(id, card) {
  return FIGURE.replace(/(<script type="application\/json" class="az-map-data">)(.*?)(<\/script>)/s, (_, open, json, close) => {
    const data = JSON.parse(json);
    data.features.find((one) => one.id === id).card = card;
    return `${open}${JSON.stringify(data)}${close}`;
  });
}

async function mapPage({ hash = '', wide = true, url = 'https://desk.github.io/maps/road/', script = READER, fetch = null, figure = FIGURE, mark = '' } = {}) {
  window = new Window({
    url: `${url}${hash}`, width: wide ? 1440 : 390, height: 900,
    settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true },
  });
  window.matchMedia = (query) => ({
    matches: query.includes('reduce') || (wide && query.includes('min-width')),
    addEventListener() {}, removeEventListener() {},
  });
  for (const [name, value] of [['clientWidth', 800], ['clientHeight', 574]]) {
    Object.defineProperty(window.HTMLElement.prototype, name, {
      configurable: true, get() { return this.classList?.contains('az-map-stage') ? value : 0; },
    });
  }
  if (fetch) window.fetch = fetch;
  window.document.write(`<!doctype html><html lang="en" data-look="article" data-web="map"><head><style>${CSS}</style></head>`
    + `<body>${PAGE.replace('FIGURE', () => figure + mark)}<script>${script}</script></body></html>`);
  await window.happyDOM.waitUntilComplete();
  return window.document;
}

const press = (node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const type = (field, value) => { field.value = value; field.dispatchEvent(new window.Event('input', { bubbles: true })); };
const shape = (doc, id) => doc.querySelector(`.az-f[data-id="${id}"]`);
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a map page', () => {
  it("lays the analyst's logo and handle in the map's own corner, where a phone and a screenshot keep them", async () => {
    const mark = '<a class="az-mappage-mark" href="https://x.com/desk_maps"><img class="az-my-logo" alt="Logo"><span>@desk_maps</span></a>';
    const doc = await mapPage({ mark, wide: false });
    const moved = doc.querySelector('.az-map-frame > .az-mappage-mark');
    expect(moved).not.toBeNull();
    expect(moved.getAttribute('href')).toBe('https://x.com/desk_maps');
    expect(doc.querySelectorAll('.az-mappage-mark')).toHaveLength(1);
  });

  it('lays its map on the window and puts its search, layers, steps and words in a panel beside it', async () => {
    const doc = await mapPage();
    const figure = doc.querySelector('figure.az-map');
    expect(figure.classList.contains('az-paged')).toBe(true);
    const panel = doc.querySelector('.az-mappage > aside.az-mappage-panel');
    expect([...panel.querySelectorAll('.az-mappage-label')].map((one) => one.textContent)).toEqual(['Find on the map', 'Layers', 'Where the map looks']);
    expect(panel.querySelector('.az-map-legend')).not.toBeNull();
    expect(panel.querySelector('.az-map-steps-row')).not.toBeNull();
    expect(panel.querySelector('.az-mappage-about').textContent).toContain('Each marker is one vehicle.');
    // the timeline stays under the map
    expect(figure.querySelector('.az-map-time')).not.toBeNull();
    // the wheel is the map's own, as on the whole screen: no hint to hold Ctrl
    const stage = doc.querySelector('.az-map-stage');
    const before = stage.querySelector('svg.az-map-svg').getAttribute('viewBox');
    stage.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -100, clientX: 400, clientY: 280, bubbles: true, cancelable: true }));
    expect(stage.querySelector('svg.az-map-svg').getAttribute('viewBox')).not.toBe(before);
    expect(doc.querySelector('.az-map-hint').classList.contains('az-on')).toBe(false);
  });

  it('fills the bands round its still map with its own ground, under the drawing, until a live map has covered them', async () => {
    const doc = await mapPage();
    const stage = doc.querySelector('.az-map-stage');
    const ground = stage.querySelector('.az-map-ground');
    const fill = stage.querySelector(':scope > img.az-map-fill');
    // the same picture, nothing for a reader or a screen reader to find, under the map's own world
    expect(fill.getAttribute('src')).toBe(ground.getAttribute('src'));
    expect([fill.getAttribute('alt'), fill.getAttribute('aria-hidden')]).toEqual(['', 'true']);
    expect(stage.firstElementChild).toBe(fill);
    expect(doc.querySelectorAll('.az-map-fill')).toHaveLength(1);
    // the framing is the map page's own: the map whole in the middle of the stage, its bands round it
    expect(doc.querySelector('figure.az-map').classList.contains('az-paged')).toBe(true);
    // shown over the whole stage, stretched to cover it, blurred and darker than the map
    const style = window.getComputedStyle(fill);
    expect([style.display, style.position, style.objectFit]).toEqual(['block', 'absolute', 'cover']);
    expect(style.filter).toMatch(/^blur\(24px\) saturate\(0?\.62\) brightness\(0?\.45\)$/);
    expect(style.visibility).not.toBe('hidden');
    // out of sight once a live map has taken the stage over (a fresh copy read: happy-dom keeps an element's first style)
    doc.querySelector('figure.az-map').classList.add('az-gl-on');
    const covered = stage.appendChild(fill.cloneNode());
    expect(window.getComputedStyle(covered).visibility).toBe('hidden');
  });

  it('switches a legend row’s features off the map and back, a layer’s name all of its rows', async () => {
    const doc = await mapPage();
    const row = doc.querySelector('li[data-layer="Vehicles"][data-key="Destroyed"]');
    const button = row.querySelector('button.az-key-switch');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    press(button);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    for (const id of ['l1f0', 'l1f1']) expect(shape(doc, id).classList.contains('az-hidden')).toBe(true);
    expect(shape(doc, 'p0').classList.contains('az-hidden')).toBe(false);
    press(button);
    expect(shape(doc, 'l1f0').classList.contains('az-hidden')).toBe(false);
    expect(shape(doc, 'l1f0').classList.contains('az-off')).toBe(false);
    // the line's layer name takes both of its states off
    press([...doc.querySelectorAll('.az-key-layer')].find((one) => one.textContent === 'Line').querySelector('button'));
    expect(['l0f0', 'l0f0s1'].map((id) => shape(doc, id).classList.contains('az-hidden'))).toEqual([true, true]);
  });

  it('finds a feature by any of its words, its row switched back on and its card open', async () => {
    const doc = await mapPage();
    press(doc.querySelector('li[data-key="Destroyed"] button'));
    const field = doc.querySelector('.az-mappage-field');
    type(field, 'burned road');
    const hits = [...doc.querySelectorAll('.az-mappage-hit')];
    expect(doc.querySelector('.az-mappage-found').textContent).toBe('2 found');
    expect(hits.map((hit) => hit.querySelector('.az-mappage-hit-name').textContent)).toEqual(['#1', '#2']);
    type(field, 'nothing like it');
    expect(doc.querySelector('.az-mappage-found').textContent).toBe('Nothing on the map matches');
    type(field, 'heights');
    press(doc.querySelector('.az-mappage-hit'));
    const card = doc.querySelector('.az-map-card');
    expect(card.hidden).toBe(false);
    expect(card.querySelector('.az-map-card-title').textContent).toBe('Heights');
    type(field, '#1');
    press(doc.querySelector('.az-mappage-hit'));
    expect(doc.querySelector('li[data-key="Destroyed"]').classList.contains('az-key-off')).toBe(false);
    expect(shape(doc, 'l1f0').classList.contains('az-off')).toBe(false);
    expect(doc.querySelector('.az-map-card-title').textContent).toBe('#1');
  });

  it('opens where its address says and writes where it looks as it moves, with no step in the history', async () => {
    // a tile's zoom, as OpenStreetMap writes it: one more than the map engine's
    const doc = await mapPage({ hash: '#14.00/12.74500/43.49500' });
    const where = doc.querySelector('figure.az-map').azMap.where();
    expect(where.zoom).toBeCloseTo(13, 1);
    expect(where.center[0]).toBeCloseTo(43.495, 2);
    expect(where.center[1]).toBeCloseTo(12.745, 2);
    const length = window.history.length;
    doc.querySelector('[data-act="out"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle(450);
    expect(window.location.hash).toMatch(/^#13\.\d\d\/12\.\d{5}\/43\.\d{5}$/);
    expect(window.history.length).toBe(length);
  });

  it('leaves the address alone until the map moves', async () => {
    await mapPage();
    await settle(450);
    expect(window.location.hash).toBe('');
  });

  it('folds its panel down to a bar at the foot of the map on a phone, the bar bringing it up and folding it again', async () => {
    const doc = await mapPage({ wide: false });
    const page = doc.querySelector('.az-mappage');
    expect(doc.querySelector('.az-mappage-head button')).toBeNull();
    const bar = doc.querySelector('.az-mappage-panel > .az-mappage-fold');
    expect(bar.textContent).toBe('Layers and search');
    expect(bar.getAttribute('aria-expanded')).toBe('false');
    expect(page.classList.contains('az-mappage-open')).toBe(false);
    press(bar);
    expect(page.classList.contains('az-mappage-open')).toBe(true);
    expect(bar.getAttribute('aria-expanded')).toBe('true');
    // a feature found folds the sheet back to show it on the map
    const field = doc.querySelector('.az-mappage-field');
    field.value = 'Line';
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.querySelector('.az-mappage-results button').click();
    expect(page.classList.contains('az-mappage-open')).toBe(false);
    press(bar);
    press(bar);
    expect(bar.getAttribute('aria-expanded')).toBe('false');
  });

  it('follows a finger dragging its bar, settles the way it was pulled, and takes a short drag as nothing', async () => {
    const doc = await mapPage({ wide: false });
    const page = doc.querySelector('.az-mappage');
    const panel = doc.querySelector('.az-mappage-panel');
    const bar = doc.querySelector('.az-mappage-fold');
    const finger = (type, y) => bar.dispatchEvent(new window.PointerEvent(type, { pointerId: 7, clientY: y, button: 0, bubbles: true }));
    const drag = (from, to) => { finger('pointerdown', from); for (let y = from; Math.sign(to - from) * (to - y) > 0; y += Math.sign(to - from) * 20) finger('pointermove', y); finger('pointermove', to); };
    drag(640, 420);
    // the sheet comes with the finger before it is let go
    expect(panel.style.transform).toMatch(/^translateY\(/);
    finger('pointerup', 420);
    bar.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(page.classList.contains('az-mappage-open')).toBe(true);
    expect(bar.getAttribute('aria-expanded')).toBe('true');
    expect(panel.style.transform).toBe('');
    await settle();
    drag(200, 420);
    finger('pointerup', 420);
    expect(page.classList.contains('az-mappage-open')).toBe(false);
    // a short pull falls back where it was
    drag(640, 610);
    finger('pointerup', 610);
    expect(page.classList.contains('az-mappage-open')).toBe(false);
  });

  it("keeps the panel beside the map on a wider screen, with no button to hide it", async () => {
    const doc = await mapPage();
    expect(doc.querySelector('.az-mappage-head button')).toBeNull();
    expect(window.getComputedStyle(doc.querySelector('.az-mappage-fold')).display).toBe('none');
  });

  it("clips the drawing to what the page frames, never the live map's own marks that move with it", () => {
    const clipping = CSS.split('}').filter((rule) => /clip-path/.test(rule) && /\.az-map-svg/.test(rule));
    expect(clipping.length).toBeGreaterThanOrEqual(2);
    for (const rule of clipping) expect(rule).toMatch(/\.az-map-svg:not\(\.az-gl-over\)/);
  });
});

describe('a feature’s card, in every map', () => {
  it('says its state, its rows, where it is and its history, the addresses in its words as links', async () => {
    const card = {
      title: '#1', kicker: 'Vehicles', day: '15 November 2026', text: 'BATT UMG, see https://x.com/desk/status/1.',
      facts: 'Destroyed · Geolocated by someone else', at: [12.745, 43.495],
      rows: [{ label: 'State', value: 'burned' }, { label: 'Source', value: 'https://t.me/desk/1 and more' }],
      history: [{ day: '15 November 2026', status: 'Damaged' }, { day: '16 November 2026', status: '' }],
    };
    const doc = await mapPage({ figure: withCard('l1f0', card) });
    doc.querySelector('figure.az-map').azMap.open('l1f0');
    const shown = doc.querySelector('.az-map-card');
    expect(shown.querySelector('.az-map-card-facts').textContent).toBe('Destroyed · Geolocated by someone else');
    expect([...shown.querySelectorAll('.az-map-card-rows dt')].map((one) => one.textContent)).toEqual(['State', 'Source']);
    expect(shown.querySelector('.az-map-card-rows dd:last-child a').getAttribute('href')).toBe('https://t.me/desk/1');
    // a sentence's full stop is not part of its address
    expect(shown.querySelector('.az-map-card-text a').getAttribute('href')).toBe('https://x.com/desk/status/1');
    expect([...shown.querySelectorAll('.az-map-card-history li')].map((one) => one.textContent))
      .toEqual(['15 November 2026: Damaged', '16 November 2026']);
    expect(shown.querySelector('.az-map-card-where').textContent).toBe('12.74500, 43.49500');
  });

  it('folds long words behind Read all', async () => {
    const card = { title: '#1', text: 'Words. '.repeat(30), rows: [{ label: 'Landmark', value: 'A long way. '.repeat(20) }] };
    const doc = await mapPage({ figure: withCard('l1f0', card) });
    doc.querySelector('figure.az-map').azMap.open('l1f0');
    const words = doc.querySelector('.az-map-card-words');
    expect(words.classList.contains('az-long')).toBe(true);
    press(doc.querySelector('.az-map-card-more'));
    expect(words.classList.contains('az-long')).toBe(false);
  });
});

describe('a web folder’s view counter', () => {
  const counted = (answer) => vi.fn((address) => {
    expect(address).toBe('https://desk.goatcounter.com/counter/%2Fmaps%2Froad%2F.json');
    return answer;
  });

  it('says the views GoatCounter counts under the title', async () => {
    const fetch = counted(Promise.resolve({ ok: true, json: () => Promise.resolve({ count: '1 234' }) }));
    const doc = await mapPage({ script: `${READER}</script><script>${COUNTER}`, fetch });
    await settle(10);
    const line = doc.querySelector('.az-mappage-views');
    expect(fetch).toHaveBeenCalledOnce();
    expect([line.hidden, line.textContent]).toEqual([false, '1 234 views']);
  });

  it('stays hidden when GoatCounter refuses, says nothing to read, or does not answer', async () => {
    const answers = [() => Promise.resolve({ ok: false }), () => Promise.resolve({ ok: true, json: () => Promise.resolve({ count: '—' }) }),
      () => Promise.reject(new Error('offline'))];
    for (const answer of answers) {
      const doc = await mapPage({ script: `${READER}</script><script>${COUNTER}`, fetch: vi.fn(answer) });
      await settle(10);
      const line = doc.querySelector('.az-mappage-views');
      expect([line.hidden, line.textContent]).toEqual([true, '']);
      await window.happyDOM.close();
    }
  });

  it('counts nothing from a file on the disk', async () => {
    const fetch = vi.fn();
    await mapPage({ url: 'file:///maps/road/index.html', script: `${READER}</script><script>${COUNTER}`, fetch });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('a page of a site that counts its readers', () => {
  /** The pixels a page's script asked for, with its meta and body as given; `fetch` stands the network in. */
  async function counted(head, body = '<h1>A story</h1>', fetch = vi.fn(), url = 'https://desk.github.io/articles/story/') {
    window = new Window({ url, settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
    const pixels = [];
    window.Image = class { set src(value) { pixels.push(value); } };
    window.fetch = fetch;
    window.document.write(`<!doctype html><html><head><title>The story</title>${head}</head><body>${body}<script>${COUNTER}</script></body></html>`);
    await window.happyDOM.waitUntilComplete();
    return pixels;
  }

  it('counts the visit from the site’s meta with the pixel alone, asking no count back', async () => {
    const fetch = vi.fn();
    const pixels = await counted('<meta name="az-counter" content="desk">', undefined, fetch);
    expect(pixels).toHaveLength(1);
    expect(pixels[0]).toMatch(/^https:\/\/desk\.goatcounter\.com\/count\?p=%2Farticles%2Fstory%2F&t=The%20story&rnd=/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('counts nothing with no code, a code that is none, or a page read from the disk', async () => {
    expect(await counted('')).toEqual([]);
    expect(await counted('<meta name="az-counter" content="not a code">')).toEqual([]);
    expect(await counted('<meta name="az-counter" content="desk">', undefined, vi.fn(), 'file:///articles/story/index.html')).toEqual([]);
  });

  it('still says the views of a map page, whose line holds the code', async () => {
    const fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ count: '12' }) }));
    const pixels = await counted('<meta name="az-counter" content="desk">',
      '<span class="az-mappage-views" data-counter="desk" hidden></span>', fetch);
    await settle(10);
    expect(pixels).toHaveLength(1);
    expect(fetch).toHaveBeenCalledOnce();
    const line = window.document.querySelector('.az-mappage-views');
    expect([line.hidden, line.textContent]).toEqual([false, '12 views']);
  });
});

describe('the live map draws a layer as the app’s map does', () => {
  const data = {
    features: [
      { id: 'a', kind: 'point', coords: [43.5, 12.7], style: { color: '#e53935', icon: 's-badge-tank-e53935', bearing: 95, confidence: 'probable' } },
      { id: 'b', kind: 'point', coords: [43.5, 12.7], style: { color: '#0072b2', icon: 's-pin-0072b2', tip: true } },
      { id: 'c', kind: 'line', coords: [[[43.5, 12.7], [43.6, 12.8]]], style: { color: '#0072b2', confidence: 'claimed' } },
      { id: 'd', kind: 'area', coords: [[[[43.5, 12.7], [43.6, 12.8], [43.6, 12.7], [43.5, 12.7]]]], style: { color: '#0072b2' } },
    ],
  };

  it('turns a marker’s wedge, stands a plain marker on its tip, and draws a guess fainter or dotted', () => {
    const shaped = geojson(data).features.features;
    expect(shaped[0].properties).toMatchObject({ bearing: 95, sure: 0.8 });
    expect(shaped[1].properties).toMatchObject({ tip: true, sure: 1 });
    expect(shaped[1].properties.bearing).toBeUndefined();
    expect(shaped[2].properties.dash).toBe('dotted');
    expect(shaped[3].properties.opacity).toBe(0.18);
    const ids = layers().map((layer) => layer.id);
    expect(ids.indexOf('az-bearing')).toBe(ids.indexOf('az-points') - 1);
    const points = layers().find((layer) => layer.id === 'az-points');
    expect(points.layout['icon-anchor']).toEqual(['case', ['has', 'tip'], 'bottom', 'center']);
  });
});
