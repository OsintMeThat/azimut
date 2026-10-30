/**
 * Film the welcome's opening picture: a dive from the whole Earth into Yosemite Valley
 * on the app's own globe, then a slow turn round Half Dome.
 *
 *     npm run guide:hero               # films it into src/assets/welcome/
 *     npm run guide:hero -- --stills   # six frames along the way into a temporary
 *                                      # folder, to set the camera
 *
 * Starts a private Azimut on a throwaway workspace with USGS's public-domain imagery
 * added as a user adds a provider, serves `guide/hero/record.html`, the globe alone on
 * a page, and steps the camera one frame at a time. Down to level 8 that imagery is one
 * world mosaic (NASA's Blue Marble); from 9 it is regional mosaics with holes outside
 * the US, then aerial photographs. So the dive is drawn on the world mosaic alone, and
 * dissolves into the full imagery once the view holds nothing but California. Each frame is taken only once every
 * tile it wants is drawn: ground arriving in patches flickers, which a film opening on
 * its own must never do. ffmpeg then fades it in from black and out to black, so the
 * loop never cuts, and writes the WebM beside a still for readers who ask for less
 * motion (components/Onboarding.svelte).
 *
 * Needs `uv` for the backend, ffmpeg on PATH, and the network for the imagery and the
 * relief. Film it again when the globe's look changes, and look at it before it lands.
 */

import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, loadConfigFromFile, mergeConfig } from 'vite';

import { IMAGERY } from './demo.mjs';

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(frontend, '..');
const OUT = join(frontend, 'src/assets/welcome');

const API_PORT = Number(process.env.HERO_API_PORT ?? 18573);
const WEB_PORT = Number(process.env.HERO_WEB_PORT ?? 18574);
const api = `http://127.0.0.1:${API_PORT}`;
const web = `http://127.0.0.1:${WEB_PORT}`;

/** The film's frame, in pixels: twice the width the welcome shows it at, on a wide strip. */
const FRAME = { width: 1440, height: 640 };
const FPS = 25;
/** The dive, then the turn, in seconds. */
const DIVE = 6.5;
const TURN = 6;
/** The fades at each end, in seconds: the loop goes through black, never through a cut. */
const FADE_IN = 0.8;
const FADE_OUT = 1;
/** The film's rate: about 2.8 MB for its 12.5 seconds. */
const RATE = '1800k';

/** The same imagery stopped at its world mosaic, a provider of its own so the globe keeps the two apart. */
const WORLD = { ...IMAGERY, id: 'usgs-imagery-world', label: 'USGS Imagery, world mosaic', max_zoom: 8 };
/** The zooms the world mosaic dissolves into the full imagery over. */
const DISSOLVE = { from: 9.2, to: 10.4 };
const asked = (provider) => ({ id: provider.id, metered: false, cell: 256, deepest: provider.max_zoom, shallowest: 0 });

/** Where the film ends up: the valley floor by Yosemite Village, Half Dome ahead. */
const TARGET = { lat: 37.7435, lon: -119.575 };
/** From the whole Earth to the valley, in the app's zoom. */
const ZOOM = { from: 2.6, to: 13.4, end: 13.7 };
/** Straight down at first, then leaning in to the walls. */
const PITCH = { to: 72, end: 75 };
/**
 * North up over the whole Earth, then facing up the valley, east-north-east, and
 * turning on round it the same way, degrees a second. The app's bearing turns the map,
 * so the way the eye faces is its opposite.
 */
const BEARING = { from: 0, to: -80, spin: -5 };

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

const clamp = (v) => Math.min(1, Math.max(0, v));
/** Slow at both ends, with no jolt where it starts or stops. */
const smooth = (t) => t * t * t * (t * (6 * t - 15) + 10);

/**
 * The camera at `t` seconds. The dive keeps one centre, so the ground under it never
 * slides, and eases its zoom; the lean and the turn come in its second half, the turn
 * arriving at the speed the orbit then keeps, so the two read as one movement.
 */
function cameraAt(t, elevation) {
  if (t <= DIVE) {
    const u = t / DIVE;
    const zoom = ZOOM.from + (ZOOM.to - ZOOM.from) * smooth(u);
    // straight down through the middle zooms: a tilt there looks far over ground the
    // imagery only has in patches, some of them black
    const lean = smooth(clamp((u - 0.45) / 0.55));
    // a cubic from standing still to the orbit's speed, ending on its first bearing
    const s = clamp((u - 0.35) / 0.65);
    const span = DIVE * 0.65;
    const rest = (1 - s) * (1 - s) * (1 + 2 * s);
    const bearing = BEARING.from * rest + BEARING.to * (1 - rest) + BEARING.spin * span * s * s * (s - 1);
    return { ...TARGET, zoom, pitch: PITCH.to * lean, bearing, elevation };
  }
  const v = (t - DIVE) / TURN;
  return {
    ...TARGET,
    zoom: ZOOM.to + (ZOOM.end - ZOOM.to) * smooth(v),
    pitch: PITCH.to + (PITCH.end - PITCH.to) * smooth(v),
    bearing: BEARING.to + BEARING.spin * (t - DIVE),
    elevation,
  };
}

