import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';

/**
 * What an exported HTML report does when it is read (`engine/notes_html_assets/reader.js`),
 * on a page of its own each time: the script is inlined as the export inlines it and
 * runs in a fresh window, with the browser's layout, media and observers stood in for.
 */

const READER = readFileSync(new URL('../../../../src/azimut/engine/notes_html_assets/reader.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../../../src/azimut/engine/notes_html_assets/reader.css', import.meta.url), 'utf8');
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let window;
afterEach(async () => {
  await window?.happyDOM.close();
  window = null;
});

/**
 * A report holding `body`, read at a wide or narrow width, with motion on or turned down,
 * in an article or a story (`web`), from a file or from the Page pane's frame (`url`).
 */
async function report(body, { wide = true, reduced = false, observers = true, hash = '', web = '', url = '' } = {}) {
  window = new Window({
    url: url || `file:///report.html${hash}`, width: wide ? 1440 : 390, height: 900,
    settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true },
  });
  window.matchMedia = (query) => ({
    matches: query.includes('reduce') ? reduced : query.includes('min-width') ? wide : false,
    addEventListener() {}, removeEventListener() {},
  });
  window.observed = [];
  if (observers) {
    window.IntersectionObserver = class {
      constructor(callback, options) { this.callback = callback; this.options = options; window.observed.push(this); this.nodes = []; }
      observe(node) { this.nodes.push(node); }
      disconnect() { this.nodes = []; }
    };
  } else delete window.IntersectionObserver;
  const media = window.HTMLMediaElement.prototype;
  media.play = function play() { this.dataset.playing = 'true'; return Promise.resolve(); };
  media.pause = function pause() { delete this.dataset.playing; this.dispatchEvent(new window.Event('pause')); };
  window.document.write(`<!doctype html><html lang="en" data-look="report"${web ? ` data-web="${web}"` : ''}><head><style>${CSS}</style></head><body>${body}<script>${READER}</script></body></html>`);
  await window.happyDOM.waitUntilComplete();
  return window.document;
}

const press = (node, init = {}) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
const key = (node, name, init = {}) => {
  const event = new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  node.dispatchEvent(event);
  return event;
};
const figure = (caption = 'The berth from the air.', credit = 'Esri, Vantor', extra = '') => `
  <figure class="az-figure${extra}" data-kind="picture"><button type="button" class="az-zoom" aria-label="Open larger: The berth"><img src="${PIXEL}" alt="The berth"></button>
  <figcaption><span class="az-caption"><span class="az-fig-num" id="fig-1">Figure 1.</span> ${caption}</span><span class="az-credit">${credit}</span></figcaption></figure>`;

