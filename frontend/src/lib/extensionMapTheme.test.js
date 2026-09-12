// @vitest-environment happy-dom
/**
 * The app's look, on both sides of a boundary it cannot be imported across.
 *
 * `extension/maptheme.js` is a copy of things the app already states: the design
 * tokens in `app.css`, the icon paths in `components/Icon.svelte`, the cell and
 * measure styles the map tools paint with. A copy is normally how two surfaces
 * start drifting apart, and the drift here is the kind nobody files a bug about
 * — an amber that is one step off, an icon that is last year's. So both sides
 * are read here and compared exactly.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { paths } from '../components/Icon.svelte';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');

let theme;

beforeAll(() => {
  const scope = { window: {} };
  new Function('window', read('../../../extension/maptheme.js'))(scope.window);
  theme = scope.window.AzimutMapTheme;
});

/** One `--name: value;` out of the app's stylesheet, from the dark theme block
 *  at the top — which is the one the panel is painted in. */
function token(name) {
  const css = read('../app.css');
  const match = new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm').exec(css);
  return match?.[1].trim();
}

describe('the palette', () => {
  it('is the app’s, token for token', () => {
    for (const [key, name] of [
      ['bg0', 'bg-0'],
      ['bg1', 'bg-1'],
      ['bg2', 'bg-2'],
      ['bg3', 'bg-3'],
      ['text1', 'text-1'],
      ['text2', 'text-2'],
      ['text3', 'text-3'],
      ['accent', 'accent'],
      ['accentText', 'accent-text'],
      ['danger', 'danger'],
      ['warn', 'warn'],
      ['skySun', 'sky-sun'],
      ['skyMoon', 'sky-moon'],
    ]) {
      expect(theme.TOKENS[key], name).toBe(token(name));
    }
  });
});

describe('the icons', () => {
  it('are the app’s own paths', () => {
    for (const [name, path] of Object.entries(theme.ICONS)) {
      expect(paths[name], name).toBe(path);
    }
  });

  it('covers every glyph the panel and the marks draw', () => {
    const used = [
      ...Object.values(theme.SAVED_GLYPH),
      'ruler', 'pin', 'sun', 'grid', 'polygon', 'square', 'x', 'check', 'undo',
      'save', 'trash', 'eye', 'eyeOff', 'crosshair', 'chevronUp', 'chevronDown', 'alert',
      'image', 'video', 'grip', 'minimize',
    ];
    for (const name of used) expect(theme.ICONS, name).toHaveProperty(name);
  });

  it('draws one as an inline svg, and falls back rather than drawing nothing', () => {
    expect(theme.icon('ruler', 16)).toContain(paths.ruler);
    expect(theme.icon('ruler', 16)).toContain('width="16"');
    expect(theme.icon('no-such-icon')).toContain(paths.alert);
  });
});

describe('the paint the tools use', () => {
  /** The app's own style objects, read out of the module that owns them. */
  function appStyles() {
    const src = read('../tools/satellite/state/grid.svelte.js');
    const block = /const CELL_STYLE = \{([\s\S]*?)\n\};/.exec(src)[1];
    // eslint-disable-next-line no-new-func
    return new Function(`return {${block}}`)();
  }

  it('paints a cell exactly as Grid Search paints it', () => {
    const app = appStyles();
    for (const status of ['unchecked', 'cleared', 'flagged']) {
      expect(theme.CELL_STYLE[status], status).toEqual(app[status]);
    }
  });

  it('paints the area outline and the measure line as the app does', () => {
    const grid = read('../tools/satellite/state/grid.svelte.js');
    const measure = read('../tools/satellite/state/measure.svelte.js');
    // the app writes its dash as an SVG string; the canvas wants a pair
    expect(/const AOI_STYLE = \{[\s\S]*?stroke: '(#\w+)'/.exec(grid)[1]).toBe(theme.AOI_STYLE.stroke);
    expect(/const AOI_STYLE = \{[\s\S]*?dash: '(\d+ \d+)'/.exec(grid)[1]).toBe(theme.AOI_STYLE.dash.join(' '));
    expect(/const STROKE = \{ stroke: '(#\w+)', strokeWidth: ([\d.]+)/.exec(measure).slice(1)).toEqual([
      theme.MEASURE_STROKE.stroke,
      String(theme.MEASURE_STROKE.strokeWidth),
    ]);
  });

  it('names the same glyph for a saved row as the Saved layer', () => {
    const overlay = read('../tools/satellite/SavedOverlay.svelte');
    const block = /const GLYPH = \{([^}]*)\}/.exec(overlay)[1];
    // eslint-disable-next-line no-new-func
    expect(theme.SAVED_GLYPH).toEqual(new Function(`return {${block}}`)());
  });
});
