/**
 * Make the pictures and films What's new plays (`src/lib/whatsNew.json`, a page's `reel`).
 *
 *     npm run guide:news
 *
 * Starts a private Azimut on a throwaway workspace, opens the example case the app ships
 * (`engine/examplecase.py`) and has the app itself make what the pages show:
 * - three of its notes printed as PDF, five of their pages kept as pictures;
 * - its story written as an HTML page, filmed from its headline to its before and after;
 * - a web map of its two layers, made as Notebook › New › Web map makes one
 *   (`lib/notes/webMap.js`), its boats wearing the icon library's ship as an analyst would
 *   style them, written as an HTML page and filmed: the days played, a step, a layer hidden
 *   and shown again, a search and the card it opens;
 * - the home of a site as an analyst's GitHub Pages holds it (`scripts/whats_new_site.py`).
 * Writes them to `src/assets/news/` and removes what it no longer makes.
 *
 * Firefox's recorder films the pages as they play, in real time; each film is then encoded
 * in two passes at a set rate, so its weight in every download is known ahead. Needs `uv`,
 * ffmpeg and pdftoppm (poppler) on PATH, and reads nothing from the network. Run it before a
 * release, with guide:shots, look at what it changed, and commit it with the release.
 */
import { firefox } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadConfigFromFile, mergeConfig, preview } from 'vite';

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(frontend, '..');
const OUT = join(frontend, 'src/assets/news');
const API_PORT = 18621;
const WEB_PORT = 18622;
const SITE_PORT = 18623;
const api = `http://127.0.0.1:${API_PORT}`;
const web = `http://127.0.0.1:${WEB_PORT}`;

/** The example case as the app names it (`engine/examplecase.py`). */
const EXAMPLE = 'Example case (fictional)';
const STORY = 'The night the sea came into Saltmere';
const REGISTER = 'Boats lost at Saltmere, the register';
const DAMAGE = 'Damage on Beach Road, an assessment';
const WEB_MAP = 'Saltmere after the storm';
/** The pages kept from each PDF, by the name What's new gives them. */
const PAGES = [
  ['report-glance', REGISTER, 2],
  ['report-cover', DAMAGE, 1],
  ['report-story', STORY, 1],
  ['report-wall', REGISTER, 4],
  ['report-before-after', DAMAGE, 2],
];
/** How wide a film is written, and its rate: it plays in a room 720 px wide, twice that on a sharp screen. */
const FILM_WIDTH = 1400;

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
  const response = await fetch(`${api}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body && JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

function run(command, args, options = {}) {
  const done = spawnSync(command, args, { stdio: ['ignore', 'ignore', 'inherit'], ...options });
  if (done.error || done.status !== 0) throw new Error(`${command} ${args.slice(0, 3).join(' ')} failed${done.error ? `: ${done.error.message}` : ''}`);
}

/** A picture as WebP, its weight said. */
function webp(input, out, quality = 82) {
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-c:v', 'libwebp', '-quality', String(quality), out]);
  say(`${out.split(/[\\/]/).pop()}  ${Math.round(statSync(out).size / 1024)} kB`);
}

/**
 * A recording cut to [`from`, `to`] seconds, sped by `speed`, written as `<name>.webm` at
 * `rate`, and its first frame as `<name>.webp`, the still a reader who asked for less
 * motion is shown.
 */
function encode(input, name, { from, to, speed = 1, rate }, scratch) {
  const out = join(OUT, `${name}.webm`);
  const pass = (n, target) =>
    run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-ss', from.toFixed(2), '-to', to.toFixed(2), '-i', input,
      '-vf', `setpts=PTS/${speed},fps=25,scale=${FILM_WIDTH}:-2:flags=lanczos,format=yuv420p`,
      '-c:v', 'libvpx-vp9', '-b:v', rate, '-pass', String(n), '-passlogfile', join(scratch, `${name}-pass`),
      '-row-mt', '1', '-deadline', 'good', '-cpu-used', n === 1 ? '4' : '1', '-an', ...target,
    ]);
  pass(1, ['-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null']);
  pass(2, [out]);
  say(`${name}.webm  ${Math.round(statSync(out).size / 1024)} kB, ${((to - from) / speed).toFixed(1)} s`);
  const first = join(scratch, `${name}-first.png`);
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.2', '-i', out, '-frames:v', '1', first]);
  webp(first, join(OUT, `${name}.webp`));
}

/** A pointer drawn into the page, since a recording shows none: where the mouse is, and a ring where it presses. */
function drawPointer() {
  const pointer = document.createElement('div');
  pointer.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2l16 9-7 2-3 7z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><i></i>';
  Object.assign(pointer.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', transform: 'translate(-100px, -100px)', filter: 'drop-shadow(0 2px 3px rgba(0, 0, 0, 0.5))' });
  const ring = pointer.querySelector('i');
  Object.assign(ring.style, { position: 'absolute', left: '-14px', top: '-14px', width: '28px', height: '28px', borderRadius: '50%', border: '3px solid #fff', opacity: '0' });
  document.body.append(pointer);
  addEventListener('mousemove', (event) => (pointer.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`), true);
  addEventListener('mousedown', () => ring.animate([{ opacity: 0.95, transform: 'scale(0.5)' }, { opacity: 0, transform: 'scale(2.3)' }], { duration: 520, easing: 'ease-out' }), true);
}

