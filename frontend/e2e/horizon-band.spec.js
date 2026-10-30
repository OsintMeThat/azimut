import { expect, test } from '@playwright/test';
import { CASE_ID, installAppFixture, PANEL_PATH } from './app.fixture.js';

// The band over a photo laid on the Horizon view. The terrain itself is not
// served here (every Horizon route answers that it is missing), which leaves
// the band, the photo and the view's own controls: what this spec is about.

// The fixture's panel is an SVG, which the overlay cannot draw from; a sky over
// a ridge as PNG stands in for it, so the photo is laid as a real one is.
const PHOTO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAbCAIAAAC1C5slAAAAWklEQVR42mNwy1swqBDDqINGHTTqoFEHjToIzUHTKgKAiEjVEMU0Vc8A14NfG7IymqpnIEYPVtNppJ4BvzY8RtNIPQORRtANjTpo1EGjDhp10KiDRh001B0EACZm1btZqPSgAAAAAElFTkSuQmCC',
  'base64'
);

async function layPhoto(page, { width = 1280, height = 800 } = {}) {
  await page.setViewportSize({ width, height });
  const fixture = await installAppFixture(page);
  await page.route('**/api/horizon/**', (route) => route.fulfill({ status: 404, json: { detail: 'No terrain in the browser fixture' } }));
  await page.route(`**/files/${CASE_ID}/${PANEL_PATH}*`, (route) => route.fulfill({ contentType: 'image/png', body: PHOTO_PNG }));
  await page.goto('/#horizon?ll=46.5586,7.8353&hd=95&tl=0&fov=60&r=plain');
  // Overlay asks for the photo when none is laid
  await page.getByRole('group', { name: 'Horizon mode' }).getByRole('button', { name: 'Overlay' }).click();
  await page.getByText('panel.svg').first().click();
  const band = page.getByRole('toolbar', { name: 'Photo over the view' });
  await expect(band).toBeVisible();
  await expect(band.getByText('could not be decoded')).toHaveCount(0);
  return { fixture, band };
}

/** Every button of the band lies inside it, none squeezed to nothing, and nothing runs past its right edge. */
async function expectAllInside(band) {
  const edge = await band.evaluate((bar) => {
    const box = bar.getBoundingClientRect();
    const buttons = [...bar.querySelectorAll(':scope > button, :scope > div > button, :scope > div > span > button')].filter(
      (button) => button.offsetParent
    );
    const name = (button) => button.getAttribute('aria-label') ?? button.textContent.trim();
    return {
      out: buttons.filter((button) => button.getBoundingClientRect().right > box.right + 0.5).map(name),
      squeezed: buttons.filter((button) => button.getBoundingClientRect().width < 20).map(name),
      overflow: bar.scrollWidth - bar.clientWidth,
    };
  });
  expect(edge.out).toEqual([]);
  expect(edge.squeezed).toEqual([]);
  expect(edge.overflow).toBeLessThanOrEqual(0);
}

