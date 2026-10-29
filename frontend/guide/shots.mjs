/**
 * Photograph the guide's pages in the real app.
 *
 *     npm run guide:shots                  # every picture
 *     npm run guide:shots -- media proof   # only these, and the ones they start from
 *
 * Starts a private Azimut on a throwaway workspace, files the demo case into it through
 * the routes the app itself uses (demo.mjs), serves the current frontend over it, and
 * takes each picture `src/lib/guide.js` names, staged as stages.mjs says. Writes
 * `src/assets/guide/<shot>.webp` and, beside it, `<shot>.json`: the rectangle of every
 * `data-guide` anchor drawn on that picture.
 *
 * A picture keeps the part of the window its frames are in, plus a margin, so a page
 * shows the controls it explains rather than the whole app. It fails when an anchor the
 * guide cites is missing: a control that moved is followed, a control that went is
 * reported instead of framed in the void.
 *
 * The Extension tabs are taken in a second browser with the capture extension loaded
 * (extension.mjs), over OpenStreetMap's own tiles.
 *
 * Needs `uv` for the backend, ffmpeg on PATH for the demo video, and the network for the
 * public imagery and the map tiles the pictures are drawn from. Horizon draws 3D, so the
 * browser asks for the GPU and falls back to software where there is none. Run it
 * before a release, look at the pictures it changed, and commit them with the release.
 */

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer, loadConfigFromFile, mergeConfig, preview } from 'vite';

import { copyPasses } from './airbase.mjs';
import { buildDemo, CHANNEL, IMAGERY } from './demo.mjs';
import { openExtension } from './extension.mjs';
import { DEFAULT_WINDOW, STAGES } from './stages.mjs';

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(frontend, '..');
const OUT = join(frontend, 'src/assets/guide');

const API_PORT = Number(process.env.GUIDE_API_PORT ?? 18571);
const WEB_PORT = Number(process.env.GUIDE_WEB_PORT ?? 18572);
const api = `http://127.0.0.1:${API_PORT}`;
const web = `http://127.0.0.1:${WEB_PORT}`;

/** The tool, without the app's bars: the guide's own menu and tabs stand for them. */
const CLIP = 'main.canvas .canvas-body';
/** Room kept round the frames when a picture is cut down to them, in CSS pixels. */
const MARGIN = 28;
/** The tallest a picture may be against its width, so the guide shows it whole. */
const LANDSCAPE = 0.66;
/** Anchors that frame a group of controls rather than the first one found. */
const UNION = new Set(['start.stages', 'start.tabs', 'notebook.insert', 'compare.session', 'proof.save', 'proof.meta', 'inspect.file', 'horizon.views']);

const say = (line) => process.stdout.write(`  ${line}\n`);
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function until(what, test, timeout = 60_000) {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      if (await test()) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > end) throw new Error(`gave up waiting for ${what}`);
    await pause(250);
  }
}

