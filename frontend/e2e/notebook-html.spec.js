import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, pdfAnswer } from './app.fixture.js';
import { drawPictures, reportHtml } from './htmlReport.fixture.js';

/**
 * The note as one HTML page. In the app, the Page pane draws it beside the note and
 * the export dialog writes it, the server stood in for. Then the page itself, written
 * to a file and opened from the disk with every request that is not that file refused:
 * its pictures show, its pair slides, a picture opens large and Escape closes it, a
 * timecode plays its passage, its steps go on with the arrow keys and its story
 * changes its picture as the words are read.
 */

const COLOURS = ['#c9a77c', '#7d9c6b', '#a5743f', '#8aa1b5', '#b58a8a', '#9a8ab5', '#c2b280', '#6f8f8f'];

/** Write the report to a file of the test's own and open it from the disk, nothing else reachable. */
async function openReport(page, testInfo, viewport = { width: 1440, height: 900 }) {
  const refused = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file:') || url.startsWith('data:') || url === 'about:blank') return route.continue();
    refused.push(url);
    return route.abort();
  });
  await page.setViewportSize(viewport);
  const pictures = await drawPictures(page, COLOURS);
  const file = testInfo.outputPath('report.html');
  writeFileSync(file, reportHtml(pictures));
  await page.goto(`file://${file}`);
  await expect(page.locator('html')).toHaveClass(/az-js/);
  return refused;
}

test('the report opened from the disk, offline: pictures, slider, lightbox, timecode, steps and story', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the file itself');
  const refused = await openReport(page, testInfo);

  // every picture is drawn from the file
  const sizes = await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode().then(() => image.naturalWidth, () => 0))));
  expect(sizes.length).toBeGreaterThan(5);
  expect(sizes.every((width) => width > 0)).toBe(true);

  // the pair slides under a drag, and says how much of each side it shows
  const pair = page.locator('.az-compare');
  await pair.scrollIntoViewIfNeeded();
  const box = await pair.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  const split = await pair.evaluate((node) => Number.parseFloat(node.style.getPropertyValue('--az-split')));
  expect(split).toBeGreaterThan(15);
  expect(split).toBeLessThan(25);
  await page.keyboard.press('ArrowRight');
  await expect(pair.locator('.az-slider')).toHaveAttribute('aria-valuetext', /% before, \d+% after/);

  // a picture opens large with its credit, and Escape closes it and gives the keyboard back
  const zoom = page.locator('figure[data-kind="picture"] > .az-zoom').first();
  await zoom.scrollIntoViewIfNeeded();
  await zoom.click();
  const lightbox = page.locator('dialog.az-lightbox');
  await expect(lightbox).toBeVisible();
  await expect(lightbox.locator('.az-lb-credit')).toContainText('Esri World Imagery, about 3 June 2025');
  await page.keyboard.press('Escape');
  await expect(lightbox).toBeHidden();
  await expect(zoom).toBeFocused();

  // a timecode seeks the clip and plays its passage
  await page.locator('a.az-time').click();
  await expect.poll(() => page.locator('#clip-1').evaluate((clip) => clip.currentTime)).toBeGreaterThanOrEqual(0.6);
  await expect.poll(() => page.locator('#clip-1').evaluate((clip) => clip.paused)).toBe(true);

  // the steps go on with the arrow keys
  const steps = page.locator('section.az-steps');
  await steps.scrollIntoViewIfNeeded();
  await expect(steps.locator('.az-steps-count')).toHaveText('1 / 3');
  await steps.locator('.az-steps-dots button').first().click();
  await page.keyboard.press('ArrowRight');
  await expect(steps.locator('.az-step.az-on')).toHaveAttribute('data-step', '2');
  await page.keyboard.press('ArrowRight');
  await expect(steps.locator('.az-steps-count')).toHaveText('3 / 3');
  await expect(steps.locator('.az-steps-next')).toBeDisabled();

  // the story holds the picture of the step being read
  const story = page.locator('section.az-story');
  await expect(story).toHaveClass(/az-live/);
  await story.locator('.az-story-step').nth(0).scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const first = document.querySelectorAll('.az-story-step')[0];
    window.scrollBy(0, first.getBoundingClientRect().top - innerHeight * 0.5 + 20);
  });
  await expect(story.locator('.az-story-figures > figure.az-on')).toHaveAttribute('data-step', '1');
  await page.evaluate(() => {
    const second = document.querySelectorAll('.az-story-step')[1];
    window.scrollBy(0, second.getBoundingClientRect().top - innerHeight * 0.5 + 20);
  });
  await expect(story.locator('.az-story-figures > figure.az-on')).toHaveAttribute('data-step', '2');
  await expect(story.locator('.az-story-step.az-on .az-story-count')).toHaveText('2 / 2');

  // a code in the text points at its row
  await page.locator('a[href="#V12"]').click();
  await expect(page.locator('#V12')).toHaveClass(/az-flash/);

  expect(refused).toEqual([]);
});

