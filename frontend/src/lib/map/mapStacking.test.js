import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

/**
 * Who sits over whom on a map.
 *
 * The engine parks its own control corners at `z-index: 2`, far under the
 * overlays every tool paints on the ground. Left alone, the zoom buttons, the
 * attribution and the split handle end up behind a translucent layer: still
 * there, still clickable, and looking broken.
 *
 * Three bands, and this is the gate on them:
 *   ground overlays   500–579   what is drawn on the earth
 *   map controls      580       the engine's corners, the split handle
 *   tool chrome       600+      chips, panels, menus
 *
 * A new overlay drawn on the ground joins GROUND below. If it needs to sit over
 * the zoom buttons it is not ground, it is chrome, and it belongs at 600+.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

/** The z-index a selector's block declares, in the source given. */
function zOf(source, selector) {
  const at = source.indexOf(selector);
  expect(at, `${selector} is not in the source any more`).toBeGreaterThan(-1);
  const found = /z-index:\s*(-?\d+)/.exec(source.slice(at));
  expect(found, `${selector} declares no z-index`).not.toBe(null);
  return Number(found[1]);
}

/** Every layer painted on the ground, with the selector that carries its z-index. */
const GROUND = [
  ['tools/detect/RuleLayers.svelte', '.rule-layers {'],
  ['tools/detect/DetectAreas.svelte', '.detect-areas {'],
  ['tools/detect/AnalysisOverlay.svelte', '.analysis-overlay {'],
  ['tools/detect/CheckMarks.svelte', '.mark {'],
];

it('keeps the engine’s own controls above everything drawn on the ground', () => {
  const engine = read('lib/map/engine.css');
  const controls = zOf(engine, '.maplibregl-ctrl-top-left,');
  expect(controls).toBeGreaterThanOrEqual(580);

  for (const [path, selector] of GROUND) {
    const z = zOf(read(path), selector);
    expect(z, `${selector} would cover the zoom buttons`).toBeLessThan(controls);
  }
});

it('lets the map’s controls out of the map, where the ground overlays are', () => {
  // The engine isolates its map for the widget basemap's negative layer. Left
  // so, the 580 above means nothing: the corners stay inside the map, and every
  // overlay laid beside it paints over the whole map, buttons included. The
  // surface lifts that isolation and holds the stacking context itself.
  const surface = read('tools/satellite/MapSurface.svelte');
  const lifted = /\n  \.map \{([^}]*)\}/.exec(surface);
  expect(lifted, 'MapSurface no longer styles its map').not.toBe(null);
  expect(lifted[1]).toMatch(/isolation:\s*auto/);
  expect(/\.map-wrap \{[^}]*isolation:\s*isolate/.test(surface)).toBe(true);
  // a fade goes through the engine's own rule, which leaves the corners whole,
  // since a faded map would be a stacking context again
  expect(read('lib/map/engine.css')).toMatch(/:not\(\.maplibregl-control-container\) \{\s*opacity: var\(--map-fade, 1\)/);
  expect(read('tools/Compare.svelte')).not.toMatch(/:global\(\.map\)[^{]*\{[^}]*opacity/);
});

it('opens a place search’s suggestions over the controls stacked under it', () => {
  // At the same z-index, the control later in the page paints over the list.
  const horizon = read('tools/horizon/MapNavigation.svelte');
  expect(zOf(horizon, '.map-search {')).toBeGreaterThan(zOf(horizon, '.map-compass {'));
  const detect = read('tools/Detect.svelte');
  expect(zOf(detect, '.search {')).toBeGreaterThan(zOf(detect, '.ruler {'));
  expect(zOf(detect, '.search {')).toBeGreaterThan(zOf(detect, '.map-choices {'));
});

it('keeps the split handle level with the controls, not with the ground', () => {
  // Inside the second map's own layer the handle was trapped in that stacking
  // context, and every overlay painted over it. It rides in its own rail.
  const source = read('tools/detect/SecondPass.svelte');
  const controls = zOf(read('lib/map/engine.css'), '.maplibregl-ctrl-top-left,');
  expect(zOf(source, '.split-rail')).toBe(controls);
  // and the map underneath it stays below the ground overlays
  expect(zOf(source, '.second ')).toBeLessThan(500);
});

it('leaves the tool’s own chrome above the controls', () => {
  // A chip or a panel the analyst reads has to clear the zoom buttons.
  const controls = zOf(read('lib/map/engine.css'), '.maplibregl-ctrl-top-left,');
  for (const [path, selector] of [
    ['tools/detect/CheckBench.svelte', '.bench-root'],
    ['tools/satellite/MapStatusBar.svelte', '.status {'],
  ]) {
    expect(zOf(read(path), selector), `${selector} would hide under the controls`)
      .toBeGreaterThan(controls);
  }
});