/** Scroll to `to` in `ms`, eased at both ends as a reader's hand does. */
const glide = (page, to, ms) =>
  page.evaluate(
    ([to, ms]) =>
      new Promise((done) => {
        const from = scrollY;
        const t0 = performance.now();
        const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
        const tick = (t) => {
          const k = Math.min(1, (t - t0) / ms);
          scrollTo(0, from + (to - from) * ease(k));
          if (k < 1) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      }),
    [to, ms]
  );

/** The pointer taken to a control and pressed there, then a pause for what it does. */
async function press(page, locator, wait, dx) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + (dx ?? Math.min(70, box.width / 2)), box.y + box.height / 2, { steps: 20 });
  await pause(140);
  await page.mouse.down();
  await page.mouse.up();
  await pause(wait);
}

/**
 * Film `script` on the page `file`, in a window `width` × `height`: answers the recording
 * and the seconds where the script began and ended, the part kept.
 */
async function filmPage(browser, file, { width, height }, script) {
  const dir = mkdtempSync(join(tmpdir(), 'azimut-news-rec-'));
  const context = await browser.newContext({ viewport: { width, height }, recordVideo: { dir, size: { width, height } } });
  const page = await context.newPage();
  const born = Date.now();
  await page.goto(`file://${file}`);
  await pause(1500);
  await page.evaluate(drawPointer);
  const from = (Date.now() - born) / 1000;
  await script(page);
  const to = (Date.now() - born) / 1000;
  const video = page.video();
  await context.close();
  return { path: await video.path(), from, to };
}

/** The newest file in the case's exports folder whose name starts with `title` and ends with `ext`. */
function exported(home, title, ext) {
  const found = [];
  for (const caseDir of readdirSync(home)) {
    const exports = join(home, caseDir, 'azimut', 'exports');
    let names = [];
    try {
      names = readdirSync(exports);
    } catch {
      continue;
    }
    for (const name of names) if (name.startsWith(title.replace(/[?]/g, '_')) && name.endsWith(ext)) found.push(join(exports, name));
  }
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!found.length) throw new Error(`${title}${ext} was not written`);
  return found[0];
}

/** The site's folder served as GitHub Pages serves it, so its links from the root resolve. */
function serveSite(dir) {
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json' };
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    let file = join(dir, path);
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
      response.end(readFileSync(file));
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  return new Promise((done) => server.listen(SITE_PORT, '127.0.0.1', () => done(server)));
}