test('the page never grows wider than the screen, whatever its tables hold, and a full-width picture breaks out', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the file itself');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const refused = await openReport(page, testInfo, viewport);
    const measure = await page.evaluate(() => {
      const width = (selector) => document.querySelector(selector).getBoundingClientRect().width;
      const wraps = [...document.querySelectorAll('.az-table-wrap')];
      return {
        page: document.documentElement.scrollWidth,
        text: width('.az-body > p'),
        full: width('figure[data-width="100%"]'),
        small: width('figure[data-width="50%"]'),
        register: width('.az-table-wrap:has(th:nth-child(5))'),
        // a table that does not fit slides in its own frame, never the page
        frames: wraps.map((wrap) => wrap.scrollWidth <= wrap.clientWidth + 1 || getComputedStyle(wrap).overflowX === 'auto'),
        sortable: [...document.querySelectorAll('th')].filter((head) => !head.textContent.trim()).map((head) => head.querySelector('button')),
      };
    });
    expect(measure.page).toBeLessThanOrEqual(viewport.width);
    expect(measure.frames.every(Boolean)).toBe(true);
    expect(measure.sortable).toEqual([null]);
    if (viewport.width === 1440) {
      expect(measure.full).toBeGreaterThan(measure.text + 200);
      expect(measure.register).toBeGreaterThan(measure.text + 200);
      expect(measure.small).toBeLessThan(measure.text);
    }
    expect(refused).toEqual([]);
  }
});

test('the report on a phone reads picture then words, with the contents folded into a bar', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the file itself');
  const refused = await openReport(page, testInfo, { width: 390, height: 844 });
  await expect(page.locator('section.az-story')).not.toHaveClass(/az-live/);
  // the story's picture comes before its words, in the reading order
  const order = await page.evaluate(() => [...document.querySelectorAll('.az-story-figures > figure, .az-story-step')]
    .map((node) => [node.dataset.step, node.tagName, Math.round(node.getBoundingClientRect().top)])
    .sort((a, b) => a[2] - b[2]).map(([step, tag]) => `${tag === 'FIGURE' ? 'picture' : 'words'} ${step}`));
  expect(order).toEqual(['picture 1', 'words 1', 'picture 2', 'words 2']);
  const toggle = page.locator('.az-contents-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await page.locator('.az-contents a[href="#the-register"]').click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle.locator('.az-contents-now')).toHaveText(/The register/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(refused).toEqual([]);
});

