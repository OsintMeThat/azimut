import { test, expect } from '@playwright/test';
import { installAppFixture, openProofWithPanel } from './app.fixture.js';

async function buttonStyle(button) {
  return button.evaluate((element) => {
    const style = getComputedStyle(element);
    const properties = [
      'backgroundColor', 'color', 'borderColor', 'borderWidth', 'borderStyle',
      'borderRadius', 'padding', 'fontSize', 'fontWeight', 'gap', 'opacity', 'height',
    ];
    return Object.fromEntries(properties.map((property) => [property, style[property]]));
  });
}

for (const theme of ['dark', 'light']) {
  test(`Report actions match Proof buttons in the ${theme} theme`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const fixture = await installAppFixture(page);
    await page.addInitScript((value) => localStorage.setItem('azimut:theme', value), theme);
    await page.goto('/#proof');
    await expect(page.locator('.tool-header').getByRole('button', { name: 'New proof', exact: true })).toBeVisible({ timeout: 15_000 });

    const header = page.locator('.tool-header');
    const saveProof = header.getByRole('button', { name: 'Save proof', exact: true });
    const toPost = header.getByRole('button', { name: 'To Post', exact: true });
    await expect(saveProof).toBeDisabled();
    const disabledSave = await buttonStyle(saveProof);
    const disabledPublish = await buttonStyle(toPost);
    const neutral = await buttonStyle(header.getByRole('button', { name: 'Open proof', exact: true }));
    const spacing = await header.evaluate((element) => getComputedStyle(element).gap);

    await openProofWithPanel(page);
    await expect(saveProof).toBeEnabled();
    const save = await buttonStyle(saveProof);
    const publish = await buttonStyle(toPost);

    // Read the hover treatment too, after the shared colour transition settles.
    await saveProof.hover();
    await page.waitForTimeout(200);
    const saveHover = await buttonStyle(saveProof);
    await toPost.hover();
    await page.waitForTimeout(200);
    const publishHover = await buttonStyle(toPost);

    await page.getByRole('button', { name: 'Geo Report', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save as draft', exact: true })).toBeVisible();
    await expect(page.locator('.tabstrip').getByRole('button', { name: 'Geo Report', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.mouse.move(0, 0);
    const actions = header.locator('.head-actions');
    const draft = actions.getByRole('button', { name: 'Save as draft', exact: true });
    const report = actions.getByRole('button', { name: 'Save report', exact: true });
    const publishReport = actions.getByRole('button', { name: 'Publish on X', exact: true });
    await expect(draft).toBeEnabled();
    await expect(report).toBeDisabled();
    await expect(publishReport).toBeDisabled();
    expect(await buttonStyle(actions.getByRole('button', { name: 'Open', exact: true }))).toEqual(neutral);
    expect(await buttonStyle(draft)).toEqual(neutral);
    expect(await buttonStyle(report)).toEqual(disabledSave);
    expect(await buttonStyle(publishReport)).toEqual(disabledPublish);
    expect(await actions.evaluate((element) => getComputedStyle(element).gap)).toBe(spacing);

    await page.locator('.post-text').first().fill('A verified location.');
    await expect(report).toBeEnabled();
    await expect(publishReport).toBeEnabled();
    expect(await buttonStyle(actions.getByRole('button', { name: 'Discard', exact: true }))).toEqual(neutral);
    expect(await buttonStyle(report)).toEqual(save);
    expect(await buttonStyle(publishReport)).toEqual(publish);
    await report.hover();
    await expect.poll(() => buttonStyle(report)).toEqual(saveHover);
    await publishReport.hover();
    await expect.poll(() => buttonStyle(publishReport)).toEqual(publishHover);

    fixture.expectNoUnexpectedRequests();
  });
}
