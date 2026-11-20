import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

/**
 * A picture wall in a Story page, opened from the disk: the reader's style sheets and script
 * inlined as the export inlines them, the wall in the markup `test_notes_chart_wall.py` holds
 * the server to. Whole, it breaks out the window's width between the scenes in the stage's
 * dark colours; with `story: one group per step` each group is a step on the stage, its card
 * beside it. Scrolled from end to end at a laptop's width and a phone's, no frame ever
 * overlaps another, each picture fills its frame above a bar as wide, and a press still
 * opens it larger.
 */

const ASSETS = new URL('../../src/azimut/engine/notes_html_assets/', import.meta.url);
const CSS = ['reader.css', 'reader.chart.css'].map((name) => readFileSync(new URL(name, ASSETS), 'utf8')).join('');
const JS = readFileSync(new URL('reader.js', ASSETS), 'utf8');

/** The grades' paints on paper and on the dark stage (`notes_charts.GRADES`). */
const GRADES = { Confirmed: ['#184f95', '#b7d3f6'], 'Almost sure': ['#3987e5', '#5598e7'] };
/** Each group of a wall: its name, and the grade of each of its frames. */
const WHOLE = [['Streit Cougar', 7], ['Harrow Tygor E1', 9], ['BATT UMG', 2]];
const STEPPED = [['Oshkosh M-ATV', 5, 2, 3], ['Al-Wahsh', 9, 3, 3], ['Streit Cobra LAMV', 2, 2, 1]];

/** Each frame's picture as the server cuts it for its slot: 240 × 160, a block of its own on a colour. */
function drawFrames(page, count, width = 240, height = 160) {
  return page.evaluate(([total, w, h]) => Array.from({ length: total }, (_, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d');
    context.fillStyle = `hsl(${(index * 47) % 360} 45% 62%)`;
    context.fillRect(0, 0, w, h);
    context.fillStyle = '#222';
    context.fillRect(w * 0.25, h * 0.35, w * 0.5, h * 0.4);
    return canvas.toDataURL('image/jpeg', 0.8);
  }), [count, width, height]);
}

const bar = (grade, dark = true) => `<i class="az-wall-bar" style="--bar:${GRADES[grade][0]}${dark ? `;--bar-d:${GRADES[grade][1]}` : ''}"></i>`;
const gradeOf = (index) => (index % 3 ? 'Almost sure' : 'Confirmed');

function frame(src, number, group, grade, size) {
  const said = `#${number} burned, ${group}, ${grade}`;
  return `<figure class="az-wall-item"><button class="az-zoom az-wall-zoom" type="button" aria-label="Open larger: ${said}" data-large="${src}">`
    + `<img src="${src}" alt="${said}" width="${size[0]}" height="${size[1]}" loading="lazy" decoding="async"></button>${bar(grade)}`
    + `<figcaption class="az-wall-label"><b>#${number}</b> burned</figcaption><span class="az-caption" hidden>#${number} burned · ${group} · ${grade}</span></figure>`;
}

const head = (name, count) => `<p class="az-wall-head"><span class="az-wall-name" dir="auto">${name}</span><span class="az-wall-count">${count}</span></p>`;
const legend = `<p class="az-wall-legend">${Object.keys(GRADES).map((grade) => `<span class="az-wall-key">${bar(grade)}${grade} <b>3</b></span>`).join('')}</p>\n`;
const numbers = '<details class="az-chart-numbers"><summary>The numbers</summary>\n<table class="az-chart-data"><tbody><tr><th scope="row">#1</th><td>Confirmed</td></tr></tbody></table></details>\n';

