/**
 * TEMPORARY — why the map does not come up on the CI runner's Firefox.
 *
 * Everything else about this failure has been read from the outside: the specs
 * say `data-map-ready` never appears, and every guess at the cause so far
 * (WebGL turned off by the blocklist, then no software renderer installed) has
 * been a guess. This asks the browser itself and prints the answer, so the next
 * change is aimed at something.
 *
 * Named to sort first, so its output is at the top of a nineteen-minute log.
 * Delete it once the cause is known.
 */
import { test, expect } from '@playwright/test';
import { installAppFixture } from './app.fixture.js';

test('what the map says on the way up', async ({ page, browserName }) => {
  const notes = [];
  page.on('console', (m) => notes.push(`console.${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => notes.push(`pageerror: ${e.message}`));

  await installAppFixture(page);
  await page.goto('/#satellite');

  // Straight at the engine's requirement, before the app's own attempt is read.
  const gl = await page.evaluate(() => {
    const out = {};
    for (const kind of ['webgl2', 'webgl', 'experimental-webgl']) {
      try {
        const ctx = document.createElement('canvas').getContext(kind);
        out[kind] = ctx ? 'yes' : 'null';
        if (ctx && !out.renderer) {
          out.renderer = String(ctx.getParameter(ctx.RENDERER));
          out.vendor = String(ctx.getParameter(ctx.VENDOR));
          out.version = String(ctx.getParameter(ctx.VERSION));
        }
      } catch (e) {
        out[kind] = `threw: ${e.message}`;
      }
    }
    return out;
  });

  // Three outcomes tell three different stories: ready (it worked), refused (the
  // engine threw and the tool caught it), neither (the load event never came).
  await page.waitForTimeout(15000);
  const state = await page.evaluate(() => ({
    map: document.querySelector('.map')?.dataset.mapReady ?? 'no .map element',
    refused: !!document.querySelector('.map-refused'),
    canvases: document.querySelectorAll('canvas').length,
  }));

  console.log(`\n===== map probe (${browserName}) =====`);
  console.log(`webgl: ${JSON.stringify(gl)}`);
  console.log(`state: ${JSON.stringify(state)}`);
  console.log(`page said:\n${notes.join('\n') || '(nothing)'}`);
  console.log('===== end map probe =====\n');

  // It reports; it does not judge. A red probe would only hide its own output.
  expect(typeof state.map).toBe('string');
});
