// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { chromeBoxes } from './mapChrome.js';

/**
 * What a pinned reference window keeps clear of. happy-dom lays nothing out, so
 * each element is handed the box it would have on a 1000 by 700 map.
 */

function at(el, x, y, w, h) {
  el.getBoundingClientRect = () => ({ left: 100 + x, top: 50 + y, width: w, height: h });
  return el;
}

function map(markup) {
  document.body.innerHTML = `<div class="map-wrap">${markup}</div>`;
  const wrap = at(document.querySelector('.map-wrap'), 0, 0, 1000, 700);
  return wrap;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the map’s controls', () => {
  it('reads each control, in the map’s own pixels', () => {
    const wrap = map('<div class="map-bar"></div><div class="map-tools"></div>');
    at(wrap.querySelector('.map-bar'), 12, 12, 368, 41);
    at(wrap.querySelector('.map-tools'), 12, 61, 38, 141);
    expect(chromeBoxes(wrap)).toEqual([
      { x: 12, y: 12, w: 368, h: 41 },
      { x: 12, y: 61, w: 38, h: 141 },
    ]);
  });

  it('reads inside a layer that lets the pointer through, not the layer', () => {
    const wrap = map('<div class="status" style="pointer-events: none"><div class="acts"></div></div>');
    at(wrap.querySelector('.status'), 12, 600, 976, 49);
    at(wrap.querySelector('.acts'), 640, 600, 348, 49);
    expect(chromeBoxes(wrap)).toEqual([{ x: 640, y: 600, w: 348, h: 49 }]);
  });

  it('counts the engine’s own buttons but not the map, the globe or the windows', () => {
    const wrap = map(
      '<div class="map"><div class="maplibregl-ctrl"></div></div><div class="globe"></div><div class="ref-viewer"></div>'
    );
    for (const el of wrap.querySelectorAll('.map, .globe, .ref-viewer')) at(el, 0, 0, 1000, 700);
    at(wrap.querySelector('.maplibregl-ctrl'), 12, 210, 30, 60);
    expect(chromeBoxes(wrap)).toEqual([{ x: 12, y: 210, w: 30, h: 60 }]);
  });

  it('leaves out what is hidden or has no size', () => {
    const wrap = map('<div class="a" style="display: none"></div><div class="b"></div>');
    at(wrap.querySelector('.a'), 0, 0, 50, 50);
    at(wrap.querySelector('.b'), 0, 0, 0, 0);
    expect(chromeBoxes(wrap)).toEqual([]);
  });
});