test('the story layout, opened from the disk: a hero, and the story held beside its words even on a phone', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the file itself');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.route('**/*', (route) => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));
    await page.setViewportSize(viewport);
    const pictures = await drawPictures(page, COLOURS);
    const file = testInfo.outputPath(`story-${viewport.width}.html`);
    writeFileSync(file, reportHtml(pictures, { web: 'story' }));
    await page.goto(`file://${file}`);
    // the cover opens on the first picture that came from somewhere, its credit kept on it
    const hero = page.locator('header.az-cover > .az-cover-figure');
    await expect(hero.locator('.az-credit')).toContainText('Esri World Imagery');
    expect((await page.locator('header.az-cover').boundingBox()).height).toBeGreaterThanOrEqual(viewport.height - 1);
    // the contents are a bar at every width
    await expect(page.locator('.az-contents')).toHaveClass(/az-bar/);
    const story = page.locator('section.az-story');
    await expect(story).toHaveClass(/az-live/);
    for (const step of [0, 1]) {
      await page.evaluate((at) => {
        const words = document.querySelectorAll('.az-story-step')[at];
        window.scrollTo({ top: scrollY + words.getBoundingClientRect().top - innerHeight * 0.4, behavior: 'instant' });
      }, step);
      await expect(story.locator('.az-story-figures > figure.az-on')).toHaveAttribute('data-step', String(step + 1));
    }
    // the picture held is in sight while its words are read
    const held = await story.locator('.az-story-figures > figure.az-on img').boundingBox();
    expect(held.y).toBeGreaterThanOrEqual(0);
    expect(held.y).toBeLessThan(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.unrouteAll();
  }
});

/** A note in the Notebook, the server stood in for, answering the HTML routes with a real reading page. */
async function notebook(page, html) {
  const at = '2026-10-01T10:00:00Z';
  const catalog = [{ id: 'n1', type: 'note', label: 'Lead', attrs: { path: 'notes/n1.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } }];
  await installAppFixture(page, { catalog });
  const state = { previews: [], htmlPreviews: [], checks: [], exported: [], looks: [] };
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      return route.fulfill({ json: { items: [{ id: 'n1', title: 'Lead', folder: '', updated_at: at, excerpt: 'Seen at the quay.', words: 4,
        tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0, look: null, includes: 0 }] } });
    }
    if (path === '/preview') { state.previews.push(request.postDataJSON()); return pdfAnswer(route, [0]); }
    if (path === '/html/preview') {
      state.htmlPreviews.push(request.postDataJSON());
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html,
        headers: { 'X-Note-Warnings': '["\\"12 trucks\\" is a bare count: say \\"at least\\" or give a range."]', 'X-Note-Warning-Kinds': '["count"]', 'X-Note-Diagrams': '[]' } });
    }
    if (path === '/pdf/diagrams') return route.fulfill({ json: { diagrams: [] } });
    if (path === '/pdf/check') {
      const body = request.postDataJSON();
      state.checks.push(body);
      const html = body.format === 'html';
      return route.fulfill({ json: { notes: body.notes.map((id) => ({
        note: id, title: 'Lead', internal: 0, warnings: [],
        ...(html ? { weight: 3_400_000, earlier: 0, links: [{ text: 'The whole video, 4 min', line: 6 }], pov: [{ text: 'Rooftop: 15.413060, 44.236870', line: 9 }] } : {}),
      })) } });
    }
    if (path === '/html') {
      const body = request.postDataJSON();
      state.exported.push(body);
      return route.fulfill({ json: { written: [{ note: 'n1', title: 'Lead', file: 'Lead - 2026-11-18.html', edition: 'public', bytes: 3_400_000 }], warnings: [], path: '' } });
    }
    if (/^\/[\w-]+\/look$/.test(path)) {
      if (request.method() === 'PUT') state.looks.push(request.postDataJSON());
      return route.fulfill({ json: { look: state.looks.at(-1) ?? { style: 'report' } } });
    }
    if (path === '/n1') return route.fulfill({ json: { text: '# Lead\n\nSeen at the quay.\n' } });
    return route.fallback();
  });
  return state;
}

