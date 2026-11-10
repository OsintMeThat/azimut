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
  test(`Post's Publish matches Proof's buttons in the ${theme} theme`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const fixture = await installAppFixture(page);
    await page.addInitScript((value) => localStorage.setItem('azimut:theme', value), theme);
    await page.goto('/#proof');
    await expect(page.locator('.tool-header').getByRole('button', { name: 'New proof', exact: true })).toBeVisible({ timeout: 15_000 });

    const header = page.locator('.tool-header');
    const saveProof = header.getByRole('button', { name: 'Save proof', exact: true });
    const toPost = header.getByRole('button', { name: 'To Post', exact: true });
    // nothing to save at home: the two wait for a proof, and stay disabled on an empty one
    await expect(saveProof).toHaveCount(0);
    await expect(toPost).toHaveCount(0);
    await header.getByRole('button', { name: 'New proof', exact: true }).click();
    await page.getByRole('dialog', { name: 'New proof' }).getByRole('button', { name: 'Start empty' }).click();
    await expect(saveProof).toBeDisabled();
    const disabledPublish = await buttonStyle(toPost);
    const neutral = await buttonStyle(header.getByRole('button', { name: 'Open proof', exact: true }));
    const spacing = await header.evaluate((element) => getComputedStyle(element).gap);

    await page.reload();
    await openProofWithPanel(page);
    await expect(saveProof).toBeEnabled();
    const publish = await buttonStyle(toPost);

    // Read the hover treatment too, after the shared colour transition settles.
    await toPost.hover();
    await page.waitForTimeout(200);
    const publishHover = await buttonStyle(toPost);

    await page.locator('.tabstrip').getByRole('button', { name: 'Post', exact: true }).click();
    const actions = header.locator('.head-actions');
    const publishReport = actions.getByRole('button', { name: 'Publish on X', exact: true });
    await expect(publishReport).toBeVisible();
    await expect(page.locator('.tabstrip').getByRole('button', { name: 'Post', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.mouse.move(0, 0);
    // a post saves itself, and Add to notes lives in its ⋯: Publish is the one button left to press
    await expect(header.getByRole('button', { name: /Save|Discard/ })).toHaveCount(0);
    await expect(header.getByRole('button', { name: 'More for this post' })).toBeVisible();
    await expect(publishReport).toBeDisabled();
    expect(await buttonStyle(actions.getByRole('button', { name: 'Open', exact: true }))).toEqual(neutral);
    expect(await buttonStyle(publishReport)).toEqual(disabledPublish);
    expect(await actions.evaluate((element) => getComputedStyle(element).gap)).toBe(spacing);

    await page.locator('.post-text').first().fill('A verified location.');
    await expect(publishReport).toBeEnabled();
    expect(await buttonStyle(publishReport)).toEqual(publish);
    await publishReport.hover();
    await expect.poll(() => buttonStyle(publishReport)).toEqual(publishHover);

    fixture.expectNoUnexpectedRequests();
  });
}