function ffmpeg(args) {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

async function main() {
  const stills = process.argv.includes('--stills');
  const scratch = mkdtempSync(join(tmpdir(), 'azimut-hero-'));
  const home = join(scratch, 'workspace');
  const frames = join(scratch, 'frames');
  // the stills outlive the run, in a folder of their own, never beside the film
  const kept = stills ? join(tmpdir(), 'azimut-hero-stills') : frames;
  mkdirSync(join(home, '.azimut/settings'), { recursive: true });
  mkdirSync(kept, { recursive: true });
  writeFileSync(
    join(home, '.azimut/settings/settings.json'),
    JSON.stringify({ tile_providers: [IMAGERY, WORLD], update_check_on_start: false, tour: 'done' })
  );
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
  try {
    await until('the backend', async () => (await fetch(`${api}/api/cases`)).ok);
    const { config } = await loadConfigFromFile({ command: 'serve', mode: 'development' }, join(frontend, 'vite.config.js'));
    const served = mergeConfig(config, {
      root: frontend,
      configFile: false,
      logLevel: 'warn',
      cacheDir: join(scratch, 'vite'),
      server: { host: '127.0.0.1', port: WEB_PORT, strictPort: true, hmr: false, proxy: { '/api': api } },
    });
    // nothing changes under a film: no file watchers, which a busy machine may be out of
    served.server.watch = null;
    vite = await createServer(served);
    await vite.listen();

    browser = await chromium.launch({
      channel: 'chromium',
      args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'],
    });
    const page = await browser.newPage({ viewport: FRAME, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => say(`page: ${error.message}`));
    await page.goto(`${web}/guide/hero/record.html`);
    await page.waitForFunction(() => window.hero, null, { timeout: 30_000 });
    if (!(await page.evaluate(() => window.hero.ready))) throw new Error('this browser gave the globe no WebGL2');
    const { elevation } = await (await fetch(`${api}/api/terrain/elevation?lat=${TARGET.lat}&lon=${TARGET.lon}`)).json();
    say(`the valley floor stands at ${Math.round(elevation)} m`);

    const total = Math.round((DIVE + TURN) * FPS);
    const picked = stills ? [0, 0.3, 0.55, 0.75, 0.9, 1].map((share) => Math.round(share * (total - 1))) : [...Array(total).keys()];
    let short = 0;
    for (const [at, frame] of picked.entries()) {
      const camera = cameraAt(frame / FPS, elevation);
      const share = smooth(clamp((camera.zoom - DISSOLVE.from) / (DISSOLVE.to - DISSOLVE.from)));
      await page.evaluate((view) => window.hero.place(view), camera);
      const { png, complete } = await page.evaluate(
        ([mix, timeout]) => window.hero.frame(mix, timeout),
        [{ under: asked(WORLD), over: asked(IMAGERY), share }, 45_000]
      );
      if (!complete) short += 1;
      const name = stills ? `still-${frame}.png` : `${String(at).padStart(4, '0')}.png`;
      writeFileSync(join(kept, name), Buffer.from(png.split(',')[1], 'base64'));
      if (!stills && at % FPS === 0) say(`${at / FPS} s of ${(total / FPS).toFixed(1)}`);
    }
    if (short) say(`${short} frame(s) drawn before every tile came: look at the film before keeping it`);
    if (stills) {
      say(`stills in ${kept}`);
      return;
    }

    const seconds = total / FPS;
    mkdirSync(OUT, { recursive: true });
    // two passes at a set rate, so the film's weight in every download is known ahead
    const encode = (pass, target) => [
      '-framerate', String(FPS), '-i', join(frames, '%04d.png'),
      '-vf', `fade=t=in:st=0:d=${FADE_IN},fade=t=out:st=${(seconds - FADE_OUT).toFixed(2)}:d=${FADE_OUT},format=yuv420p`,
      '-c:v', 'libvpx-vp9', '-b:v', RATE, '-pass', String(pass), '-passlogfile', join(scratch, 'pass'),
      '-row-mt', '1', '-deadline', 'good', '-cpu-used', pass === 1 ? '4' : '1', '-an',
      ...target,
    ];
    ffmpeg(encode(1, ['-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null']));
    ffmpeg(encode(2, [join(OUT, 'hero.webm')]));
    // the still: the valley a moment into the turn, for a reader who asked for less motion
    const still = String(Math.round((DIVE + TURN * 0.35) * FPS)).padStart(4, '0');
    ffmpeg(['-i', join(frames, `${still}.png`), '-c:v', 'libwebp', '-quality', '84', join(OUT, 'hero.webp')]);
    say(`filmed ${seconds.toFixed(1)} s into ${OUT}`);
  } finally {
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
