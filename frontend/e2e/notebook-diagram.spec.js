import { test, expect } from '@playwright/test';
import { installAppFixture } from './app.fixture.js';

const DIAGRAM = [
  '```mermaid',
  'flowchart LR',
  '  A[Tip] --> B[Check]',
  '  B --> C[Confirmed]',
  '```',
].join('\n');

test('draws a mermaid fence in the notebook preview, offline', async ({ page }) => {
  const fixture = await installAppFixture(page);

  await page.goto('/#notebook');
  const writer = page.locator('.writer textarea');
  await expect(writer).toBeVisible();

  const preview = page.locator('.markdown');
  await writer.fill('# Field notes\n\nNo diagram yet.');
  await expect(preview.locator('.mermaid-diagram')).toHaveCount(0);

  await writer.fill(`# Field notes\n\n${DIAGRAM}`);
  const diagram = preview.locator('.mermaid-diagram svg');
  await expect(diagram).toBeVisible();
  await expect(diagram.getByText('Confirmed')).toBeVisible();
  await expect(preview.locator('.mermaid-error')).toHaveCount(0);

  await writer.fill('```mermaid\nflowchart LR\n  A -->\n```');
  await expect(preview.locator('.mermaid-diagram.mermaid-failed')).toBeVisible();

  fixture.expectNoUnexpectedRequests();
});

test('keeps a diagram as it was drawn before Mermaid 12, with its labels as written', async ({ page }) => {
  await installAppFixture(page);
  await page.goto('/#notebook');
  const writer = page.locator('.writer textarea');
  await expect(writer).toBeVisible();
  const asked = [];
  page.on('request', (request) => /\/elk|layout-elk/i.test(request.url()) && asked.push(request.url()));

  await writer.fill(DIAGRAM);
  const label = page.locator('.mermaid-diagram svg .label').filter({ hasText: 'Confirmed' }).first();
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
  await expect(page.locator('.writer textarea')).toBeVisible();

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
  await expect(page.locator('.writer textarea')).toBeVisible();

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
