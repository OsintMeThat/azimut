import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

const DIAGRAM = [
  '```mermaid',
  'flowchart LR',
  '  A[Tip] --> B[Check]',
  '  B --> C[Confirmed]',
  '```',
].join('\n');

/** The case notes, served holding `text`, opened from the Notebook's home. */
async function openCaseNotes(page, text) {
  await page.route(`**/api/cases/${CASE_ID}/notes`, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: { text } }) : route.fulfill({ json: { status: 'saved' } })
  );
  await page.goto('/#notebook');
  await page.locator('[data-guide="notebook.case"] button.open').click();
  await expect(page.locator('.cm-editor')).toBeVisible();
}

test('draws a mermaid fence in the note, offline', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openCaseNotes(page, `# Field notes\n\n${DIAGRAM}\n\nAfter.`);

  const diagram = page.locator('.cm-block-diagram svg');
  await expect(diagram).toBeVisible();
  await expect(diagram.getByText('Confirmed')).toBeVisible();
  await expect(page.locator('.cm-block-failed')).toHaveCount(0);
  // a press picks it and leaves it drawn; a double press opens its source to edit
  await page.locator('.cm-block-diagram').click();
  await expect(page.locator('.cm-block-diagram.cm-picked svg')).toBeVisible();
  await page.locator('.cm-block-diagram').dblclick();
  await expect(page.locator('.cm-block-diagram')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toContainText('flowchart LR');

  fixture.expectNoUnexpectedRequests();
});

test('says a diagram it cannot draw failed, and keeps its source', async ({ page }) => {
  await installAppFixture(page);
  await openCaseNotes(page, '```mermaid\nflowchart LR\n  A -->\n```\n\nAfter.');
  await expect(page.locator('.cm-block-failed')).toContainText('Diagram not drawn');
});

test('keeps a diagram as it was drawn before Mermaid 12, with its labels as written', async ({ page }) => {
  await installAppFixture(page);
  const asked = [];
  page.on('request', (request) => /\/elk|layout-elk/i.test(request.url()) && asked.push(request.url()));
  await openCaseNotes(page, `${DIAGRAM}\n\nAfter.`);
  const label = page.locator('.cm-block-diagram svg .label').filter({ hasText: 'Confirmed' }).first();
  await expect(label).toBeVisible();
  // the app's own .label would shout it in small capitals, and size its box for that
  await expect(label).toHaveCSS('text-transform', 'none');
  await expect(label).toHaveCSS('letter-spacing', 'normal');
  expect(asked).toEqual([]);
});

test('draws what a PDF places as plain text, in every diagram that could hold HTML', async ({ page }) => {
  // A browser will not always draw HTML out of an image: Firefox leaves the boxes empty.
  await installAppFixture(page);
  await page.goto('/#notebook');
  await expect(page.locator('[data-guide="notebook.case"]')).toBeVisible();

  const drawn = await page.evaluate(async (sources) => {
    const { renderMermaidSvg } = await import('/src/lib/mermaid.js');
    const found = {};
    for (const [name, source] of Object.entries(sources)) {
      const { svg } = await renderMermaidSvg(source);
      const picture = new DOMParser().parseFromString(svg, 'image/svg+xml');
      found[name] = {
        html: picture.querySelectorAll('foreignObject').length,
        text: picture.documentElement.textContent,
      };
    }
    return found;
  }, {
    flowchart: 'flowchart LR\n  A[Tip] --> B[Confirmed]',
    classes: 'classDiagram\n  class Person {\n    +String alias\n  }',
    state: 'stateDiagram-v2\n  [*] --> Confirmed',
    entities: 'erDiagram\n  PERSON ||--o{ POST : Confirmed',
    mindmap: 'mindmap\n  root((Case))\n    Confirmed',
    journey: 'journey\n  section Collect\n    Confirmed: 5: Analyst',
    // a note's own config block has to stay first, or the diagram does not parse at all
    configured: '---\nconfig:\n  layout: elk\n---\nflowchart LR\n  A[Tip] --> B[Confirmed]',
  });

  for (const [name, { html, text }] of Object.entries(drawn)) {
    expect(html, name).toBe(0);
    expect(text, name).toMatch(/Confirmed|alias/);
  }
});

test('writes a journey’s plain labels in a colour its boxes do not share', async ({ page }) => {
  await installAppFixture(page);
  await page.goto('/#notebook');
  await expect(page.locator('[data-guide="notebook.case"]')).toBeVisible();

  const fills = await page.evaluate(async () => {
    const { renderMermaidSvg } = await import('/src/lib/mermaid.js');
    const { svg } = await renderMermaidSvg('journey\n  section Collect\n    Confirmed: 5: Analyst');
    const holder = document.createElement('div');
    holder.innerHTML = svg;
    document.body.append(holder);
    const fill = (selector) => getComputedStyle(holder.querySelector(selector)).fill;
    const found = {
      section: fill('text.journey-section'),
      task: fill('text.task'),
      box: fill('rect.journey-section'),
    };
    holder.remove();
    return found;
  });

  expect(fills.section).toBe('rgb(32, 33, 36)');
  expect(fills.task).toBe('rgb(32, 33, 36)');
  expect(fills.box).not.toBe(fills.section);
});
