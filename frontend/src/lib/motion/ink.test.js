// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { URL as FileURL, fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ink, inkTransform } from './ink.js';

// node's URL: happy-dom's own is not one readFileSync takes
const css = readFileSync(fileURLToPath(new FileURL('../../app.css', import.meta.url)), 'utf8');

/** A child with the offsets a laid-out page would give it. */
function child(box, active = false) {
  const el = document.createElement('button');
  for (const [key, value] of Object.entries(box)) Object.defineProperty(el, key, { value, configurable: true });
  if (active) el.classList.add('active');
  return el;
}

let strip;
let frames;

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (fn) => frames.push(fn));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  strip = document.createElement('nav');
  document.body.append(strip);
});

afterEach(() => {
  strip.remove();
  vi.unstubAllGlobals();
});

const flush = () => frames.splice(0).forEach((fn) => fn());

describe('inkTransform', () => {
  it('lays the mark across a tab or down a rail stage', () => {
    const tab = child({ offsetLeft: 40, offsetWidth: 72, offsetTop: 0, offsetHeight: 30 });
    expect(inkTransform(tab, 'x')).toBe('translateX(40px) scaleX(72)');
    expect(inkTransform(tab, 'y')).toBe('translateY(0px) scaleY(30)');
  });
});

describe('ink', () => {
  it('puts the mark on the chosen child, and follows the choice when it moves', async () => {
    const first = child({ offsetLeft: 10, offsetWidth: 60, offsetTop: 0, offsetHeight: 30 }, true);
    const second = child({ offsetLeft: 74, offsetWidth: 90, offsetTop: 0, offsetHeight: 30 });
    const mark = document.createElement('span');
    mark.className = 'ink';
    strip.append(first, second, mark);

    const action = ink(strip, 'x');
    flush();
    expect(mark.style.transform).toBe('translateX(10px) scaleX(60)');
    expect(mark.style.opacity).toBe('1');
    // the first placement lands; only later ones slide
    expect(mark.classList.contains('ink-instant')).toBe(false);

    first.classList.remove('active');
    second.classList.add('active');
    await Promise.resolve(); // the observer reports
    flush();
    expect(mark.style.transform).toBe('translateX(74px) scaleX(90)');
    action.destroy();
  });

  it('fades the mark out when nothing is chosen', () => {
    const mark = document.createElement('span');
    mark.className = 'ink';
    strip.append(child({ offsetLeft: 0, offsetWidth: 50, offsetTop: 0, offsetHeight: 30 }), mark);
    const action = ink(strip, 'y');
    flush();
    expect(mark.style.opacity).toBe('0');
    action.destroy();
  });
});

describe('motion tokens', () => {
  it('drops every travel, scale and slide under reduced motion, keeping the fades', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  :root {'));
    const block = reduced.slice(0, reduced.indexOf('\n}\n'));
    for (const zero of ['--motion-slide: 0ms', '--motion-stagger: 0ms', '--motion-shift: 0px', '--motion-shift-lg: 0px', '--motion-scale: 1', '--motion-press-scale: 1']) {
      expect(block).toContain(zero);
    }
    expect(block).not.toContain('--motion-pop');
    expect(block).not.toContain('--motion-move');
  });

  it('moves only transform and opacity in the shared entrances', () => {
    for (const [, body] of css.matchAll(/@keyframes motion-[a-z-]+ \{([^}]*\})\s*\}/g)) {
      const props = [...body.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
      expect(props.every((p) => p === 'opacity' || p === 'transform'), body).toBe(true);
    }
  });
});