/** A story page: a scene, the whole wall breaking out after it, words, then a wall stepped through by group. */
function storyHtml(pictures) {
  let at = 0;
  const groups = (list, size) => list.map(([name, count]) => {
    const items = Array.from({ length: count }, (_, index) => frame(pictures[at++ % pictures.length], at, name, gradeOf(index), size)).join('');
    return `<section class="az-wall-group" aria-label="${name}: ${count}">${head(name, count)}<div class="az-wall-items">${items}</div></section>`;
  });
  const whole = `<figure class="az-figure az-chart-figure az-wall-figure" data-kind="chart" data-chart="pictures" id="chart-1">
<div class="az-wall" style="--az-ratio:1.5000" role="group" aria-label="At least 18 vehicles, by model">
${legend}<div class="az-wall-flow">${groups(WHOLE, [120, 80]).join('')}</div>
<div class="az-wall-foot"><p class="az-wall-credit">Pictures: x.com</p></div>
</div>
<figcaption><span class="az-caption" dir="auto">At least 18 vehicles, by model</span>
${numbers}</figcaption>
</figure>\n`;
  const stages = groups(STEPPED, [262, 175]).map((group, index) => `<figure class="az-figure az-wall-stage" data-kind="chart" data-step="${index + 1}" `
    + `style="--az-n:${index + 1};--az-cols:${STEPPED[index][2]};--az-rows:${STEPPED[index][3]}"><div class="az-wall" style="--az-ratio:1.5000">`
    + `<div class="az-wall-flow">${group}</div></div></figure>\n`);
  const cards = STEPPED.map(([name, count], index) => `<div class="az-story-step az-wall-card" data-step="${index + 1}" style="--az-n:${index + 1}">`
    + `${head(name, count)}<ul class="az-wall-grades"><li class="az-wall-key">${bar('Confirmed', false)}Confirmed <b>${Math.ceil(count / 3)}</b></li>`
    + `<li class="az-wall-key">${bar('Almost sure', false)}Almost sure <b>${count - Math.ceil(count / 3)}</b></li></ul></div>\n`);
  const stepped = `<section class="az-story az-wall-story" id="chart-2" data-chart="pictures" data-steps="3" aria-label="At least 16 vehicles, one model a step" style="--az-ratio:1.5000">
<div class="az-story-lead"><p class="az-wall-title"><span class="az-caption" dir="auto">At least 16 vehicles, one model a step</span></p>${legend}</div>
<div class="az-story-figures">\n${stages.join('')}</div>
<div class="az-story-steps">\n${cards.join('')}</div>
<div class="az-wall-end"><div class="az-wall-foot"><p class="az-wall-credit">Pictures: x.com</p></div>
${numbers}</div>
</section>\n`;
  const words = (text) => `<p>${text}</p>\n`.repeat(3);
  return `<!doctype html>
<html lang="en" dir="auto" data-look="report" data-web="story" data-edition="public">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>What was left on the road</title>
<style id="az-reader">${CSS}</style></head>
<body>
<header class="az-cover" data-cover="style"><h1 class="az-title">What was left on the road</h1></header>
<div class="az-page">
<main class="az-body" id="main">
<h2 id="the-road">The road</h2>
${words('Two videos toured the road after the withdrawal.')}
<section class="az-story az-scenes" data-steps="1">
<div class="az-story-figures">
<figure class="az-figure" data-kind="picture" data-step="1" style="--az-n:1"><button class="az-zoom" type="button" aria-label="Open larger: The road"><img src="${pictures[0]}" alt="The road" width="240" height="160"></button>
<figcaption><span class="az-caption">The road from above.</span></figcaption></figure>
</div>
<div class="az-story-steps">
<div class="az-story-step" data-step="1" style="--az-n:1"><p>The convoy stopped at the roadblock.</p></div>
</div>
</section>
${whole}${words('Most of the identified models are built in the UAE.')}${stepped}${words('Where they lie says more than the count.')}
</main>
</div>
<script>${JS}</script>
</body></html>`;
}

/** The largest area two of `selector`'s boxes share among the ones shown, and each frame's picture and bar against its button. */
function measure(page, selector) {
  return page.evaluate((chosen) => {
    const shown = [...document.querySelectorAll(chosen)].filter((node) => getComputedStyle(node).visibility !== 'hidden' && node.getClientRects().length);
    const boxes = shown.map((node) => node.getBoundingClientRect());
    let overlap = 0;
    for (let one = 0; one < boxes.length; one += 1) {
      for (let other = one + 1; other < boxes.length; other += 1) {
        const [a, b] = [boxes[one], boxes[other]];
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (width > 0.5 && height > 0.5) overlap = Math.max(overlap, width * height);
      }
    }
    // each picture fills its button, and the bar under it is as wide
    const misfit = shown.map((button) => {
      const box = button.getBoundingClientRect();
      const picture = button.querySelector('img').getBoundingClientRect();
      const under = button.parentElement.querySelector('.az-wall-bar').getBoundingClientRect();
      return Math.max(Math.abs(picture.width - box.width), Math.abs(picture.height - box.height), Math.abs(under.width - box.width));
    });
    return { count: shown.length, overlap, misfit: Math.max(0, ...misfit), boxes: boxes.map((box) => [box.top, box.bottom, box.right]) };
  }, selector);
}

