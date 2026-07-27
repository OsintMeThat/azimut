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
