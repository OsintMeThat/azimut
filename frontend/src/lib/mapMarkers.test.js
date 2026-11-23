import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DROP,
  DROP_CARD_OFFSET,
  DROP_PATH,
  markerGeometry,
  markerSvg,
  MARKER_GEOMETRY,
  NAME_GAP,
  paintLeadDrop,
  paintMarker,
  paintName,
  paintPlaceDrop,
  paintTeardrop,
  PLACE_RED,
  placeColour,
  placeDropSvg,
  placeMark,
  TEARDROP,
  TEARDROP_CARD_OFFSET,
} from './mapMarkers.js';

describe('markerSvg', () => {
  it('draws the pin as a teardrop with an eye in it', () => {
    const svg = markerSvg('pin');
    expect(svg).toContain('<path d="M15 41');
    expect(svg).toContain('<circle cx="15" cy="14"');
  });

  it('draws the crosshair twice, dark under light, so it reads on any imagery', () => {
    const svg = markerSvg('crosshair');
    expect(svg).toContain('stroke="#000"');
    expect(svg).toContain('stroke="#fff"');
  });

  it('leaves the centre of the crosshair open, because that gap is the point', () => {
    // The arms stop short of 23 on both sides; nothing is drawn across it.
    expect(markerSvg('crosshair')).toContain('x1="1" y1="23" x2="16" y2="23"');
    expect(markerSvg('crosshair')).toContain('x1="30" y1="23" x2="45" y2="23"');
  });

  it('falls back to the crosshair for a style it does not know', () => {
    expect(markerSvg('something-else')).toBe(markerSvg('crosshair'));
  });
});

describe('markerGeometry', () => {
  it('anchors the pin at its tip, not its centre', () => {
    const { size, anchor } = markerGeometry('pin');
    expect(anchor).toEqual([size[0] / 2, size[1]]);
  });

  it('anchors the crosshair at its centre', () => {
    const { size, anchor } = markerGeometry('crosshair');
    expect(anchor).toEqual([size[0] / 2, size[1] / 2]);
  });

  it('gives every style an anchor inside its own box', () => {
    for (const style of Object.keys(MARKER_GEOMETRY)) {
      const { size, anchor } = markerGeometry(style);
      expect(anchor[0]).toBeLessThanOrEqual(size[0]);
      expect(anchor[1]).toBeLessThanOrEqual(size[1]);
    }
  });

  it('matches the box the SVG actually declares', () => {
    for (const style of Object.keys(MARKER_GEOMETRY)) {
      const [w, h] = markerGeometry(style).size;
      expect(markerSvg(style)).toContain(`width="${w}" height="${h}"`);
    }
  });
});

/**
 * The mark the overlays put on a saved point. It is CSS rather than an SVG — a
 * 24 px box with one sharp corner, turned 45° — so what is pinned here is the
 * arithmetic that turns that rotation into an anchor, and the agreement with
 * `extension/mapdraw.js`, which draws the same shape on other people's maps
 * and cannot import this file.
 */
describe('the teardrop on a saved point', () => {
  it('anchors on the sharp corner, half a diagonal below the middle', () => {
    const [, height] = TEARDROP.size;
    expect(TEARDROP.anchor[0]).toBe(TEARDROP.size[0] / 2);
    expect(TEARDROP.anchor[1]).toBeCloseTo(height / 2 + (height / 2) * Math.SQRT2, 6);
  });

  it('stands the body clear of the point rather than around it', () => {
    // What `surface.js` turns the anchor into: the element's centre, relative
    // to the coordinate. Negative is upward, which is where the body goes.
    const offsetY = TEARDROP.size[1] / 2 - TEARDROP.anchor[1];
    expect(offsetY).toBeCloseTo(-16.97, 2);
  });

  it('hangs a card off the point far enough to clear that body', () => {
    expect(TEARDROP_CARD_OFFSET).toBeGreaterThanOrEqual(
      TEARDROP.anchor[1] - TEARDROP.size[1] / 2
    );
  });

  it('states the same geometry the extension draws with', () => {
    const source = readFileSync(new URL('../../../extension/mapdraw.js', import.meta.url), 'utf8');
    const box = Number(/const MARK = (\d+);/.exec(source)[1]);
    expect(box).toBe(TEARDROP.size[1]);
    expect(source).toContain('const MARK_TIP = (MARK / 2) * Math.SQRT2;');
  });
});

/** A 2D context that records what it was asked to do (happy-dom has none). */
function recorder() {
  const calls = [];
  const ctx = new Proxy({ calls, measureText: () => ({ width: 10 }) }, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => calls.push([key, ...args]);
    },
    set(target, key, value) {
      calls.push([`=${String(key)}`, value]);
      return true;
    },
  });
  return ctx;
}