async function call(method, path, body) {
  const send = () =>
    fetch(`${api}${path}`, {
      method,
      headers: body instanceof FormData || !body ? undefined : { 'content-type': 'application/json' },
      body: body instanceof FormData ? body : body && JSON.stringify(body),
    });
  // The server drops a kept-alive connection after a few idle seconds (an ffmpeg encode
  // is enough), and a request sent on it as it closes fails before reaching it. Once
  // more on a fresh connection is safe: that request never arrived.
  const response = await send().catch((error) => {
    if (error?.message !== 'fetch failed') throw error;
    return send();
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

/** Where each anchor and focus element stands, and the part of the clip that holds them. */
async function measure(page, { anchors, clip, crop, focus }) {
  return page.evaluate(
    ({ anchors, clip, crop, focus, union, margin, landscape }) => {
      const seen = (el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0 ? box : null;
      };
      const frame = document.querySelector(clip).getBoundingClientRect();
      const boxes = {};
      const problems = [];
      for (const anchor of anchors) {
        const shown = [...document.querySelectorAll(`[data-guide="${anchor}"]`)].map(seen).filter(Boolean);
        if (!shown.length) {
          problems.push(`${anchor} is not on the page`);
          continue;
        }
        const taken = union.includes(anchor) ? shown : shown.slice(0, 1);
        const left = Math.min(...taken.map((b) => b.left));
        const top = Math.min(...taken.map((b) => b.top));
        const right = Math.max(...taken.map((b) => b.right));
        const bottom = Math.max(...taken.map((b) => b.bottom));
        boxes[anchor] = { left, top, right, bottom };
      }
      const held = [...Object.values(boxes)];
      for (const selector of focus) {
        const el = [...document.querySelectorAll(selector)].find(seen);
        if (el) {
          const b = el.getBoundingClientRect();
          held.push({ left: b.left, top: b.top, right: b.right, bottom: b.bottom });
        } else problems.push(`${selector} is not on the page`);
      }
      // the part kept: the whole clip, or what the frames and focus need with a margin
      let cut = { left: frame.left, top: frame.top, right: frame.right, bottom: frame.bottom };
      if (crop !== 'full' && held.length) {
        cut = {
          left: Math.max(frame.left, Math.min(...held.map((b) => b.left)) - margin),
          top: Math.max(frame.top, Math.min(...held.map((b) => b.top)) - margin),
          right: Math.min(frame.right, Math.max(...held.map((b) => b.right)) + margin),
          bottom: Math.min(frame.bottom, Math.max(...held.map((b) => b.bottom)) + margin),
        };
        // never a sliver: a picture narrower than this reads as a crop, not a screen
        const grow = (lo, hi, least, min, max) => {
          const missing = Math.min(least, max - min) - (hi - lo);
          if (missing <= 0) return [lo, hi];
          let a = lo - missing / 2;
          let b = hi + missing / 2;
          if (a < min) [a, b] = [min, b + (min - a)];
          if (b > max) [a, b] = [a - (b - max), max];
          return [Math.max(min, a), Math.min(max, b)];
        };
        [cut.left, cut.right] = grow(cut.left, cut.right, 620, frame.left, frame.right);
        [cut.top, cut.bottom] = grow(cut.top, cut.bottom, 360, frame.top, frame.bottom);
        // a tall cut, a panel's column, takes in the screen beside it rather than
        // standing as a strip the guide would have to scroll through
        [cut.left, cut.right] = grow(cut.left, cut.right, (cut.bottom - cut.top) / landscape, frame.left, frame.right);
      }
      const round = (v) => Math.round(v * 10) / 10;
      const rects = Object.fromEntries(
        Object.entries(boxes).map(([anchor, b]) => {
          const x = Math.max(b.left, cut.left);
          const y = Math.max(b.top, cut.top);
          const w = Math.min(b.right, cut.right) - x;
          const h = Math.min(b.bottom, cut.bottom) - y;
          if (w < 4 || h < 4) {
            const at = [b.left, b.top, b.right, b.bottom].map(Math.round).join(', ');
            problems.push(`${anchor} lies outside the picture (at ${at}, the tool spans ${Math.round(frame.left)}–${Math.round(frame.right)} × ${Math.round(frame.top)}–${Math.round(frame.bottom)})`);
          }
          return [anchor, { x: round(x - cut.left), y: round(y - cut.top), w: round(w), h: round(h) }];
        })
      );
      return {
        cut: { x: cut.left, y: cut.top, width: cut.right - cut.left, height: cut.bottom - cut.top },
        rects,
        problems,
      };
    },
    { anchors, clip, crop, focus, union: [...UNION], margin: MARGIN, landscape: LANDSCAPE }
  );
}

/** A PNG of the cut, re-encoded as WebP by the browser that took it. */
async function photograph(page, cut) {
  const png = await page.screenshot({ clip: cut, animations: 'disabled', caret: 'hide' });
  const dataUrl = await page.evaluate(async (b64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${b64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toDataURL('image/webp', 0.86);
  }, png.toString('base64'));
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

/** Wait for the screen to stop changing: requests, fonts, every picture in the clip. */
async function settle(page, clip, extra) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page
    .waitForFunction(
      (clip) => [...document.querySelectorAll(`${clip} img`)].every((img) => img.complete && (img.naturalWidth > 0 || img.loading === 'lazy')),
      clip,
      { timeout: 20_000 }
    )
    .catch(() => say('  some pictures had not loaded'));
  await pause(extra);
}

async function run() {
  const wanted = process.argv.slice(2);
  const scratch = mkdtempSync(join(tmpdir(), 'azimut-guide-'));
  const home = join(scratch, 'workspace');
  // The public imagery the maps are drawn from, added as a user adds a provider; the
  // maps opening on the demo's ground; and a stand-in Copernicus id, so Detect shows
  // its tools rather than its setup. The id reaches nothing: no stage runs a detection.
  mkdirSync(join(home, '.azimut/settings'), { recursive: true });
  writeFileSync(
    join(home, '.azimut/settings/settings.json'),
    JSON.stringify({
      tile_providers: [IMAGERY],
      update_check_on_start: false,
      home_view: { ...CHANNEL, zoom: 15 },
      api_keys: { sentinelhub: 'guide-demo-instance' },
    })
  );
  // the two Sentinel-2 passes the analyzer journey is photographed on, from a tile cache
  // that already holds them: tiles only, so no Copernicus request is spent (airbase.mjs)
  const passes = copyPasses(home);
  say(passes ? `${passes} cached Sentinel-2 tile sets for the airbase` : 'no cached airbase passes: its pictures will fail');
  // a group of its own, so stopping it stops the app `uv` started too, not uv alone
  const own = process.platform !== 'win32';
  const backend = spawn('uv', ['run', 'azimut', '--port', String(API_PORT), '--no-browser'], {
    cwd: root,
    env: { ...process.env, AZIMUT_HOME: home },
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: own,
  });
  let vite = null;
  let browser = null;
  let ext = null;
  const failed = [];
  const made = [];
  try {
    await until('the backend', async () => (await fetch(`${api}/api/cases`)).ok);
    // The app as it ships, built into the scratch folder: a dev server reloads the page
    // whenever it meets a new dependency, which throws away what a stage set up. The
    // build never lands in src/azimut/static, which the owner's running app serves.
    const { config } = await loadConfigFromFile({ command: 'build', mode: 'production' }, join(frontend, 'vite.config.js'));
    const dist = join(scratch, 'dist');
    const shared = mergeConfig(config, { root: frontend, configFile: false, logLevel: 'warn', cacheDir: join(scratch, 'vite') });
    await build(mergeConfig(shared, { build: { outDir: dist, emptyOutDir: true } }));
    vite = await preview(
      mergeConfig(shared, {
        build: { outDir: dist },
        preview: { host: '127.0.0.1', port: WEB_PORT, strictPort: true, proxy: { '/api': api, '/files': api } },
      })
    );
    const reading = mergeConfig(shared, { server: { middlewareMode: true, hmr: false }, appType: 'custom' });
    // it only reads the guide's list: no file watchers, which a busy machine may be out of
    reading.server.watch = null;
    const loader = await createServer(reading);
    const { allShots } = await loader.ssrLoadModule('/src/lib/guide.js');
    await loader.close();
    const shots = new Map(allShots().map((one) => [one.shot, one.anchors]));

    const staged = new Set(STAGES.map((stage) => stage.shot));
    for (const name of shots.keys()) if (!staged.has(name)) failed.push(`${name} is in the guide but has no stage`);
    for (const name of staged) if (!shots.has(name)) failed.push(`${name} is staged but the guide shows no such picture`);
    if (failed.length) throw new Error(failed.join('\n'));

    // a picture taken from another needs that one staged first, and that one its own:
    // read last to first, a chain is followed back to its start in one pass
    const take = new Set(wanted.length ? wanted : staged);
    for (const stage of [...STAGES].reverse()) if (take.has(stage.shot) && stage.from) take.add(stage.from);

    // WebGL on the GPU for Horizon's 3D; 2D canvases in software, since a 2D canvas read
    // back under Vulkan comes out empty, and a proof saved from it is a blank picture
    browser = await chromium.launch({
      channel: 'chromium',
      args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-accelerated-2d-canvas'],
    });
    const demo = await buildDemo({ call, scratch });
    say(`demo case filed: ${demo.caseId}`);

    const context = await browser.newContext({
      viewport: DEFAULT_WINDOW,
      deviceScaleFactor: 2,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    // the tour, this version's What's new and Find's beta notice would cover every
    // picture: the workspace has taken the one and read the others (components/Onboarding.svelte)
    const { version } = await call('GET', '/api/health');
    await call('PUT', '/api/settings/prefs', { tour: 'done', whats_new_seen: version, find_beta_seen: true });
    await context.addInitScript(({ caseId }) => {
      localStorage.setItem('azimut:lastCase', caseId);
      localStorage.setItem('azimut:theme', 'dark');
    }, { caseId: demo.caseId });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    let loads = 0;
    const go = async (hash) => {
      loads += 1;
      await page.goto(`${web}/?load=${loads}#${hash}`);
      await page.locator(CLIP).waitFor();
      await page.addStyleTag({ content: '.toasts { display: none !important; }' });
      await pause(1200);
    };
    mkdirSync(OUT, { recursive: true });

    for (const stage of STAGES) {
      if (!take.has(stage.shot)) continue;
      const clip = stage.clip ?? CLIP;
      // the extension's pictures are taken in its own browser, on the map tab
      const outside = stage.browser === 'extension';
      try {
        if (outside && !ext) {
          const { ingest_token: token } = await call('POST', '/api/settings/ingest-token');
          ext = await openExtension({
            source: join(root, 'extension'),
            scratch,
            api,
            token,
            caseId: demo.caseId,
            view: { ...CHANNEL, zoom: 16 },
            window: stage.window ?? DEFAULT_WINDOW,
          });
        }
        const shooter = outside ? ext.map : page;
        if (!outside) await page.setViewportSize(stage.window ?? DEFAULT_WINDOW);
        if (stage.from) await pause(300);
        await stage.run({ page, go, demo, ext, passes });
        // The case sidebar is a second column the tool pages do not explain. A picture
        // taken from another keeps it as it was: pressing the toggle would close the
        // menu that picture is about.
        const sidebar = page.locator('aside[data-guide="start.sidebar"]');
        if (!outside && !stage.from && (await sidebar.isVisible()) !== Boolean(stage.sidebar)) {
          await page.locator('.topbar button[title="Toggle case sidebar"]').click();
        }
        await settle(shooter, clip, stage.settle ?? (stage.map ? 5000 : 800));
        await shooter.mouse.move(1, 1);
        // no caret or focus ring on the field the stage typed in; a picture taken from
        // another keeps its focus, which may be what holds its menu open
        if (!stage.from) await shooter.evaluate(() => document.activeElement?.blur?.());
        const anchors = shots.get(stage.shot);
        const { cut, rects, problems } = await measure(shooter, {
          anchors,
          clip,
          crop: stage.crop,
          focus: stage.focus ?? [],
        });
        if (problems.length) throw new Error(problems.join('; '));
        const picture = await photograph(shooter, cut);
        writeFileSync(join(OUT, `${stage.shot}.webp`), picture);
        writeFileSync(
          join(OUT, `${stage.shot}.json`),
          `${JSON.stringify({ width: Math.round(cut.width), height: Math.round(cut.height), anchors: rects }, null, 2)}\n`
        );
        made.push(stage.shot);
        say(`${stage.shot}.webp  ${Math.round(picture.length / 1024)} kB, ${Object.keys(rects).length} frames`);
      } catch (error) {
        failed.push(`${stage.shot}: ${String(error.message ?? error).split('\n')[0]}`);
        // what the screen showed when it failed, for whoever is fixing the stage
        if (process.env.GUIDE_DEBUG_DIR) {
          const shown = outside ? ext?.map : page;
          await shown?.screenshot({ path: join(process.env.GUIDE_DEBUG_DIR, `${stage.shot}.png`) }).catch(() => {});
        }
      } finally {
        // a picture taken from another one closes what it opened, for the next one
        if (stage.from && stage.after !== false) {
          if (stage.after) await stage.after({ page }).catch(() => {});
          else await page.keyboard.press('Escape').catch(() => {});
          await pause(300);
        }
      }
    }

    // a full run leaves no picture the guide no longer shows
    if (!wanted.length && !failed.length) {
      // a hidden entry is an editor's or a system's, never a picture
      for (const file of readdirSync(OUT)) {
        if (!file.startsWith('.') && !shots.has(file.replace(/\.(webp|json)$/, ''))) unlinkSync(join(OUT, file));
      }
    }
  } finally {
    await ext?.close();
    await browser?.close();
    await vite?.close();
    if (own) {
      try {
        process.kill(-backend.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    } else backend.kill();
    rmSync(scratch, { recursive: true, force: true });
  }
  if (failed.length) {
    process.stderr.write(`\nSome pictures could not be made:\n${failed.map((f) => `  ${f}`).join('\n')}\n`);
    process.exit(1);
  }
  say(`${made.length} pictures`);
}

run().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
