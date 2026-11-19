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
  // the form reads the case's colours, a category takes the case's own
  await page.route(`**/api/cases/${CASE_ID}/layer-palette`, (route) => route.fulfill({ json: { colours: [], icons: [] } }));
  await openCaseNotes(page, `# Field notes\n\n${DIAGRAM}\n\nAfter.`);

  const diagram = page.locator('.cm-block-diagram .cm-dg-figure svg');
  await expect(diagram).toBeVisible();
  await expect(diagram.getByText('Confirmed')).toBeVisible();
  await expect(page.locator('.cm-block-failed')).toHaveCount(0);
  // a press picks it and leaves it drawn; a double press opens its form, its </> its Mermaid
  await page.locator('.cm-dg-figure').click();
  await expect(page.locator('.cm-block-diagram.cm-picked svg').first()).toBeVisible();
  await page.locator('.cm-dg-figure').dblclick();
  await expect(page.getByRole('group', { name: 'Diagram' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Box 3', exact: true })).toHaveValue('Confirmed');
  await page.locator('.cm-dg-bar [data-edit-source]').click();
  await expect(page.locator('.cm-block-diagram')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toContainText('flowchart LR');

  fixture.expectNoUnexpectedRequests();
});

test('builds a flow from scratch, turns it top down, and exports it drawn with its legend', async ({ page }) => {
  await installAppFixture(page);
  await page.route(`**/api/cases/${CASE_ID}/layer-palette`, (route) => route.fulfill({ json: { colours: [], icons: [] } }));
  const state = { saved: '', exported: [] };
  await page.route(`**/api/cases/${CASE_ID}/notes`, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { text: '# Field notes\n\n' } });
    state.saved = route.request().postDataJSON().text;
    return route.fulfill({ json: { status: 'saved' } });
  });
  await page.route(`**/api/cases/${CASE_ID}/notes/pdf/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/check')) return route.fulfill({ json: { notes: [{ note: 'case', title: 'Case notes', warnings: [] }] } });
    const source = /```mermaid\n([\s\S]*?)\n```/.exec(state.saved)?.[1] ?? '';
    return route.fulfill({ json: { diagrams: source ? [{ key: 'k1', source }] : [] } });
  });
  await page.route(`**/api/cases/${CASE_ID}/notes/pdf`, (route) => {
    state.exported.push(route.request().postDataJSON());
    return route.fulfill({ json: { written: ['Case notes.pdf'], warnings: [], path: '' } });
  });
  await page.goto('/#notebook');
  await page.locator('[data-guide="notebook.case"] button.open').click();
  await expect(page.locator('.cm-editor')).toBeVisible();

  // / › Diagram: the gallery of kinds, each saying what it needs
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('/diagram');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('Diagram');
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  const gallery = page.getByRole('dialog', { name: 'Pick a diagram' });
  await expect(gallery.locator('.dg-pick')).toHaveCount(6);
  await gallery.getByRole('button', { name: /^Flow: Steps and decisions/ }).click();

  const form = page.getByRole('group', { name: 'Diagram' });
  const write = async (field, words) => {
    await field.fill(words);
    await field.press('Enter');
  };
  await write(form.getByRole('textbox', { name: 'Box 1', exact: true }), 'Tip received');
  await write(form.getByRole('combobox', { name: 'Category of box 1' }), 'Sources');
  await form.getByRole('button', { name: 'Add a box' }).click();
  await write(form.getByRole('textbox', { name: 'Box 5', exact: true }), 'Published');
  await form.getByRole('button', { name: 'Add a link' }).click();
  await form.getByRole('combobox', { name: 'From, link 4' }).selectOption({ label: 'Confirmed' });
  await form.getByRole('radiogroup', { name: 'Direction' }).getByRole('radio', { name: '↓ Top down' }).click();

  const figure = page.locator('.cm-dg-figure svg');
  await expect(figure.getByText('Published')).toBeVisible();
  // the legend under the drawing names the category
  await expect(figure.locator('[data-legend]')).toContainText('Sources');
  await expect.poll(() => state.saved).toContain('flowchart TD');
  expect(state.saved).toContain('n1["Tip received"]');
  expect(state.saved).toContain('n5["Published"]');
  expect(state.saved).toContain('n3 --> n5');
  expect(state.saved).toContain('%% legend c1: Sources');

  // exported: the browser draws it as the page shows it, legend included, into the PDF's picture
  await page.locator('[data-guide="notebook.pdf"]').click();
  const dialog = page.getByRole('dialog', { name: 'Export note as PDF' });
  await dialog.getByRole('button', { name: 'Export PDF' }).click();
  await expect.poll(() => state.exported.length).toBe(1);
  const png = state.exported[0].diagrams.k1;
  expect(png.length).toBeGreaterThan(2000);
  const drawn = await page.evaluate(async (source) => {
    const { renderMermaidSvg } = await import('/src/lib/mermaid.js');
    const { svg } = await renderMermaidSvg(source);
    return { legend: svg.includes('data-legend'), html: svg.includes('foreignObject') };
  }, /```mermaid\n([\s\S]*?)\n```/.exec(state.saved)[1]);
  expect(drawn).toEqual({ legend: true, html: false });
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