describe('the page without anything pressed', () => {
  it('says it has script, and reaches nothing outside the file', async () => {
    const doc = await report(figure());
    expect(doc.documentElement.classList.contains('az-js')).toBe(true);
    // nothing in the reader names an address it would fetch, and nothing asks for one
    expect(READER).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|https?:\/\//);
    // a picture drawn in the style sheet is a data: address, its SVG namespace no address at all
    const drawn = CSS.replace(/url\("data:[^"]*"\)/g, 'url(data)');
    expect(drawn).not.toMatch(/url\((?!data)|@import|https?:\/\//);
  });

  it('stays under the weight agreed for its two files, unminified', () => {
    // 75 KB until the story layout, the bar and the links the page takes itself came in; 84 KB
    // until charts appended their own section (a map's reader is spliced in only where a map is);
    // 88 KB until the cover's author card, the analyst's logo set by their name
    expect(Buffer.byteLength(READER) + Buffer.byteLength(CSS)).toBeLessThan(89 * 1024);
  });
});

describe('a picture opens large', () => {
  it('opens on a press with its caption and credit, and Escape closes it and gives the keyboard back', async () => {
    const doc = await report(figure());
    const button = doc.querySelector('.az-zoom');
    button.focus();
    press(button);
    const box = doc.querySelector('dialog.az-lightbox');
    expect(box.open).toBe(true);
    expect(box.querySelector('img').getAttribute('src')).toBe(PIXEL);
    expect(box.getAttribute('aria-label')).toBe('The berth');
    expect(box.querySelector('.az-lb-caption').textContent).toContain('The berth from the air.');
    // the credit stays with the picture, and no id is copied twice into the page
    expect(box.querySelector('.az-lb-credit').textContent).toBe('Esri, Vantor');
    expect(doc.querySelectorAll('#fig-1')).toHaveLength(1);
    expect(doc.documentElement.classList.contains('az-locked')).toBe(true);
    expect(doc.activeElement.getAttribute('data-act')).toBe('close');
    key(box, 'Escape');
    expect(box.open).toBe(false);
    expect(doc.documentElement.classList.contains('az-locked')).toBe(false);
    expect(doc.activeElement).toBe(button);
  });

  it('keeps Tab among its own buttons, both ways round', async () => {
    const doc = await report(`${figure()}<a href="#elsewhere">Elsewhere</a>`);
    press(doc.querySelector('.az-zoom'));
    const box = doc.querySelector('dialog.az-lightbox');
    const buttons = [...box.querySelectorAll('button')];
    expect(doc.activeElement).toBe(buttons.at(-1));
    key(box, 'Tab');
    expect(doc.activeElement).toBe(buttons[0]);
    key(box, 'Tab', { shiftKey: true });
    expect(doc.activeElement).toBe(buttons.at(-1));
  });

  it('zooms in and out, and back to the whole picture', async () => {
    const doc = await report(figure());
    press(doc.querySelector('.az-zoom'));
    const box = doc.querySelector('dialog.az-lightbox');
    const level = () => box.querySelector('.az-lb-level').textContent;
    expect(level()).toBe('100%');
    press(box.querySelector('[data-act="in"]'));
    expect(level()).toBe('150%');
    key(box, '+');
    expect(level()).toBe('225%');
    key(box, '0');
    expect(level()).toBe('100%');
    press(box.querySelector('[data-act="out"]'));
    // never smaller than the whole picture
    expect(level()).toBe('100%');
  });

  it('shows a graphic picture on the first press, and opens it on the next', async () => {
    const doc = await report(figure('A still.', 'Footage', ' az-graphic'));
    const veiled = doc.querySelector('.az-graphic');
    const button = veiled.querySelector('.az-zoom');
    expect(button.getAttribute('aria-label')).toBe('Graphic picture, blurred. Press to show it');
    press(button);
    expect(veiled.classList.contains('az-revealed')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Open larger: The berth');
    expect(doc.querySelector('dialog.az-lightbox')).toBeNull();
    press(button);
    expect(doc.querySelector('dialog.az-lightbox').open).toBe(true);
  });
});

describe('a pair slides', () => {
  const PAIR = `<figure class="az-figure" data-kind="pair"><div class="az-compare">
    <img class="az-before" src="${PIXEL}" alt="Before"><img class="az-after" src="${PIXEL}" alt="After">
    <input class="az-slider" type="range" min="0" max="100" value="50" aria-label="Before and after">
    <span class="az-side-label" data-side="a">A · Esri · 3 Jun 2025</span><span class="az-side-label" data-side="b">B · Apple · ~Oct 2025</span>
  </div></figure>`;

  it('moves the line with the keyboard\'s value and says how much of each shows', async () => {
    const doc = await report(PAIR);
    const pair = doc.querySelector('.az-compare');
    const slider = pair.querySelector('.az-slider');
    expect(pair.style.getPropertyValue('--az-split')).toBe('50%');
    slider.value = '30';
    slider.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(pair.style.getPropertyValue('--az-split')).toBe('30%');
    expect(slider.getAttribute('aria-valuetext')).toBe('30% before, 70% after');
  });

  it('follows a drag across the pictures', async () => {
    const doc = await report(PAIR);
    const pair = doc.querySelector('.az-compare');
    pair.getBoundingClientRect = () => ({ left: 100, top: 0, width: 400, height: 300, right: 500, bottom: 300 });
    const pointer = (type, x) => pair.dispatchEvent(new window.PointerEvent(type, { clientX: x, clientY: 50, button: 0, pointerId: 7, bubbles: true, cancelable: true }));
    pointer('pointerdown', 200);
    expect(pair.style.getPropertyValue('--az-split')).toBe('25%');
    pointer('pointermove', 400);
    expect(pair.style.getPropertyValue('--az-split')).toBe('75%');
    expect(doc.activeElement).toBe(pair.querySelector('.az-slider'));
    pointer('pointerup', 400);
    pointer('pointermove', 150);
    expect(pair.style.getPropertyValue('--az-split')).toBe('75%');
  });
});

describe('a timecode plays its passage', () => {
  it('seeks the clip, plays it and stops at the passage\'s end', async () => {
    const doc = await report(`<video class="az-clip" id="clip-1" src="data:video/mp4;base64,AAAA" preload="metadata"></video>
      <p>The strike <a class="az-time" href="#clip-1" data-clip="clip-1" data-t="130" data-end="158">[2:10–2:38]</a>.</p>`);
    const clip = doc.getElementById('clip-1');
    const link = doc.querySelector('.az-time');
    const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(clip.currentTime).toBe(130);
    expect(clip.dataset.playing).toBe('true');
    expect(link.classList.contains('az-playing')).toBe(true);
    Object.defineProperty(clip, 'currentTime', { value: 158.2, configurable: true });
    clip.dispatchEvent(new window.Event('timeupdate'));
    expect(clip.dataset.playing).toBeUndefined();
    expect(link.classList.contains('az-playing')).toBe(false);
  });

  it('leaves a Watch link to open where it points', async () => {
    const doc = await report('<p><a class="az-watch" href="https://example.org/v" target="_blank" rel="noopener noreferrer">Watch [2:10]</a></p>');
    const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    doc.querySelector('.az-watch').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('a table sorts, filters and points at a row', () => {
  const rows = (count) => Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return `<tr id="V${n}"><td>V${n}</td><td>${['Tug', 'Crane', 'Barge'][n % 3]}</td><td>${(n * 37) % 90}</td></tr>`;
  }).join('');
  const TABLE = (count) => `<div class="az-table-wrap"><table class="az-table"><thead><tr><th>Code</th><th>What</th><th>Length</th></tr></thead>
    <tbody>${rows(count)}</tbody></table></div>`;
  const order = (doc) => [...doc.querySelectorAll('tbody tr')].map((row) => row.id);

  it('sorts by a column from its header button, numbers as numbers, and back the other way', async () => {
    const doc = await report(TABLE(5));
    const [code, , length] = doc.querySelectorAll('th');
    expect(code.querySelector('button.az-sort').textContent).toBe('Code');
    press(length.querySelector('button'));
    expect(length.getAttribute('aria-sort')).toBe('ascending');
    // 37, 74, 21, 58, 5: by size, not by their first digit
    expect(order(doc)).toEqual(['V5', 'V3', 'V1', 'V4', 'V2']);
    press(length.querySelector('button'));
    expect(length.getAttribute('aria-sort')).toBe('descending');
    expect(order(doc)).toEqual(['V2', 'V4', 'V1', 'V3', 'V5']);
    press(code.querySelector('button'));
    expect(length.hasAttribute('aria-sort')).toBe(false);
    expect(order(doc)).toEqual(['V1', 'V2', 'V3', 'V4', 'V5']);
  });

  it('offers no sort on a column with no header, which holds the rows\' labels', async () => {
    const doc = await report(`<div class="az-table-wrap"><table class="az-table"><thead><tr><th scope="col"></th><th scope="col">Video 1</th></tr></thead>
      <tbody><tr><td>SHA-256</td><td>e1e32f4fcf40a0bcde7d2a638076d1a2995b8c96ccb0b53f198838f246cee09b</td></tr>
      <tr><td>Times</td><td>S04 0:23-0:37</td></tr></tbody></table></div>`);
    const [labels, video] = doc.querySelectorAll('th');
    expect(labels.querySelector('button')).toBeNull();
    expect(video.querySelector('button.az-sort').textContent).toBe('Video 1');
    // a hash may break anywhere rather than widen the table; a time range stays whole
    const [hash, times] = [...doc.querySelectorAll('tbody tr')].map((row) => row.children[1]);
    expect(hash.classList.contains('az-token')).toBe(true);
    expect(times.classList.contains('az-token')).toBe(false);
    expect(times.querySelector('.az-keep').textContent).toBe('0:23-0:37');
    // a hash is no hyphenated word to keep whole
    expect(hash.querySelector('.az-keep')).toBeNull();
  });

  it('slides a table wider than its place in its own frame, and lets one that fits stick to the page', async () => {
    const doc = await report(TABLE(3));
    const wrap = doc.querySelector('.az-table-wrap');
    const table = wrap.querySelector('table');
    expect(wrap.classList.contains('az-slides')).toBe(false);
    Object.defineProperty(table, 'scrollWidth', { value: 900, configurable: true });
    Object.defineProperty(wrap, 'clientWidth', { value: 580, configurable: true });
    window.dispatchEvent(new window.Event('resize'));
    expect(wrap.classList.contains('az-slides')).toBe(true);
    // the style sheet: never the page that slides, and five columns take the figures' width. A
    // table that fits is no frame of its own at any width: on a phone its header, stuck under the
    // contents bar within such a frame, stood that bar's height over its first row
    expect(CSS).toMatch(/^\.az-js \.az-table-wrap:not\(\.az-slides\) \{ overflow: visible; \}$/m);
    expect(CSS).not.toMatch(/@media[^{]*\{ \.az-js \.az-table-wrap:not/);
    // every table stands on the axis, as wide as it needs up to the wide width
    expect(CSS).toMatch(/\.az-body > :is\(\.az-table-wrap, \.az-table-block\) \{ grid-column: wide; justify-self: center; width: fit-content;/);
  });

  it('offers a filter past twelve rows only, and says how many are left', async () => {
    let doc = await report(TABLE(12));
    expect(doc.querySelector('.az-filter')).toBeNull();
    await window.happyDOM.close();
    doc = await report(TABLE(20));
    const field = doc.querySelector('.az-filter');
    expect(field.getAttribute('aria-label')).toBe('Filter the rows of this table');
    field.value = 'crane';
    field.dispatchEvent(new window.Event('input'));
    const shown = [...doc.querySelectorAll('tbody tr')].filter((row) => !row.hidden);
    expect(shown.map((row) => row.children[1].textContent)).toEqual(Array(shown.length).fill('Crane'));
    expect(doc.querySelector('.az-table-tools [aria-live]').textContent).toBe(`${shown.length} of 20 rows`);
  });

  it('flashes the row an address names, filtered back in when it was hidden', async () => {
    const doc = await report(`${TABLE(20)}<p><a href="#V7">V7</a></p>`, { hash: '#V7' });
    expect(doc.getElementById('V7').classList.contains('az-flash')).toBe(true);
    const field = doc.querySelector('.az-filter');
    field.value = 'zzz';
    field.dispatchEvent(new window.Event('input'));
    expect(doc.getElementById('V7').hidden).toBe(true);
    doc.getElementById('V7').classList.remove('az-flash');
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    expect(field.value).toBe('');
    expect(doc.getElementById('V7').hidden).toBe(false);
    expect(doc.getElementById('V7').classList.contains('az-flash')).toBe(true);
  });
});

describe('a table\'s settings line asks the reader', () => {
  const rows = (count) => Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return `<tr id="R${n}"><td>R${n}</td><td>${['Tug', 'Crane', 'Barge'][n % 3]}</td><td>${(n * 37) % 90}</td></tr>`;
  }).join('');
  /** A table as `engine/notes_html.py` writes one with settings, `data` its attributes, `after` what the block holds under it. */
  const TABLE = (count, data = '', after = '') => {
    const table = `<div class="az-table-wrap"><table class="az-table" data-rows="${count}"${data}><thead><tr><th>Code</th><th>What</th><th>Length</th></tr></thead>
      <tbody>${rows(count)}</tbody></table></div>`;
    return after ? `<div class="az-table-block">${table}${after}</div>` : table;
  };
  const folded = (doc) => [...doc.querySelectorAll('tbody tr')].filter((row) => row.classList.contains('az-folded')).map((row) => row.id);
  const order = (doc) => [...doc.querySelectorAll('tbody tr')].map((row) => row.id);

  it('shows the filter on a short table when it says always, and never on a long one that says never', async () => {
    let doc = await report(TABLE(4, ' data-search="always"'));
    expect(doc.querySelector('.az-filter').getAttribute('aria-label')).toBe('Filter the rows of this table');
    await window.happyDOM.close();
    doc = await report(TABLE(30, ' data-search="never"'));
    expect(doc.querySelector('.az-filter')).toBeNull();
    // past twelve rows by itself, as before
    await window.happyDOM.close();
    doc = await report(TABLE(13));
    expect(doc.querySelector('.az-filter')).not.toBeNull();
  });

  it('offers no sorting when it says sort off', async () => {
    const doc = await report(TABLE(5, ' data-sort="off"'));
    expect(doc.querySelector('.az-sort')).toBeNull();
    expect(doc.querySelector('th').textContent).toBe('Code');
  });

  it('folds a long table under Show all, opens it whole and folds it again', async () => {
    const doc = await report(TABLE(12, ' data-fold="5"'));
    expect(folded(doc)).toEqual(['R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12']);
    const more = doc.querySelector('.az-table-block > .az-table-wrap + button.az-table-more');
    expect(more.textContent).toBe('Show all 12 rows');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    press(more);
    expect(folded(doc)).toEqual([]);
    expect(more.textContent).toBe('Show the first 5 rows');
    expect(more.getAttribute('aria-expanded')).toBe('true');
    press(more);
    expect(folded(doc)).toHaveLength(7);
    // a table no longer than its fold has nothing to fold
    await window.happyDOM.close();
    const short = await report(TABLE(5, ' data-fold="5"'));
    expect(short.querySelector('.az-table-more')).toBeNull();
    expect(folded(short)).toEqual([]);
  });

  it('keeps the first rows of the order a sort gives, and folds nothing while the rows are filtered', async () => {
    const doc = await report(TABLE(14, ' data-fold="3"'));
    press(doc.querySelectorAll('.az-sort')[2]);
    // 37, 74, 21, 58, 5, 42, 79, 26, 63, 10, 47, 84, 31, 68: by size, the first three shown
    expect(order(doc).slice(0, 3)).toEqual(['R5', 'R10', 'R3']);
    expect(folded(doc)).toEqual(order(doc).slice(3));
    const field = doc.querySelector('.az-filter');
    field.value = 'crane';
    field.dispatchEvent(new window.Event('input'));
    expect(folded(doc)).toEqual([]);
    expect(doc.querySelector('.az-table-more').hidden).toBe(true);
    field.value = '';
    field.dispatchEvent(new window.Event('input'));
    expect(folded(doc)).toHaveLength(11);
    expect(doc.querySelector('.az-table-more').hidden).toBe(false);
    // a first column kept in sight stays so through it (laid out again for Chromium)
    await window.happyDOM.close();
    const kept = await report(TABLE(14, ' data-fold="3"').replace('class="az-table"', 'class="az-table az-first"'));
    const again = kept.querySelector('.az-filter');
    again.value = 'tug';
    again.dispatchEvent(new window.Event('input'));
    expect(kept.querySelector('table').classList.contains('az-first')).toBe(true);
  });

  it('opens the fold for a row an address names, and keeps the filter and the fold with the caption under the table', async () => {
    const caption = '<p class="az-table-cap"><span class="az-caption">The register</span></p>';
    const doc = await report(`${TABLE(20, ' data-fold="5"', caption)}<p><a href="#R9">R9</a></p>`, { hash: '#R9' });
    expect(doc.getElementById('R9').classList.contains('az-folded')).toBe(false);
    expect(doc.getElementById('R9').classList.contains('az-flash')).toBe(true);
    expect(doc.querySelector('.az-table-more').textContent).toBe('Show the first 5 rows');
    const block = doc.querySelector('.az-table-block');
    expect([...block.children].map((node) => node.className)).toEqual(['az-table-tools', 'az-table-wrap', 'az-table-more', 'az-table-cap']);
    expect(doc.querySelectorAll('.az-table-block')).toHaveLength(1);
  });
});

describe('a citation shows its source', () => {
  const PAGE = `<p>Smoke over the port <a class="az-cite" href="#src-1" data-src="1">[1]</a>.</p>
    <section class="az-sources" id="sources"><ol><li id="src-1"><strong>First clip</strong>, posted on X. <a class="az-verify" href="https://web.archive.org/x">Archive ↗</a>
    <span class="az-hash" id="h1">9f2c…</span> <a class="az-back" href="#cite-1">↩</a></li></ol></section>`;

  it('opens a card from the Sources entry on focus, described to a screen reader, and closes on Escape', async () => {
    const doc = await report(PAGE);
    const link = doc.querySelector('.az-cite');
    link.dispatchEvent(new window.FocusEvent('focus'));
    const card = doc.getElementById('az-card');
    expect(card.getAttribute('role')).toBe('tooltip');
    expect(card.textContent).toContain('Source 1');
    expect(card.textContent).toContain('First clip');
    expect(card.querySelector('.az-verify').getAttribute('href')).toBe('https://web.archive.org/x');
    // a copy, so no id twice and no way back from it
    expect(card.querySelector('[id]')).toBeNull();
    expect(card.querySelector('.az-back')).toBeNull();
    expect(link.getAttribute('aria-describedby')).toBe('az-card');
    key(doc, 'Escape');
    expect(doc.getElementById('az-card')).toBeNull();
    expect(link.hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('titles', () => {
  it('never break right after a hyphen, in the page or in its contents', async () => {
    const doc = await report(`<header class="az-cover"><h1 class="az-title">The fall of the Bab al-Mandab front, Sep-Nov 2026</h1></header>
      <nav class="az-contents"><ol><li><a href="#s">Dhubab to Bab al-Mandab</a></li></ol></nav>
      <main class="az-body"><h2 id="s">Dhubab to Bab al-Mandab</h2></main>`);
    expect([...doc.querySelectorAll('.az-title .az-keep')].map((node) => node.textContent)).toEqual(['al-Mandab', 'Sep-Nov']);
    expect(doc.querySelector('.az-title').textContent).toBe('The fall of the Bab al-Mandab front, Sep-Nov 2026');
    expect(doc.querySelector('h2 .az-keep').textContent).toBe('al-Mandab');
    expect(doc.querySelector('.az-contents a .az-keep').textContent).toBe('al-Mandab');
    expect(CSS).toMatch(/\.az-title \{[^}]*text-wrap: balance;[^}]*hyphens: manual;/);
  });
});

describe('the contents follow the reading', () => {
  it('marks the chapter read, and offers the list from a button on a narrow screen', async () => {
    const doc = await report(`<nav class="az-contents"><ol><li><a href="#one">One</a></li><li><a href="#two">Two</a></li><li><a href="#sources">Sources</a></li></ol></nav>
      <main class="az-body"><h2 id="one">One</h2><p>a</p><h2 id="two">Two</h2><p>b</p><section class="az-sources" id="sources"></section></main>`, { wide: false });
    const toggle = doc.querySelector('.az-contents-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(doc.querySelector('.az-contents ol').id);
    const tops = { one: -400, two: 120, sources: 2000 };
    for (const [id, top] of Object.entries(tops)) doc.getElementById(id).getBoundingClientRect = () => ({ top, bottom: top + 40, left: 0, right: 0, width: 0, height: 40 });
    window.dispatchEvent(new window.Event('resize'));
    expect(doc.querySelector('a[aria-current]').textContent).toBe('Two');
    expect(toggle.querySelector('.az-contents-now').textContent).toBe('Two');
    press(toggle);
    expect(doc.querySelector('.az-contents').classList.contains('az-open')).toBe(true);
    press(doc.querySelector('a[href="#sources"]'));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('steps go one at a time', () => {
  const DAYS = ['2 Mar 2026', '3 Mar 2026', '5 Mar 2026'];
  /** As the export writes it: the steps, then their bar, hidden until the script shows it. */
  const STEPS = `<section class="az-steps" data-steps="3" aria-label="Steps">
    ${DAYS.map((day, index) => `
      <div class="az-step" data-step="${index + 1}" style="--az-n:${index + 1}" data-label="${day}">
        <figure class="az-figure" data-kind="picture">${index === 1 ? '<video class="az-clip" id="clip-2" src="data:video/mp4;base64,AAAA" muted></video>' : `<button type="button" class="az-zoom"><img src="${PIXEL}" alt=""></button>`}
        <figcaption><span class="az-caption">${day}, the berth</span></figcaption></figure></div>`).join('')}
    <nav class="az-steps-bar" aria-label="Steps" hidden><button type="button" class="az-steps-prev" aria-label="Previous step">‹</button>
    <ol class="az-steps-dots">${DAYS.map((day, index) => `<li><button type="button" data-step="${index + 1}" aria-label="Step ${index + 1}: ${day}">${day}</button></li>`).join('')}</ol>
    <button type="button" class="az-steps-next" aria-label="Next step">›</button></nav></section>`;

  it('shows the first, names each by its day, and goes on with the buttons and the arrow keys', async () => {
    const doc = await report(STEPS);
    const section = doc.querySelector('.az-steps');
    const steps = [...section.querySelectorAll('.az-step')];
    const on = () => steps.findIndex((step) => step.classList.contains('az-on'));
    expect(on()).toBe(0);
    expect(steps[1].hasAttribute('inert')).toBe(true);
    expect(section.querySelector('.az-steps-bar').hidden).toBe(false);
    const dots = [...section.querySelectorAll('.az-steps-dots button')];
    expect(dots.map((dot) => dot.textContent)).toEqual(DAYS);
    expect(dots[0].getAttribute('aria-current')).toBe('step');
    const back = section.querySelector('.az-steps-prev');
    const next = section.querySelector('.az-steps-next');
    expect(back.disabled).toBe(true);
    expect(section.querySelector('.az-steps-count').textContent).toBe('1 / 3');
    key(section, 'ArrowRight');
    expect(on()).toBe(1);
    // the step's clip plays, muted, while it is shown
    const clip = doc.getElementById('clip-2');
    expect(clip.muted).toBe(true);
    expect(clip.dataset.playing).toBe('true');
    next.focus();
    press(next);
    expect(on()).toBe(2);
    expect(clip.dataset.playing).toBeUndefined();
    expect(next.disabled).toBe(true);
    // the button just put out of reach hands the keyboard to the step's dot
    expect(doc.activeElement).toBe(dots[2]);
    key(section, 'ArrowLeft');
    key(section, 'Home');
    expect(on()).toBe(0);
    press(dots[2]);
    expect(on()).toBe(2);
    expect(steps[2].getAttribute('aria-hidden')).toBe('false');
  });

  it('stays stacked, every step shown, when the page has no bar for it', async () => {
    const doc = await report(STEPS.replace(/<nav[\s\S]*<\/nav>/, ''));
    expect(doc.querySelector('.az-on')).toBeNull();
    expect(doc.querySelector('[inert]')).toBeNull();
  });

  it('brings a step into view when a timecode plays its clip', async () => {
    const doc = await report(`${STEPS}<p><a class="az-time" href="#clip-2" data-clip="clip-2" data-t="4">[0:04]</a></p>`);
    press(doc.querySelector('.az-time'));
    expect(doc.querySelectorAll('.az-step')[1].classList.contains('az-on')).toBe(true);
  });
});

describe('a story keeps its picture beside the words', () => {
  const STORY = `<section class="az-story"><div class="az-story-figures">
      <figure class="az-figure" data-step="1" style="--az-n:1"><button type="button" class="az-zoom"><img src="${PIXEL}" alt=""></button></figure>
      <figure class="az-figure" data-step="2" data-zoom="0.25,0.1,0.5,0.4" style="--az-n:2"><button type="button" class="az-zoom"><img src="${PIXEL}" alt=""></button></figure>
    </div><div class="az-story-steps">
      <div class="az-story-step" data-step="1" style="--az-n:1"><p>The port.</p></div>
      <div class="az-story-step" data-step="2" style="--az-n:2"><p>The berth.</p></div>
    </div></section>`;

  /** Lay the story out as scrolled: the section in sight, each step's top where it is read. */
  const scrolled = (doc, tops) => {
    doc.querySelector('.az-story').getBoundingClientRect = () => ({ top: -200, bottom: 1600, left: 0, right: 0, width: 0, height: 1800 });
    doc.querySelectorAll('.az-story-step').forEach((step, index) => {
      step.getBoundingClientRect = () => ({ top: tops[index], bottom: tops[index] + 200, left: 0, right: 0, width: 0, height: 200 });
    });
    window.dispatchEvent(new window.Event('resize'));
  };

  it('holds the picture of the step being read on a wide screen, and moves in on the part it names', async () => {
    const doc = await report(STORY);
    const section = doc.querySelector('.az-story');
    expect(section.classList.contains('az-live')).toBe(true);
    const [first, second] = doc.querySelectorAll('.az-story-figures > figure');
    expect(first.classList.contains('az-on')).toBe(true);
    expect(second.hasAttribute('inert')).toBe(true);
    // the step being read is the last whose top has passed six tenths of the window, measured as the page scrolls
    scrolled(doc, [100, 700]);
    expect(first.classList.contains('az-on')).toBe(true);
    scrolled(doc, [-400, 400]);
    expect(second.classList.contains('az-on')).toBe(true);
    expect(first.classList.contains('az-on')).toBe(false);
    expect(doc.querySelectorAll('.az-story-step')[1].classList.contains('az-on')).toBe(true);
    // half the picture's width fills the box: scale 2, the centre of the part moved to the middle
    expect(second.querySelector('img').style.transform).toBe('scale(2.0000) translate(0.000%, 20.000%)');
    // each card says where it stands, quietly
    expect([...doc.querySelectorAll('.az-story-count')].map((count) => count.textContent)).toEqual(['1 / 2', '2 / 2']);
  });

  it('follows the reading without an observer, whose margins a sandboxed frame does not keep', async () => {
    const doc = await report(STORY, { observers: false });
    expect(doc.querySelector('.az-story').classList.contains('az-live')).toBe(true);
    expect(window.observed).toHaveLength(0);
    scrolled(doc, [-400, 300]);
    expect(doc.querySelectorAll('.az-story-figures > figure')[1].classList.contains('az-on')).toBe(true);
  });

  it('reads picture then words, with nothing moving, when narrow in an article or when motion is turned down', async () => {
    for (const options of [{ wide: false }, { reduced: true }, { reduced: true, web: 'story' }]) {
      const doc = await report(STORY, options);
      expect(doc.querySelector('.az-story').classList.contains('az-live')).toBe(false);
      expect(doc.querySelector('.az-on')).toBeNull();
      expect(doc.querySelector('[inert]')).toBeNull();
      expect(doc.querySelector('.az-story-count')).toBeNull();
      await window.happyDOM.close();
    }
    window = null;
  });

  it('interleaves the two columns in the style sheet when they fold, step by step', () => {
    expect(CSS).toContain('.az-story-figures > figure { order: calc(var(--az-n, 0) * 2);');
    expect(CSS).toContain('.az-story-step { order: calc(var(--az-n, 0) * 2 + 1); }');
  });
});

describe('the story layout', () => {
  const SCENES = `<header class="az-cover" data-cover="none"><h1 class="az-title">Port</h1></header>
    <div class="az-page"><main class="az-body"><p>Before.</p>
    <figure class="az-figure" data-kind="picture"><button type="button" class="az-zoom"><img src="data:image/png;base64,Y2hhcnQ=" alt=""></button></figure>
    <section class="az-story az-scenes"><div class="az-story-figures">
      <figure class="az-figure" data-kind="picture" data-step="1" style="--az-n:1"><button type="button" class="az-zoom"><img src="${PIXEL}" alt=""></button>
      <figcaption><span class="az-caption">The quay</span><span class="az-credit">Esri <a class="az-cite" href="#src-1" id="c1">[1]</a></span></figcaption></figure>
      <figure class="az-figure" data-kind="picture" data-step="2" style="--az-n:2"><button type="button" class="az-zoom"><img src="${PIXEL}" alt=""></button></figure>
    </div><div class="az-story-steps">
      <div class="az-story-step" data-step="1" style="--az-n:1"><p>The quay.</p></div>
      <div class="az-story-step" data-step="2" style="--az-n:2" data-quiet="true"></div>
    </div></section></main></div>`;

  it('holds each picture beside its words at any width, the words of a scene carrying no count', async () => {
    for (const wide of [true, false]) {
      const doc = await report(SCENES, { wide, web: 'story' });
      expect(doc.querySelector('.az-scenes').classList.contains('az-live'), String(wide)).toBe(true);
      expect(doc.querySelector('.az-story-count')).toBeNull();
      await window.happyDOM.close();
    }
    window = null;
  });

  it('opens on the first picture that came from somewhere, its credit kept on it, never in an article', async () => {
    const doc = await report(SCENES, { web: 'story' });
    const held = doc.querySelector('.az-cover > .az-cover-figure');
    expect(held.querySelector('img').getAttribute('src')).toBe(PIXEL);
    expect(held.querySelector('.az-credit').textContent).toContain('Esri');
    expect(held.querySelector('[id]')).toBeNull();
    await window.happyDOM.close();
    const article = await report(SCENES);
    expect(article.querySelector('.az-cover-figure')).toBeNull();
    await window.happyDOM.close();
    // a cover picture of the look's own stays the one shown
    const own = await report(SCENES.replace('</h1>', '</h1><figure class="az-figure az-cover-figure" data-kind="picture"><img src="data:image/png;base64,b3du" alt=""></figure>'), { web: 'story' });
    expect([...own.querySelectorAll('.az-cover-figure img')].map((image) => image.getAttribute('src'))).toEqual(['data:image/png;base64,b3du']);
  });

  it('holds its pictures on a dark band the width of the window, on a screen only, the cards beside or over it', () => {
    const screen = CSS.slice(CSS.indexOf('@media screen {'), CSS.indexOf('@media screen and (max-width: 63.99rem)'));
    expect(screen).toContain('grid-template-columns: minmax(0, 62fr) minmax(0, 38fr); gap: 0; margin-block: 3.5rem; background: #0f1012;');
    // the picture kept whole, the column of what is said of it the picture's own width
    expect(screen).toContain('grid-template-columns: minmax(min(20rem, var(--stage-w)), min-content)');
    // a picture wall's frames keep the wall's own sizes (`reader.chart.css`)
    expect(screen).toMatch(/:is\(\.az-zoom img, \.az-compare > \.az-before, video, \.az-poster\):where\(:not\(\.az-wall \*\)\) \{\s+width: auto; max-width: var\(--stage-w\);/);
    expect(screen).not.toContain('object-fit: cover');
    // on a phone the cards pass over the stage, and a press between them reaches its picture
    const narrow = CSS.slice(CSS.indexOf('@media screen and (max-width: 63.99rem)'));
    expect(narrow).toMatch(/\.az-live \.az-story-steps \{[^}]*pointer-events: none;/);
    expect(narrow).toMatch(/\.az-live \.az-story-step \{[^}]*pointer-events: auto;/);
    // printed, none of it: the story reads as the article does
    expect(CSS.slice(CSS.indexOf('@media print {'))).not.toContain('#0f1012');
  });

  it('keeps its contents in the bar at every width, the article in a rail where there is room', async () => {
    const PAGE = '<header class="az-cover"><h1 class="az-title">Port</h1></header><div class="az-page"><nav class="az-contents"><ol><li><a href="#one">One</a></li></ol></nav><main class="az-body"><h2 id="one">One</h2></main></div>';
    const story = await report(PAGE, { web: 'story' });
    expect(story.querySelector('.az-contents').classList.contains('az-bar')).toBe(true);
    expect(story.documentElement.classList.contains('az-barred')).toBe(true);
    expect(story.querySelector('.az-bar-title').textContent).toBe('Port');
    await window.happyDOM.close();
    const wide = await report(PAGE);
    expect(wide.querySelector('.az-contents').classList.contains('az-bar')).toBe(false);
    expect(wide.documentElement.classList.contains('az-barred')).toBe(false);
    await window.happyDOM.close();
    const narrow = await report(PAGE, { wide: false });
    expect(narrow.querySelector('.az-contents').classList.contains('az-bar')).toBe(true);
  });
});

describe('a link to a part of the page', () => {
  const PAGE = `<div class="az-page"><nav class="az-contents"><ol><li><a href="#one">One</a></li><li><a href="#two">Two</a></li></ol></nav>
    <main class="az-body"><p><a class="az-cite" href="#src-1" data-src="1">[1]</a> and <a href="#gone">a part since cut</a></p>
    <h2 id="one">One</h2><h2 id="two">Two</h2></main>
    <section class="az-sources" id="sources"><ol><li id="src-1">First clip</li></ol></section></div>`;
  const follow = (doc, href, init) => {
    const event = new window.MouseEvent('click', { bubbles: true, cancelable: true, ...init });
    doc.querySelector(`a[href="${href}"]`).dispatchEvent(event);
    return event;
  };

  it('goes there itself in the Page pane\'s frame, whose address is the app\'s: never a blank page', async () => {
    const doc = await report(PAGE, { url: 'about:srcdoc' });
    const seen = [];
    for (const id of ['two', 'src-1']) doc.getElementById(id).scrollIntoView = (options) => seen.push([id, options]);
    const pushed = [];
    window.history.pushState = (...args) => pushed.push(args);
    // the contents, a citation, even a modified press: each is taken over, the frame never leaves
    for (const [href, init] of [['#two', {}], ['#src-1', {}], ['#two', { ctrlKey: true }]]) expect(follow(doc, href, init).defaultPrevented, href).toBe(true);
    expect(seen.map(([id]) => id)).toEqual(['two', 'src-1', 'two']);
    expect(seen[0][1]).toEqual({ behavior: 'smooth', block: 'start' });
    // the keyboard follows, and the source read is flashed; the frame's address is never written
    expect(doc.activeElement).toBe(doc.getElementById('two'));
    expect(doc.getElementById('two').getAttribute('tabindex')).toBe('-1');
    expect(doc.getElementById('src-1').classList.contains('az-flash')).toBe(true);
    expect(pushed).toEqual([]);
    // a link to nothing on the page goes nowhere rather than away
    expect(follow(doc, '#gone').defaultPrevented).toBe(true);
    const middle = new window.MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
    doc.querySelector('a[href="#one"]').dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(true);
  });

  it('writes the address of a file as it goes, and leaves a new tab to the browser', async () => {
    const doc = await report(PAGE, { reduced: true });
    const pushed = [];
    window.history.pushState = (...args) => pushed.push(args);
    let options;
    doc.getElementById('one').scrollIntoView = (given) => { options = given; };
    expect(follow(doc, '#one').defaultPrevented).toBe(true);
    expect(options.behavior).toBe('auto');
    expect(pushed).toEqual([[null, '', '#one']]);
    expect(follow(doc, '#two', { metaKey: true }).defaultPrevented).toBe(false);
  });
});

describe('the reading', () => {
  it('draws how far the page has been read along its top', async () => {
    const doc = await report('<p>Words.</p>');
    const line = doc.querySelector('body > .az-progress');
    expect(line.getAttribute('aria-hidden')).toBe('true');
    Object.defineProperty(doc.documentElement, 'scrollHeight', { value: 2900, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true });
    window.dispatchEvent(new window.Event('resize'));
    expect(line.style.getPropertyValue('--read')).toBe('0.2500');
  });

  it('lets an address written out break anywhere, rather than stretch a justified line', async () => {
    const doc = await report('<main class="az-body"><p>See <a href="https://example.org/a/very/long/address/that/runs/on">https://example.org/a/very/long/address/that/runs/on</a> and <a href="https://example.org">this page</a>.</p></main>');
    expect([...doc.querySelectorAll('a')].map((link) => link.classList.contains('az-long'))).toEqual([true, false]);
    // the one rule that justifies the text, from a page wide enough
    expect(CSS).toContain('@media (min-width: 48rem) { .az-body > p, :is(.az-callout, .az-internal, .az-body > blockquote) > p:not(.az-callout-label) { text-align: justify; hyphens: auto; } }');
  });
});

describe('printing', () => {
  it('opens every "How this was checked" for the paper, and closes them again after', async () => {
    const doc = await report('<details class="az-checked"><summary>How this was checked</summary><ol class="az-chain"><li>a</li></ol></details>');
    const details = doc.querySelector('details');
    window.dispatchEvent(new window.Event('beforeprint'));
    expect(details.open).toBe(true);
    window.dispatchEvent(new window.Event('afterprint'));
    expect(details.open).toBe(false);
  });
});