describe('a place’s drop, from the pin under the pointer to the place saved', () => {
  it('is one drop whose tip is the point, the shape a lead has', () => {
    expect(DROP).toEqual({ size: [26, 36], anchor: [13, 35] });
    expect(DROP_CARD_OFFSET).toBeGreaterThanOrEqual(DROP.anchor[1]);
    const svg = placeDropSvg();
    expect(svg).toContain(`d="${DROP_PATH}"`);
    expect(svg).toContain('width="26" height="36"');
  });

  it('wears the place’s colour, and the pin red without one or with anything but a code', () => {
    expect(placeDropSvg({ colour: '#1F77B4' })).toContain('fill="#1f77b4"');
    for (const wrong of [undefined, '', 'red', '#12345', 'var(--x)', '"><script>']) {
      expect(placeDropSvg({ colour: wrong })).toContain(`fill="${PLACE_RED}"`);
    }
    expect(placeColour('#ABCDEF')).toBe('#abcdef');
  });

  it('shows a white heart alone, and the count of a stack in its place', () => {
    expect(placeDropSvg({ count: 1 })).toContain('<circle cx="13" cy="12.5" r="4.6" fill="#fff"');
    const stack = placeDropSvg({ count: 3 });
    expect(stack).not.toContain('<circle');
    expect(stack).toContain('font-weight="700" fill="#141414"');
    expect(stack).toContain('>3</text>');
  });

  it('is the same box, classes and anchor wherever it is laid, plus the caller’s own class', () => {
    const plain = placeMark();
    expect(plain).toMatchObject({ className: 'saved-mark-wrap', size: DROP.size, anchor: DROP.anchor });
    expect(plain.html).toBe(`<span class="place-drop">${placeDropSvg()}</span>`);
    expect(placeMark({ className: 'sat-ghost' }).className).toBe('saved-mark-wrap sat-ghost');
    expect(placeMark({ worked: true }).html).toContain('<i class="place-drop-worked"></i>');
  });

  it('states the same drop the extension draws on other people’s maps', () => {
    const source = readFileSync(new URL('../../../extension/mapdraw.js', import.meta.url), 'utf8');
    expect(source).toContain(`const DROP_PATH = "${DROP_PATH}";`);
    expect(source).toContain('const DROP = { size: [26, 36], anchor: [13, 35] };');
    expect(source).toContain(`const PLACE_RED = "${PLACE_RED}";`);
  });
});

describe('the marks painted onto a capture', () => {
  beforeAll(() => {
    globalThis.Path2D ??= class {
      constructor(d) {
        this.d = d;
      }
    };
  });

  it('paints a place’s drop with its tip on the point, at the capture’s scale, in its colour', () => {
    const ctx = recorder();
    paintPlaceDrop(ctx, 40, 60, { colour: '#00ff00', scale: 2 });
    expect(ctx.calls[1]).toEqual(['translate', 40, 60]);
    expect(ctx.calls[2]).toEqual(['scale', 2, 2]);
    expect(ctx.calls).toContainEqual(['translate', -13, -35]);
    expect(ctx.calls).toContainEqual(['=fillStyle', '#00ff00']);
    const body = ctx.calls.find(([name, path]) => name === 'fill' && path?.d);
    expect(body[1].d).toBe(DROP_PATH);
    // the white heart, no count
    expect(ctx.calls).toContainEqual(['arc', 13, 12.5, 4.6, 0, Math.PI * 2]);
    expect(ctx.calls.some(([name]) => name === 'fillText')).toBe(false);
  });

  it('counts a stack in the heart, and puts the proof’s dot on the shoulder', () => {
    const ctx = recorder();
    paintPlaceDrop(ctx, 0, 0, { count: 4, worked: true });
    expect(ctx.calls).toContainEqual(['fillText', '4', 13, 16.5]);
    expect(ctx.calls).toContainEqual(['arc', 22, 4, 4, 0, Math.PI * 2]);
  });

  it('paints a lead as the same drop, numbered in white in its scene’s colour', () => {
    const ctx = recorder();
    paintLeadDrop(ctx, 5, 5, { n: 12, colour: '#ff5252' });
    expect(ctx.calls).toContainEqual(['=fillStyle', '#ff5252']);
    expect(ctx.calls).toContainEqual(['fillText', '12', 13, 16.5]);
    expect(ctx.calls).toContainEqual(['=font', '700 9.5px system-ui, sans-serif']);
  });

  it('paints a file’s turned teardrop with its glyph and its count', () => {
    const ctx = recorder();
    paintTeardrop(ctx, 0, 0, { fill: '#e8a33d', ring: '#fff', ink: '#141414', glyph: 'M1 1', count: 2 });
    expect(ctx.calls).toContainEqual(['rotate', -Math.PI / 4]);
    expect(ctx.calls.find(([name, path]) => name === 'stroke' && path?.d === 'M1 1')).toBeTruthy();
    expect(ctx.calls.some(([name, text]) => name === 'fillText' && text === '2')).toBe(true);
  });

  it('paints the analyst’s pin on its tip and the crosshair on its gap, and nothing for none', () => {
    const pin = recorder();
    paintMarker(pin, 10, 20, 'pin');
    expect(pin.calls).toContainEqual(['translate', -15, -42]);
    const cross = recorder();
    paintMarker(cross, 10, 20, 'crosshair');
    expect(cross.calls).toContainEqual(['moveTo', 7, 0]);
    const none = recorder();
    paintMarker(none, 10, 20, 'none');
    expect(none.calls).toEqual([]);
  });

  it('writes a name under its point, white on a dark halo', () => {
    const ctx = recorder();
    paintName(ctx, 10, 20, 'North depot', { scale: 2 });
    expect(ctx.calls).toContainEqual(['strokeText', 'North depot', 0, NAME_GAP]);
    expect(ctx.calls).toContainEqual(['fillText', 'North depot', 0, NAME_GAP]);
    const empty = recorder();
    paintName(empty, 0, 0, '');
    expect(empty.calls).toEqual([]);
  });
});