const scrollTo = (page, top) => page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), top);

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`a picture wall in a story at ${viewport.width} px: never overlapping, whole between the scenes or one group a step`, async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'one browser is enough for the file itself');
    await page.route('**/*', (route) => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));
    await page.setViewportSize(viewport);
    const pictures = await drawFrames(page, 34);
    const file = testInfo.outputPath(`wall-story-${viewport.width}.html`);
    writeFileSync(file, storyHtml(pictures));
    await page.goto(`file://${file}`);
    await expect(page.locator('section.az-scenes')).toHaveClass(/az-live/);

    // the whole wall stands in the body, never on a stage, a dark band the window's width joined to the scene before it
    const whole = page.locator('main > figure.az-wall-figure');
    await expect(whole).toHaveCount(1);
    const band = await whole.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const scene = node.previousElementSibling.getBoundingClientRect();
      const name = node.querySelector('.az-wall-name');
      return {
        width: box.width - document.documentElement.clientWidth, left: box.left, gap: box.top - scene.bottom, background: getComputedStyle(node).backgroundColor,
        name: getComputedStyle(name).color, legend: getComputedStyle(node.querySelector('.az-wall-key b')).color,
        bar: getComputedStyle(node.querySelector('.az-wall-item .az-wall-bar')).backgroundColor,
        title: node.querySelector(':scope > figcaption').getBoundingClientRect().top < node.querySelector('.az-wall').getBoundingClientRect().top,
        // its title and The numbers stand in the window, one under the other
        inside: [...node.querySelectorAll(':scope > figcaption > *')].every((part) => part.getBoundingClientRect().right <= document.documentElement.clientWidth + 0.5),
      };
    });
    expect(band).toMatchObject({ width: 0, left: 0, gap: 0, background: 'rgb(15, 16, 18)', name: 'rgb(255, 255, 255)', legend: 'rgb(255, 255, 255)', title: true, inside: true });
    // the bar wears the stage's paint, the light blue of Confirmed on the dark
    expect(band.bar).toBe('rgb(183, 211, 246)');
    const top = await whole.evaluate((node) => node.getBoundingClientRect().top + scrollY);
    const height = (await whole.boundingBox()).height;
    let seen = 0;
    for (let y = top - viewport.height / 2; y < top + height; y += viewport.height / 3) {
      await scrollTo(page, y);
      const frames = await measure(page, 'main > figure.az-wall-figure .az-wall-zoom');
      expect(frames.overlap, `frames overlap at ${y}`).toBe(0);
      expect(frames.misfit, `a picture or its bar is not its frame's width at ${y}`).toBeLessThan(1);
      seen = Math.max(seen, frames.count);
    }
    expect(seen).toBe(18);
    // a press opens the frame larger, with its words
    await whole.locator('.az-wall-zoom').first().scrollIntoViewIfNeeded();
    await whole.locator('.az-wall-zoom').first().click();
    const box = page.locator('dialog.az-lightbox');
    await expect(box).toHaveAttribute('open', '');
    await expect(box.locator('.az-lb-caption')).toContainText('#1 burned · Streit Cougar · Confirmed');
    await page.keyboard.press('Escape');
    await expect(box).not.toHaveAttribute('open', '');

    // one group a step: each card brings its group on the stage, large, all of it in sight, none overlapping
    const stepped = page.locator('section.az-wall-story');
    await expect(stepped).toHaveClass(/az-live/);
    for (const [index, [name, count]] of STEPPED.entries()) {
      await page.evaluate((at) => {
        const card = document.querySelectorAll('.az-wall-card')[at];
        window.scrollTo({ top: scrollY + card.getBoundingClientRect().top - innerHeight * 0.4, behavior: 'instant' });
      }, index);
      const held = stepped.locator('.az-story-figures > figure.az-on');
      await expect(held).toHaveAttribute('data-step', String(index + 1));
      await expect(held.locator('.az-wall-name')).toHaveText(name);
      await expect(stepped.locator('.az-wall-card.az-on .az-story-count')).toHaveText(`${index + 1} / 3`);
      // the stage's fade settles before the frames are measured
      await expect(held).toHaveCSS('opacity', '1');
      await expect.poll(async () => (await measure(page, 'section.az-wall-story .az-wall-zoom')).count).toBe(count);
      const frames = await measure(page, 'section.az-wall-story .az-wall-zoom');
      expect(frames.overlap).toBe(0);
      expect(frames.misfit).toBeLessThan(1);
      const stage = await held.evaluate((node) => node.parentElement.getBoundingClientRect());
      for (const [top, bottom, right] of frames.boxes) {
        expect(top).toBeGreaterThanOrEqual(stage.top - 0.5);
        expect(bottom).toBeLessThanOrEqual(Math.min(stage.bottom, viewport.height) + 0.5);
        expect(right).toBeLessThanOrEqual(stage.right + 0.5);
      }
      // larger than the whole wall draws them, its name white on the stage
      const wide = await held.locator('.az-wall-zoom').first().evaluate((node) => node.getBoundingClientRect().width);
      expect(wide).toBeGreaterThan(viewport.width > 1000 ? 180 : 100);
      expect(await held.locator('.az-wall-name').evaluate((node) => getComputedStyle(node).color)).toBe('rgb(255, 255, 255)');
    }
    // a frame on the stage still opens larger
    const held = stepped.locator('.az-story-figures > figure.az-on .az-wall-zoom').first();
    await held.click();
    await expect(box).toHaveAttribute('open', '');
    await expect(box.locator('.az-lb-caption')).toContainText('Streit Cobra LAMV');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  });
}