test.describe('the band over a photo in Horizon', () => {
  test('keeps its last button in sight at 1280 px with the map and settings open', async ({ page }) => {
    const { band } = await layPhoto(page);
    await expect(page.getByRole('button', { name: 'Hide the map and settings' })).toBeVisible();
    await expect(band.getByRole('button', { name: 'Gestures and keys' })).toBeVisible();
    // what is said about the photo is the inspector's, not the band's
    await expect(band.getByRole('button', { name: 'Take the photo away' })).toHaveCount(0);
    const inspector = page.getByRole('complementary', { name: 'Map and settings' });
    await expect(inspector.getByRole('button', { name: 'Take the photo away' })).toBeVisible();
    await expect(inspector.getByRole('group', { name: 'What you know about the photo' })).toBeVisible();
    await expectAllInside(band);
    // a trace adds its own buttons, and the band still holds them all
    await band.getByRole('button', { name: 'Trace skyline' }).click();
    const frame = await page.locator('.frame').boundingBox();
    await page.keyboard.down('Alt');
    await page.mouse.move(frame.x + frame.width * 0.2, frame.y + frame.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(frame.x + frame.width * 0.6, frame.y + frame.height * 0.35, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await expect(band.getByRole('button', { name: 'Hide the trace' })).toBeVisible();
    await expect(inspector.getByRole('button', { name: 'Clear the whole trace' })).toBeVisible();
    await expectAllInside(band);
  });

  test('holds every button on a narrow window too, its words giving way first', async ({ page }) => {
    const { band } = await layPhoto(page, { width: 1024 });
    await expectAllInside(band);
    await expect(band.getByRole('button', { name: 'Move the photo' })).toBeVisible();
    await expect(band.getByRole('button', { name: 'Gestures and keys' })).toBeVisible();
  });

  test('says which side a drag moves with a hand beside each end of the slider', async ({ page }) => {
    const { band } = await layPhoto(page);
    const photo = band.getByRole('button', { name: 'Move the photo' });
    const terrain = band.getByRole('button', { name: 'Move the terrain' });
    await expect(terrain).toHaveAttribute('aria-pressed', 'true');
    await expect(photo).toHaveAttribute('aria-pressed', 'false');
    // the photo's hand lights beside the terrain's: both move, held together
    await photo.click();
    await expect(photo).toHaveAttribute('aria-pressed', 'true');
    await expect(terrain).toHaveAttribute('aria-pressed', 'true');
    await expect(band.getByRole('button', { name: 'Reshape the photo' })).toBeDisabled();
    // the terrain's goes out, the photo alone moves
    await terrain.click();
    await expect(terrain).toHaveAttribute('aria-pressed', 'false');
    await expect(photo).toHaveAttribute('aria-pressed', 'true');
    // the only one lit hands over
    await photo.click();
    await expect(photo).toHaveAttribute('aria-pressed', 'false');
    await expect(terrain).toHaveAttribute('aria-pressed', 'true');
    // L moves both, and back; the view's keys want the pointer over it, clear of the fixture's notice
    const frame = await page.locator('.frame').boundingBox();
    await page.mouse.move(frame.x + frame.width * 0.25, frame.y + frame.height * 0.8);
    await page.keyboard.press('l');
    await expect(photo).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('l');
    await expect(photo).toHaveAttribute('aria-pressed', 'false');
    await expect(band.getByRole('radiogroup')).toHaveCount(0);
  });

  test('folds the trace’s details until asked, and draws the photo above the terrain only on a press', async ({ page }) => {
    const { band } = await layPhoto(page);
    await band.getByRole('button', { name: 'Trace skyline' }).click();
    const frame = await page.locator('.frame').boundingBox();
    await page.keyboard.down('Alt');
    await page.mouse.move(frame.x + frame.width * 0.2, frame.y + frame.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(frame.x + frame.width * 0.6, frame.y + frame.height * 0.35, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await page.keyboard.press('Escape');
    const details = band.getByRole('button', { name: 'Details' });
    await expect(details).toHaveAttribute('aria-pressed', 'false');
    await details.click();
    await expect(details).toHaveAttribute('aria-pressed', 'true');
    // D folds them again, the pointer over the view
    await page.mouse.move(frame.x + frame.width * 0.25, frame.y + frame.height * 0.8);
    await page.keyboard.press('d');
    await expect(details).toHaveAttribute('aria-pressed', 'false');
    // nothing side by side until asked; with no terrain served here, the press says why it cannot draw
    await expect(page.getByRole('region', { name: 'Photo above the terrain' })).toHaveCount(0);
    await band.getByRole('button', { name: 'Side by side' }).click();
    await expect(page.getByText('Could not draw them side by side: the view has not finished landing')).toBeVisible();
    await expectAllInside(band);
  });

  test('keeps how the ground is drawn on the view, out of the way while the pen is out', async ({ page }) => {
    const { band } = await layPhoto(page);
    const ground = page.getByRole('group', { name: 'Ground drawn as' });
    await expect(ground).toBeVisible();
    await expect(page.locator('.frame').getByRole('button', { name: 'Ridge lines' })).toBeVisible();
    await expect(band.getByRole('button', { name: 'Ridge lines' })).toHaveCount(0);
    const pen = band.getByRole('button', { name: 'Trace skyline' });
    await pen.click();
    await expect(ground).toHaveCount(0);
    await pen.click();
    await expect(ground).toBeVisible();
    await band.getByRole('button', { name: 'Reshape the photo' }).click();
    await expect(ground).toHaveCount(0);
  });
});

test.describe('a Horizon setting found from the command palette', () => {
  test('opens Horizon on its group, the inspector out and the row lit', async ({ page }) => {
    await layPhoto(page);
    await page.getByRole('button', { name: 'Hide the map and settings' }).click();
    await expect(page.getByRole('button', { name: 'Show the map and settings' })).toBeVisible();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Go to', exact: true });
    await palette.getByRole('combobox').fill('haze');
    const row = palette.getByRole('group', { name: 'Horizon settings' }).getByRole('option', { name: /Visibility/ });
    await expect(row).toContainText('What the view shows');
    await row.click();
    await expect(palette).toBeHidden();
    await expect(page.getByRole('button', { name: 'Hide the map and settings' })).toBeVisible();
    await expect(page.locator('[data-setting="visibility"]')).toHaveClass(/sought/);
  });
});