async function main() {
  for (const [tool, flag] of [['ffmpeg', '-version'], ['pdftoppm', '-v']]) {
    if (spawnSync(tool, [flag], { stdio: 'ignore' }).error) throw new Error(`${tool} is not on PATH`);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'azimut-news-'));
  const home = join(scratch, 'workspace');
  mkdirSync(join(home, '.azimut/settings'), { recursive: true });
  writeFileSync(join(home, '.azimut/settings/settings.json'), JSON.stringify({ update_check_on_start: false }));
  const own = process.platform !== 'win32';
  const backend = spawn('uv', ['run', 'azimut', '--port', String(API_PORT), '--no-browser'], {
    cwd: root,
    env: { ...process.env, AZIMUT_HOME: home },
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: own,
  });
  let vite = null;
  let browser = null;
  let site = null;
  try {
    await until('the backend', async () => (await fetch(`${api}/api/cases`)).ok);
    // the app as it ships, built into the scratch folder, never into src/azimut/static
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

    // the example case, imported from the bundle the app ships, as its press does
    const { version } = await call('GET', '/api/health');
    await call('PUT', '/api/settings/prefs', { tour: 'done', whats_new_seen: version, find_beta_seen: true });
    const opened = await call('POST', '/api/cases/example', {});
    if (opened.job_id) {
      await until('the example case', async () => {
        const job = await call('GET', `/api/cases/${opened.case_id}/bundle/jobs/${opened.job_id}`);
        if (job.state === 'failed' || job.state === 'cancelled') throw new Error(`the example case was not made: ${job.error}`);
        return job.state === 'ready';
      }, 180_000);
    }
    const caseId = opened.case_id;
    say(`example case: ${caseId}`);

    // the boats wear the ship, each group keeping its colour (Style › one style for the group)
    const layer = await call('GET', `/api/cases/${caseId}/map-layers/${encodeURIComponent('Boats lost')}/edit`);
    if (!layer.groups?.length) throw new Error('the boats layer has no groups to style');
    for (const group of layer.groups) {
      await call('PATCH', `/api/cases/${caseId}/map-layers/${encodeURIComponent('Boats lost')}/groups/${group.id}`, { mode: 'uniform', symbol: 'badge-ship' });
    }
    // a web map of the story's map: its layers, its ground and its steps
    const { items } = await call('GET', `/api/cases/${caseId}/notes/index`);
    const story = items.find((note) => note.title === STORY);
    const { text } = await call('GET', `/api/cases/${caseId}/notes/${story.id}`);
    const block = text.match(/::: map\n[\s\S]*?\n:::/)?.[0];
    if (!block) throw new Error('the story holds no map');
    const map = await call('POST', `/api/cases/${caseId}/notes`, {
      title: WEB_MAP,
      folder: '',
      content: `Boats lost and storm damage on Saltmere, 15 and 16 March 2026. A fictional example, drawn on a real aerial photograph of another coast.\n\n${block}\n\nEach boat stands where the pictures put it, coloured by how sure the count is. Press a mark for its picture.\n`,
      sources: [],
    });
    await call('PUT', `/api/cases/${caseId}/notes/${map.id}/look`, { style: 'article', web: 'map' });

    browser = await firefox.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', locale: 'en-GB' });
    await context.addInitScript((id) => {
      localStorage.setItem('azimut:lastCase', id);
      localStorage.setItem('azimut:theme', 'dark');
    }, caseId);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const seen = (selector) => page.locator(selector).filter({ visible: true }).first();
    let loads = 0;
    // each note printed through its Export dialog, as the analyst prints it
    for (const [title, format] of [[STORY, 'HTML page'], [WEB_MAP, 'HTML page'], [STORY, 'PDF'], [REGISTER, 'PDF'], [DAMAGE, 'PDF']]) {
      loads += 1;
      await page.goto(`${web}/?load=${loads}#notebook`);
      await seen(`text=${title}`).click();
      await seen('[data-guide="notebook.pdf"]').waitFor();
      await pause(2500);
      await seen('[data-guide="notebook.pdf"]').click();
      const dialog = page.getByRole('dialog').filter({ hasText: 'Format' }).first();
      await dialog.waitFor();
      await page.waitForFunction(() => !document.querySelector('[role="dialog"] .checking'), null, { timeout: 30_000 }).catch(() => {});
      await dialog.getByRole('button', { name: format, exact: true }).click();
      await pause(1000);
      const publicEdition = dialog.locator('[data-guide="notebook.edition-public"]');
      if (await publicEdition.count()) await publicEdition.first().click();
      await seen('[data-guide="notebook.export-go"]').click();
      await dialog.waitFor({ state: 'detached', timeout: 180_000 });
      say(`${title}: ${format}`);
    }
    await context.close();

    mkdirSync(OUT, { recursive: true });
    const made = new Set();
    // the PDF pages
    for (const [name, title, number] of PAGES) {
      const pdf = exported(home, title, '.pdf');
      const base = join(scratch, name);
      run('pdftoppm', ['-r', '100', '-f', String(number), '-l', String(number), '-png', '-singlefile', pdf, base]);
      webp(`${base}.png`, join(OUT, `${name}.webp`), 80);
      made.add(`${name}.webp`);
    }

    // the story's HTML page: its headline, then the before and after pulled both ways
    const storyFile = exported(home, STORY, '.html');
    const storyFilm = await filmPage(browser, storyFile, { width: 1292, height: 700 }, async (shown) => {
      await pause(1300);
      const pair = await shown.evaluate(() => {
        const figure = document.querySelector('.az-before').closest('figure') ?? document.querySelector('.az-before').parentElement;
        const box = figure.getBoundingClientRect();
        return { top: box.top + scrollY, height: box.height };
      });
      await glide(shown, pair.top - (700 - Math.min(pair.height, 640)) / 2 - 20, 1300);
      await pause(300);
      const box = await shown.evaluate(() => {
        const figure = document.querySelector('.az-before').closest('figure') ?? document.querySelector('.az-before').parentElement;
        const r = figure.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      });
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      await shown.mouse.move(cx + 200, cy + 120);
      await shown.mouse.move(cx, cy, { steps: 14 });
      await shown.mouse.down();
      await shown.mouse.move(box.x + box.w * 0.18, cy, { steps: 22 });
      await shown.mouse.move(box.x + box.w * 0.82, cy, { steps: 34 });
      await shown.mouse.move(cx, cy, { steps: 18 });
      await shown.mouse.up();
      await pause(500);
    });
    encode(storyFilm.path, 'story-page', { from: storyFilm.from - 0.4, to: storyFilm.to, rate: '700k' }, scratch);
    made.add('story-page.webm').add('story-page.webp');

    // the web map: the days played, a step, a layer off and on, a search and its card
    const mapFile = exported(home, WEB_MAP, '.html');
    const mapFilm = await filmPage(browser, mapFile, { width: 1440, height: 840 }, async (shown) => {
      await shown.mouse.move(1100, 700);
      await pause(300);
      await press(shown, shown.getByRole('button', { name: 'Play the days' }), 2600);
      await press(shown, shown.locator('button', { hasText: 'The marina at the west end' }).first(), 1700);
      const confirmed = shown.locator('button[title^="Show or hide Confirmed"]').first();
      await press(shown, confirmed, 700, 20);
      await press(shown, confirmed, 600, 20);
      await press(shown, shown.locator('button', { hasText: 'Every boat counted' }).first(), 1500);
      await press(shown, shown.getByPlaceholder(/Name, group/), 200);
      await shown.keyboard.type('launch', { delay: 90 });
      await pause(700);
      await press(shown, shown.locator('text="The launch, ashore"').filter({ visible: true }).first(), 2600);
    });
    encode(mapFilm.path, 'web-map', { from: mapFilm.from, to: mapFilm.to, speed: 1.12, rate: '900k' }, scratch);
    made.add('web-map.webm').add('web-map.webp');

    // a site's home, written by Azimut's own code and served from its root
    const siteDir = join(scratch, 'site');
    run('uv', ['run', 'python', 'scripts/whats_new_site.py', siteDir], { cwd: root });
    site = await serveSite(siteDir);
    const sitePage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await sitePage.goto(`http://127.0.0.1:${SITE_PORT}/`);
    await sitePage.waitForLoadState('networkidle');
    await pause(800);
    const shot = join(scratch, 'site-home.png');
    await sitePage.screenshot({ path: shot, fullPage: true });
    webp(shot, join(OUT, 'site-home.webp'), 84);
    made.add('site-home.webp');

    for (const file of readdirSync(OUT)) if (!file.startsWith('.') && !made.has(file)) unlinkSync(join(OUT, file));
  } finally {
    await browser?.close().catch(() => {});
    await vite?.close().catch(() => {});
    site?.close();
    try {
      if (own) process.kill(-backend.pid);
      else backend.kill();
    } catch {
      /* already gone */
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