test('the Page pane shows the note as its HTML page, and the export dialog writes one', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the frame');
  const pictures = await drawPictures(page, COLOURS);
  const state = await notebook(page, reportHtml(pictures));
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  await expect(page.locator('.cm-content')).toContainText('Seen at the quay.');

  await page.locator('[data-guide="notebook.view"]').getByRole('button', { name: 'Page' }).click();
  const pane = page.locator('.page-pane');
  await pane.getByRole('group', { name: 'Format' }).getByRole('button', { name: 'HTML' }).click();
  await expect.poll(() => state.htmlPreviews.length).toBeGreaterThan(0);
  expect(state.htmlPreviews.at(-1)).toMatchObject({ note: 'n1', edition: 'internal' });
  await expect(pane).toContainText('As the file reads in a browser');
  await expect(pane.locator('#page-warnings')).toContainText('is a bare count');
  // the page runs its own script in its frame, and reaches nothing of the app
  const frame = page.frameLocator('.html-page iframe:not([inert])');
  await expect(frame.locator('html')).toHaveClass(/az-js/);
  await expect(frame.locator('h1.az-title')).toHaveText('Ambush on the Wadi Sahm road');
  await expect(page.locator('.html-page iframe').first()).toHaveAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
  expect(await page.evaluate(() => localStorage.getItem('azimut:note-page-format'))).toBe('html');

  // a Contents entry goes to its part inside the frame: the frame keeps the report, never a blank page
  await frame.locator('.az-contents-toggle').click();
  await frame.locator('.az-contents a[href="#the-register"]').click();
  await expect.poll(() => frame.locator('#the-register').evaluate((node) => Math.round(node.getBoundingClientRect().top))).toBeLessThan(200);
  await expect(frame.locator('h1.az-title')).toHaveText('Ambush on the Wadi Sahm road');
  expect(await frame.locator('html').evaluate(() => [location.href, window.scrollY > 0])).toEqual(['about:srcdoc', true]);
  // a citation, its source's card and back: every link of the page stays in it
  await frame.locator('a.az-cite').first().click();
  await expect(frame.locator('#src-1')).toHaveClass(/az-flash/);
  expect(await frame.locator('html').evaluate(() => location.href)).toBe('about:srcdoc');

  // the Look lays the page out as a story, and the HTML view is drawn again in it
  const asked = state.htmlPreviews.length;
  await page.locator('[data-guide="notebook.look"]').click();
  await page.getByRole('tab', { name: 'Style' }).click();
  await page.getByRole('radiogroup', { name: 'Web page' }).getByRole('radio', { name: 'Story' }).click();
  await expect.poll(() => state.htmlPreviews.length).toBeGreaterThan(asked);
  expect(state.htmlPreviews.at(-1).look).toMatchObject({ style: 'report', web: 'story' });
  expect(state.looks.at(-1)).toMatchObject({ web: 'story' });
  await page.keyboard.press('Escape');

  await page.locator('[data-guide="notebook.pdf"]').click();
  let dialog = page.getByRole('dialog', { name: 'Export note as PDF' });
  await dialog.getByRole('group', { name: 'Format' }).getByRole('button', { name: 'HTML' }).click();
  dialog = page.getByRole('dialog', { name: 'Export note as HTML' });
  await expect(dialog).toContainText('About 3.2 MB.');
  await expect(dialog.getByRole('list', { name: 'Clips turned into a link' })).toContainText('The whole video, 4 min');
  await expect(dialog.getByRole('list', { name: 'Points of view' })).toContainText('Rooftop');
  expect(state.checks.at(-1)).toEqual({ notes: ['n1'], edition: 'internal', format: 'html' });
  await dialog.getByLabel('Round them to about 150 m in this file').check();
  await dialog.getByRole('button', { name: 'Export HTML' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.exported.at(-1)).toEqual({ notes: ['n1'], diagrams: {}, edition: 'internal', round_pov: true, changes: '' });
  await expect(page.getByText('1 HTML page written')).toBeVisible();
});
