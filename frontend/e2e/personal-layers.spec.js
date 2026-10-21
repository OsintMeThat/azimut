import { expect, test } from '@playwright/test';
import { awaitMapReady, CASE_ID, installAppFixture, showSaved } from './app.fixture.js';

/** Open a style button inside `scope` and pick an icon in its palette, which floats over the page. */
async function chooseIcon(page, scope, label, icon) {
  await scope.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('button', { name: `${label} ${icon} icon`, exact: true }).click();
}

/** An item of the floating menu called `menu`. */
const menuItem = (page, menu, label) => page.getByRole('menu', { name: menu, exact: true }).getByRole('button', { name: label, exact: true });

/** The edit bar a personal layer puts on the map it is edited on. */
const tools = (page) => page.getByRole('toolbar', { name: 'Layer tools', exact: true });

async function clickCard(page, x, y) {
  const card = page.locator('.layer-card');
  await page.mouse.click(x, y);
  await expect.poll(async () => {
    if (await card.isVisible()) return true;
    await page.mouse.click(x, y);
    return card.isVisible();
  }).toBe(true);
}

test('long imported groups expand explicitly and a selected range moves and removes together', async ({ page }) => {
  const fixture = await personalFixture(page, { imported: true, count: 250 });
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  await page.getByRole('button', { name: 'Create editable copy of Source map', exact: true }).click();
  await page.getByRole('button', { name: 'Create layer', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Layer editor', exact: true });
  await expect(panel.locator('.features li')).toHaveCount(100);
  await panel.getByRole('button', { name: 'Show all 250', exact: true }).click();
  await expect(panel.locator('.features li')).toHaveCount(250);
  await panel.getByRole('button', { name: 'Point 250', exact: true }).click();
  await panel.getByRole('button', { name: 'Point 241', exact: true }).click({ modifiers: ['Shift'] });
  await expect(panel.getByText('10 selected', { exact: true })).toBeVisible();
  const own = fixture.rows.find((row) => row.editable), features = fixture.collections.get(own.name);
  const before = structuredClone(features);
  await panel.getByRole('button', { name: 'Feature actions', exact: true }).click();
  await menuItem(page, 'Feature actions', 'Move with a handle').click();
  await page.getByRole('button', { name: 'Move vertex 1.1', exact: true }).press('Shift+ArrowRight');
  await tools(page).getByRole('button', { name: 'Save geometry', exact: true }).click();
  await expect.poll(() => features.at(-1).geometry.coordinates[0]).not.toBe(before.at(-1).geometry.coordinates[0]);
  expect(features[0].geometry).toEqual(before[0].geometry);
  await tools(page).getByRole('button', { name: 'Remove selected', exact: true }).click();
  await expect(panel.getByText('240 features', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(panel.getByText('250 features', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Point 1', exact: true }).click();
  await expect(panel.getByLabel('Feature name', { exact: true })).toBeInViewport();
  expect(fixture.promotions).toBe(0);
});

test('personal layers download their styles', async ({ page }) => {
  const fixture = await personalFixture(page);
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  const panel = await createPersonalLayer(page, 'Download map');
  const map = await page.locator('.map').boundingBox();
  await tools(page).getByRole('button', { name: 'Add markers', exact: true }).click();
  await chooseIcon(page, tools(page), 'Style', 'Tank');
  // the press on the map closes the palette and adds the marker in the style picked
  await page.mouse.click(map.x + map.width * .4, map.y + map.height * .5); await page.keyboard.press('Escape');
  await expect(panel.getByText('1 feature', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  for (const [format, label] of [['kmz', 'KMZ'], ['kml', 'KML'], ['geojson', 'GeoJSON']]) {
    await page.getByRole('button', { name: 'Download Download map', exact: true }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('dialog', { name: 'Download layer' }).getByRole('button', { name: new RegExp(`^${label}`) }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(`Download map.${format}`);
    expect(await download.failure()).toBeNull();
  }
  const icons = fixture.exports.find((entry) => entry.format === 'kmz').body.icons;
  expect(Object.keys(icons)).toEqual(['badge-tank-0072b2']);
  expect(Buffer.from(icons['badge-tank-0072b2'], 'base64').subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
});

test('the entire symbol palette rasterizes inside its badge and pin height matches round markers', async ({ page }) => {
  await installAppFixture(page); await page.goto('/#satellite'); await awaitMapReady(page);
  const result = await page.evaluate(async () => {
    const { badgeImage, personalMarkerImage } = await import('/src/lib/map/addedLayer.js');
    const choices = (await import('/src/lib/map/layerSymbols.json')).default;
    const bounds = (pixels, sdf = false) => {
      const occupied = [];
      for (let i = 3; i < pixels.data.length; i += 4) if (pixels.data[i] > (sdf ? 127 : 0)) occupied.push((i - 3) / 4);
      const xs = occupied.map((i) => i % 64), ys = occupied.map((i) => Math.floor(i / 64));
      return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    };
    const badges = choices.filter((choice) => choice.id.startsWith('badge-')).map((choice) => ({ id: choice.id, bounds: bounds(badgeImage(choice.id, '#0072b2')) }));
    const pin = bounds(personalMarkerImage('pin', '#0072b2'));
    return { badges, pinHeight: (pin.bottom - pin.top + 1) * .4, roundHeight: (badges[0].bounds.bottom - badges[0].bounds.top + 1) * .4 };
  });
  expect(result.badges).toHaveLength(62);
  for (const badge of result.badges) { expect(badge.bounds.left).toBeGreaterThan(0); expect(badge.bounds.right).toBeLessThan(63); }
  expect(Math.abs(result.pinHeight - result.roundHeight)).toBeLessThan(1);
});

test('reordering groups changes which overlapping pin or round marker receives a click', async ({ page }) => {
  await personalFixture(page);
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  const panel = await createPersonalLayer(page, 'Mixed symbols');
  const map = await page.locator('.map').boundingBox(), point = { x: map.x + map.width * .4, y: map.y + map.height * .5 };
  await tools(page).getByRole('button', { name: 'Add markers', exact: true }).click();
  await page.mouse.click(point.x, point.y); await page.keyboard.press('Escape');
  await panel.getByRole('button', { name: 'New group', exact: true }).click();
  await panel.getByLabel('New group name').fill('Vehicles');
  await panel.getByRole('button', { name: 'Create group', exact: true }).click();
  await panel.getByRole('button', { name: 'Settings of group Vehicles', exact: true }).click();
  await chooseIcon(page, page.getByRole('group', { name: 'Settings of group Vehicles', exact: true }), 'Group style', 'Tank');
  await tools(page).getByRole('button', { name: 'Add markers', exact: true }).click();
  await page.mouse.click(point.x, point.y); await page.keyboard.press('Escape');
  await expect(panel.getByText('2 features', { exact: true })).toBeVisible();
  // while the layer is edited, a click on the map picks the feature drawn on top
  await page.mouse.click(point.x, point.y - 9);
  await expect(panel.getByLabel('Feature name', { exact: true })).toHaveValue('Marker 1');
  await panel.getByRole('button', { name: 'Clear the selection', exact: true }).click();
  await panel.getByRole('button', { name: 'Move group Vehicles', exact: true })
    .dragTo(panel.getByRole('button', { name: 'Move group Markers', exact: true }));
  await page.mouse.click(point.x, point.y - 9);
  await expect(panel.getByLabel('Feature name', { exact: true })).toHaveValue('Marker 2');
  // …and out of the editor, the same click opens the card of that feature
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await clickCard(page, point.x, point.y);
  await expect(page.locator('.layer-card')).toContainText('Marker 2');
});

async function createPersonalLayer(page, title) {
  await page.getByRole('button', { name: 'New layer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New layer', exact: true });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(title);
  await dialog.getByRole('button', { name: 'Create layer', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layer editor', exact: true })).toBeVisible();
  return page.getByRole('region', { name: 'Layer editor', exact: true });
}

test('on the map a pin drags without the map moving, a loop picks two lines that merge, and a pasted post is a marker', async ({ page }) => {
  const fixture = await personalFixture(page);
  await page.route('**/api/geo/scan', (route) => route.fulfill({ json: {
    points: [{ lat: 48.8504, lon: 2.3502, text: '48.8504, 2.3502', format: 'decimal' }],
    links: ['https://x.com/someone/status/1'], date: '2026-09-13' } }));
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  const panel = await createPersonalLayer(page, 'Gestures');
  const map = await page.locator('.map').boundingBox();
  const at = (x, y) => ({ x: map.x + map.width * x, y: map.y + map.height * y });
  const features = fixture.collections.get(fixture.rows[0].name);
  // the rail's tools step aside while the layer is edited; its bar is on the map
  await expect(page.getByRole('button', { name: 'Save place' })).toHaveCount(0);
  await tools(page).getByRole('button', { name: 'Add markers', exact: true }).click();
  const pin = at(.4, .45); await page.mouse.click(pin.x, pin.y); await page.keyboard.press('Escape');
  await expect(panel.getByText('1 feature', { exact: true })).toBeVisible();
  const before = [...features[0].geometry.coordinates];
  await page.mouse.move(pin.x, pin.y - 18); await page.mouse.down();
  await page.mouse.move(pin.x + 60, pin.y - 18, { steps: 8 }); await page.mouse.up();
  // sixty pixels east at zoom 16: had the map panned with the pointer, the pin would not have moved
  await expect.poll(() => features[0].geometry.coordinates[0] - before[0]).toBeGreaterThan(0.0009);
  expect(Math.abs(features[0].geometry.coordinates[1] - before[1])).toBeLessThan(0.0002);

  for (const [x1, x2] of [[.3, .38], [.42, .5]]) {
    await tools(page).getByRole('button', { name: 'Draw line', exact: true }).click();
    const a = at(x1, .7), b = at(x2, .72);
    await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y);
    await tools(page).getByRole('button', { name: 'Save geometry', exact: true }).click();
  }
  await expect(panel.getByText('3 features', { exact: true })).toBeVisible();
  await tools(page).getByRole('button', { name: 'Select an area', exact: true }).click();
  const loop = [at(.26, .64), at(.56, .64), at(.56, .8), at(.26, .8)];
  await page.mouse.move(loop[0].x, loop[0].y); await page.mouse.down();
  for (const corner of [...loop.slice(1), loop[0]]) await page.mouse.move(corner.x, corner.y, { steps: 4 });
  await page.mouse.up();
  await expect(panel.getByText('2 selected', { exact: true })).toBeVisible();
  await tools(page).getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(panel.getByText('2 features', { exact: true })).toBeVisible();
  expect(features.find((feature) => feature.geometry.type === 'MultiLineString')).toBeTruthy();

  await tools(page).getByRole('button', { name: 'Paste a position', exact: true }).click();
  const paste = page.getByRole('dialog', { name: 'Paste a position' });
  await paste.getByLabel('Pasted text').fill('Strike on the depot, 13 SEP 2026. 48.8504, 2.3502 https://x.com/someone/status/1');
  await expect(paste.getByLabel('Geolocated by someone else')).toBeChecked();
  await paste.getByRole('button', { name: 'Add marker', exact: true }).click();
  await expect(panel.getByText('3 features', { exact: true })).toBeVisible();
  expect(features.at(-1).properties).toMatchObject({ date: '2026-09-13', provenance: 'external', links: ['https://x.com/someone/status/1'] });
  await page.screenshot({ path: test.info().outputPath('map-edit-bar.png') });
});

/** How many pixels of a marker's default blue the page shows in a box. */
async function bluePixels(page, clip) {
  const picture = await page.screenshot({ clip });
  return page.evaluate(async (bytes) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const context = new OffscreenCanvas(image.width, image.height).getContext('2d');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    let blue = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 70 && data[i + 2] > 120 && data[i + 2] > data[i + 1] + 30) blue += 1;
    return blue;
  }, [...picture]);
}

test('a pin let go is drawn where it lands at once, before the layer has saved it', async ({ page }) => {
  const fixture = await personalFixture(page);
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  const panel = await createPersonalLayer(page, 'Landing');
  const map = await page.locator('.map').boundingBox();
  const pin = { x: map.x + map.width * .4, y: map.y + map.height * .45 };
  // the pin stands on its point, so its body is above it
  const blue = (x) => bluePixels(page, { x: x - 15, y: pin.y - 40, width: 30, height: 40 });
  await tools(page).getByRole('button', { name: 'Add markers', exact: true }).click();
  await page.mouse.click(pin.x, pin.y); await page.keyboard.press('Escape');
  await expect(panel.getByText('1 feature', { exact: true })).toBeVisible();
  await expect.poll(() => blue(pin.x)).toBeGreaterThan(20);
  const features = fixture.collections.get(fixture.rows[0].name);
  const before = features[0].geometry.coordinates[0];
  // the save is held: whatever the map shows meanwhile is the page's own drawing
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/selection', async (route) => { await held; await route.fallback(); });
  await page.mouse.move(pin.x, pin.y - 18); await page.mouse.down();
  await page.mouse.move(pin.x + 120, pin.y - 18, { steps: 8 }); await page.mouse.up();
  // the dragged copy goes once the map has drawn the pin where it landed
  await expect(page.locator('.ghost-mark')).toHaveCount(0);
  expect(await blue(pin.x + 120)).toBeGreaterThan(20);
  expect(await blue(pin.x)).toBe(0);
  const reread = page.waitForResponse((response) => response.url().endsWith('/data'));
  release();
  await reread;
  expect(features[0].geometry.coordinates[0] - before).toBeGreaterThan(0.001);
  // and the layer read back keeps it there
  await expect.poll(() => blue(pin.x + 120)).toBeGreaterThan(20);
  expect(await blue(pin.x)).toBe(0);
});

test('a source feature is copied into one of the analyst\'s layers as somebody else\'s point', async ({ page }) => {
  const fixture = await personalFixture(page, { imported: true });
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  const panel = await createPersonalLayer(page, 'Collected');
  await tools(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(panel).not.toBeVisible();
  await page.getByRole('button', { name: 'Source map', exact: true }).click();
  const map = await page.locator('.map').boundingBox();
  await clickCard(page, map.x + map.width / 2, map.y + map.height / 2 - 9);
  const mine = fixture.rows.find((row) => row.editable);
  await page.route(`**/api/cases/${CASE_ID}/layer-targets**`, (route) => route.fulfill({ json: [
    { name: mine.name, title: mine.title, styles: [], markers: [], groups: fixture.groups.get(mine.name) }] }));
  // the card says what it can do in words, and opens the menu a proof's point opens
  await page.locator('.layer-card').getByRole('button', { name: 'Add to a layer', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Add to a layer', exact: true });
  await page.screenshot({ path: test.info().outputPath('card-add-menu.png') });
  await menu.getByRole('button', { name: 'Collected', exact: true }).click();
  await menu.getByRole('button', { name: 'Point icon Tank icon', exact: true }).click();
  await menu.getByRole('button', { name: 'Add to Collected', exact: true }).click();
  await expect(menu).toHaveCount(0);
  const copied = fixture.collections.get(mine.name);
  expect(copied).toHaveLength(1);
  expect(copied[0].properties).toMatchObject({ name: 'Original marker', provenance: 'external', symbol: 'badge-tank' });
});

test('feature grips reorder rows, move selected rows into groups and retain the group menu', async ({ page }) => {
  const fixture = await personalFixture(page, { imported: true, count: 4 });
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  await page.getByRole('button', { name: 'Create editable copy of Source map', exact: true }).click();
  await page.getByRole('button', { name: 'Create layer', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Layer editor', exact: true });
  await expect(panel.locator('.features input[type="checkbox"]')).toHaveCount(0);
  const grip = panel.getByRole('button', { name: 'Move group Markers', exact: true });
  const svg = grip.locator('svg'); await expect(svg).toBeVisible();
  expect(await svg.evaluate((node) => ({ width: node.getBoundingClientRect().width, stroke: getComputedStyle(node).strokeWidth }))).toEqual({ width: 14, stroke: '2.5px' });
  await panel.getByRole('button', { name: 'Move Point 1', exact: true }).dragTo(panel.getByRole('button', { name: 'Point 4', exact: true }), { targetPosition: { x: 35, y: 2 } });
  await expect(panel.locator('.feature-row .name')).toHaveText(['Point 1', 'Point 4', 'Point 3', 'Point 2']);
  await panel.getByRole('button', { name: 'New group', exact: true }).click();
  await panel.getByLabel('New group name').fill('Reviewed');
  await panel.getByRole('button', { name: 'Create group', exact: true }).click();
  await panel.getByRole('button', { name: 'Point 1', exact: true }).click();
  await panel.getByRole('button', { name: 'Point 4', exact: true }).click({ modifiers: ['Shift'] });
  await expect(panel.getByText('2 selected', { exact: true })).toBeVisible();
  const before = structuredClone(fixture.collections.get(fixture.rows[0].name).map((feature) => feature.geometry));
  await panel.getByRole('button', { name: 'Move Point 1', exact: true }).dragTo(panel.getByRole('button', { name: 'Move group Reviewed', exact: true }));
  const reviewed = panel.locator('.group').filter({ has: page.getByRole('button', { name: 'Move group Reviewed', exact: true }) });
  await expect(reviewed.locator('.feature-row .name')).toHaveText(['Point 1', 'Point 4']);
  await panel.getByLabel('Feature group', { exact: true }).selectOption('markers');
  await expect(reviewed.locator('.feature-row')).toHaveCount(0);
  const current = fixture.collections.get(fixture.rows[0].name).map((feature) => feature.geometry);
  expect(current.sort((a, b) => a.coordinates[0] - b.coordinates[0])).toEqual(before.sort((a, b) => a.coordinates[0] - b.coordinates[0]));
  await page.screenshot({ path: test.info().outputPath('layer-feature-grips.png') });
});

test('layer names and optional descriptions save as they are left, reopen and restore through Discard', async ({ page }) => {
  const fixture = await personalFixture(page);
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  await page.getByRole('button', { name: 'New layer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New layer', exact: true });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Original map');
  await dialog.getByRole('textbox', { name: 'Description (optional)', exact: true }).fill('Initial context');
  await dialog.getByRole('button', { name: 'Create layer', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Layer editor', exact: true });
  const name = panel.getByLabel('Layer name', { exact: true }), description = panel.getByLabel('Layer description', { exact: true });
  await expect(description).toHaveValue('Initial context');
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Original map', exact: true }).click();
  await name.fill('Renamed map'); await name.press('Enter');
  await expect.poll(() => fixture.rows[0].title).toBe('Renamed map');
  await description.fill('Updated context'); await description.press('Tab');
  await expect.poll(() => fixture.rows[0].description).toBe('Updated context');
  await panel.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.getByRole('alertdialog', { name: 'Discard changes?' }).getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Original map', exact: true }).click();
  await expect(description).toHaveValue('Initial context');
  await name.fill('Final map');
  await description.fill('Final context');
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Final map', exact: true }).click();
  await expect(description).toHaveValue('Final context');
  expect(fixture.rows[0].description).toBe('Final context');
});

test('group size and native dragging persist, while Discard restores the session baseline', async ({ page }) => {
  const fixture = await personalFixture(page);
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  let panel = await createPersonalLayer(page, 'Group map');
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Group map', exact: true }).click();
  panel = page.getByRole('region', { name: 'Layer editor', exact: true });
  await panel.getByRole('button', { name: 'New group', exact: true }).click();
  await panel.getByLabel('New group name').fill('Vehicles');
  await panel.getByRole('button', { name: 'Create group', exact: true }).click();
  await panel.getByRole('button', { name: 'Settings of group Vehicles', exact: true }).click();
  const settings = page.getByRole('group', { name: 'Settings of group Vehicles', exact: true });
  const size = settings.getByRole('slider', { name: 'Icon size for Vehicles' });
  await size.fill('2'); await size.dispatchEvent('change');
  await expect(settings.locator('output').first()).toHaveText('200%');
  const width = settings.getByRole('slider', { name: 'Line width for Vehicles' });
  await width.fill('5.5'); await width.dispatchEvent('change');
  await expect.poll(() => fixture.groups.get(fixture.rows[0].name)[1].stroke).toBe(5.5);
  await expect.poll(() => fixture.groups.get(fixture.rows[0].name)[1].size).toBe(2);
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await panel.getByRole('button', { name: 'Move group Vehicles', exact: true })
    .dragTo(panel.getByRole('button', { name: 'Move group Markers', exact: true }));
  await expect.poll(() => fixture.groups.get(fixture.rows[0].name)[0].name).toBe('Vehicles');
  await page.screenshot({ path: test.info().outputPath('group-size-and-order.png') });
  const discard = async () => {
    await panel.getByRole('button', { name: 'Discard changes', exact: true }).click();
  };
  await discard();
  const confirm = page.getByRole('alertdialog', { name: 'Discard changes?' });
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(fixture.groups.get(fixture.rows[0].name)).toHaveLength(2);
  await discard();
  await confirm.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(panel).not.toBeVisible();
  expect(fixture.groups.get(fixture.rows[0].name).map((group) => group.name)).toEqual(['Markers']);
  // nothing changed yet: Discard just leaves, with no question
  await page.getByRole('button', { name: 'Edit Group map', exact: true }).click();
  await panel.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: 'Discard changes?' })).toHaveCount(0);
  await expect(panel).not.toBeVisible();
});

test('marker dragging and editable line and area vertices save geometry without creating case places', async ({ page }) => {
  const fixture = await personalFixture(page);
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  const panel = await createPersonalLayer(page, 'Drawn map');
  const map = await page.locator('.map').boundingBox();
  const click = (x, y) => page.mouse.click(map.x + map.width * x, map.y + map.height * y);
  await tools(page).getByRole('button', { name: 'Add markers', exact: true }).click(); await click(.4, .5);
  await expect(panel.getByText('1 feature', { exact: true })).toBeVisible(); await page.keyboard.press('Escape');
  const features = fixture.collections.get(fixture.rows[0].name);
  const initial = [...features[0].geometry.coordinates];
  // picked on the map, where it stands (a row of the list would fly the map to it)
  const tip = { x: map.x + map.width * .4, y: map.y + map.height * .5 };
  await page.mouse.click(tip.x, tip.y - 9);
  await expect(panel.getByLabel('Feature name', { exact: true })).toHaveValue('Marker 1');
  // the selected marker wears a ring: its knob, pulled toward a point, turns the marker to face it
  const knob = page.getByRole('button', { name: 'Set the direction', exact: true });
  const grip = await knob.boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(tip.x + 90, tip.y + 2, { steps: 6 }); await page.mouse.up();
  await expect.poll(() => features[0].properties.bearing).toBe(90);
  await expect(panel.getByRole('group', { name: 'Feature', exact: true })).toContainText('90° E');
  await expect(page.getByRole('button', { name: 'Direction 90° E', exact: true })).toBeVisible();
  expect(features[0].geometry.coordinates).toEqual(initial);
  await tools(page).getByRole('button', { name: 'Draw line', exact: true }).click();
  await click(.34, .40); await click(.48, .54); await page.keyboard.press('Enter');
  await expect(panel.getByText('2 features', { exact: true })).toBeVisible();
  await tools(page).getByRole('button', { name: 'Draw area', exact: true }).click();
  await click(.34, .62); await click(.48, .62); await click(.48, .76);
  await tools(page).getByRole('button', { name: 'Save geometry', exact: true }).click();
  await expect(panel.getByText('3 features', { exact: true })).toBeVisible();
  const area = features.find((feature) => feature.geometry.type === 'Polygon');
  expect(area.geometry.coordinates[0][0]).toEqual(area.geometry.coordinates[0].at(-1));
  await panel.getByRole('button', { name: 'Area 2', exact: true }).click();
  await tools(page).getByRole('button', { name: 'Reshape', exact: true }).click();
  await page.getByRole('button', { name: 'Add vertex 1.1', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Move vertex/ })).toHaveCount(4);
  await page.getByRole('button', { name: 'Move vertex 1.2', exact: true }).press('Shift+ArrowRight');
  await tools(page).getByRole('button', { name: 'Save geometry', exact: true }).click();
  await expect.poll(() => area.geometry.coordinates[0].length).toBe(5);
  await page.screenshot({ path: test.info().outputPath('lines-and-areas.png') });
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: 'Edit Drawn map', exact: true }).click();
  await expect(panel.getByText('3 features', { exact: true })).toBeVisible();
  expect(fixture.promotions).toBe(0);
});

for (const tool of ['detect', 'compare', 'horizon']) {
  test(`personal markers and shapes can be created and reopened from ${tool}`, async ({ page }) => {
    const fixture = await personalFixture(page);
    await page.goto(`/#${tool}`);
    if (tool === 'compare') {
      await expect(page.locator('.empty-slot')).toHaveCount(2);
      for (const letter of ['A', 'B']) {
        await page.locator('.empty-slot').filter({ has: page.locator('.slot-letter', { hasText: letter }) }).click();
        await page.locator('.provider-card').filter({ hasText: 'Esri World Imagery' }).click();
      }
    }
    await awaitMapReady(page, tool === 'compare' ? 2 : 1);
    const layers = page.getByRole('button', { name: tool === 'horizon' ? 'Map layers' : /^Layers/ });
    await layers.click(); const panel = await createPersonalLayer(page, `${tool} map`);
    const map = await page.locator('.map:visible').first().boundingBox();
    await tools(page).getByRole('button', { name: 'Add markers', exact: true }).click();
    await page.mouse.click(map.x + map.width * .35, map.y + map.height * .5);
    await expect(panel.getByText('1 feature', { exact: true })).toBeVisible(); await page.keyboard.press('Escape');
    await tools(page).getByRole('button', { name: 'Draw line', exact: true }).click();
    await page.mouse.click(map.x + map.width * .35, map.y + map.height * .4);
    await page.mouse.click(map.x + map.width * .50, map.y + map.height * .6);
    await tools(page).getByRole('button', { name: 'Save geometry', exact: true }).click();
    await expect(panel.getByText('2 features', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Done', exact: true }).click();
    await layers.click(); await page.getByRole('button', { name: `Edit ${tool} map`, exact: true }).click();
    await expect(panel.getByText('2 features', { exact: true })).toBeVisible();
    expect(fixture.promotions).toBe(0);
  });
}

test('switching map tools keeps the same edit checkpoint and unsaved feature form', async ({ page }) => {
  const fixture = await personalFixture(page, { imported: true });
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  await page.getByRole('button', { name: 'Create editable copy of Source map', exact: true }).click();
  await page.getByRole('button', { name: 'Create layer', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Layer editor', exact: true });
  await panel.getByRole('button', { name: 'Original marker', exact: true }).click();
  await panel.getByLabel('Feature name', { exact: true }).fill('Unsaved across maps');
  for (const tool of ['detect', 'compare', 'horizon', 'satellite']) {
    await page.goto(`/#${tool}`);
    await expect(page.locator(`.topbar button[title="Guide: ${tool[0].toUpperCase() + tool.slice(1)}"]`)).toBeVisible();
    await expect(panel.getByLabel('Feature name', { exact: true })).toHaveValue('Unsaved across maps');
  }
  await panel.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.getByRole('alertdialog', { name: 'Discard changes?' }).getByRole('button', { name: 'Discard changes', exact: true }).click();
  const own = fixture.rows.find((row) => row.editable);
  expect(fixture.collections.get(own.name)[0].properties.name).toBe('Original marker');
});

async function personalFixture(page, { imported = false, shared = false, count = 1 } = {}) {
  await installAppFixture(page);
  let serial = 0;
  let promotions = 0;
  const uploads = [];
  const collections = new Map();
  const groups = new Map();
  const removed = new Map();
  const checkpoints = new Map();
  const batches = new Map();
  const exports = [];
  const shapeSerial = new Map();
  const rows = [];
  await page.route(`**/api/cases/${CASE_ID}/horizon/views`, (route) => route.fulfill({ json: [] }));
  const casePlace = { id: 'shared-place', label: 'Case gate', type: 'place', attrs: { lat: 48.85, lon: 2.35 } };
  let placeAlive = shared;
  let deleted = 0;
  const savedIndex = () => placeAlive ? [{ id: casePlace.id, kind: 'place', title: casePlace.label,
    lat: 48.85, lon: 2.35, relations: 1 }] : [];
  await page.route(`**/api/cases/${CASE_ID}/satellite/index`, (route) => route.fulfill({ json: savedIndex() }));
  await page.route(`**/api/cases/${CASE_ID}/layer-links`, (route) => route.fulfill({ json: savedIndex()
    .map(({ id, kind, title, lat, lon }) => ({ id, kind, title, lat, lon })) }));
  await page.route(`**/api/cases/${CASE_ID}/layer-palette`, (route) => route.fulfill({ json: { colours: [] } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/${casePlace.id}/dependents`,
    (route) => route.fulfill({ json: { cascade: [], tombstone: [] } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/${casePlace.id}`, (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    placeAlive = false; deleted += 1;
    for (const row of rows) row.sha256 = (++serial).toString(16).padStart(64, '0');
    return route.fulfill({ json: { deleted: [casePlace.id], trash: 'deleted-place' } });
  });
  await page.route(`**/api/cases/${CASE_ID}/trash/deleted-place/restore`, (route) => {
    placeAlive = true;
    for (const row of rows) row.sha256 = (++serial).toString(16).padStart(64, '0');
    return route.fulfill({ json: { restored: [casePlace.id] } });
  });
  const source = { name: 'source', title: 'Source map', source: { kind: 'file', name: 'source.kmz' },
    features: count, categories: [], icons: 0, sha256: 'a'.repeat(64), refresh: {}, hidden: [] };
  const sourceFeatures = Array.from({ length: count }, (_, index) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [2.35 + index * .00001, 48.85] },
    properties: { name: count === 1 ? 'Original marker' : `Point ${index + 1}`, colour: '#0072b2', category: 'Markers', index } }));
  if (imported) {
    rows.push(source);
    collections.set('source', sourceFeatures);
  }
  const create = (title, fromSource = false, description = '') => {
    const name = `working-${++serial}`;
    const features = fromSource ? sourceFeatures.map((feature) => ({ ...feature,
      properties: { ...feature.properties, key: count === 1 ? 'imported-marker' : `imported-${feature.properties.index}`, group: 'markers' } })) : [];
    const row = { name, title, description, editable: true, source: { kind: 'editable' },
      origin: fromSource ? { source: source.source } : null,
      features: features.length, categories: [], icons: 0, hidden: [], refresh: {}, sha256: String(serial).repeat(64), edit_revision: '0'.repeat(64), edit_changed: false };
    collections.set(name, features);
    groups.set(name, [{ id: 'markers', name: 'Markers', mode: 'individual', colour: '#0072b2', symbol: 'pin', size: 1, stroke: 2 }]);
    rows.unshift(row);
    return row;
  };
  await page.route(`**/api/cases/${CASE_ID}/map-layers`, (route) => route.fulfill({ json: rows }));
  await page.route(`**/api/cases/${CASE_ID}/map-layers/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.split('/map-layers/')[1];
    const method = route.request().method();
    if (path === 'editable' && method === 'POST') {
      const body = route.request().postDataJSON();
      return route.fulfill({ json: create(body.title, false, body.description) });
    }
    if (path === 'editable/upload' && method === 'POST') {
      const payload = route.request().postDataBuffer();
      uploads.push(payload);
      const title = payload.toString().match(/name="title"\r\n\r\n([^\r]+)/)?.[1] || 'My layer';
      const description = payload.toString().match(/name="description"\r\n\r\n([^\r]*)/)?.[1] || '';
      return route.fulfill({ json: create(title, true, description) });
    }
    if (path === 'order' && method === 'PUT') {
      const ordered = route.request().postDataJSON().names.map((name) => rows.find((row) => row.name === name));
      rows.splice(0, rows.length, ...ordered);
      return route.fulfill({ json: rows });
    }
    if (path === `places/${casePlace.id}/usage`) {
      return route.fulfill({ json: { place: casePlace, related: [
        { id: 'proof-1', label: 'Gate proof', type: 'proof' },
        { id: 'clip-1', label: 'Gate footage', type: 'media' }],
        layers: rows.filter((row) => collections.get(row.name).some((feature) => feature.properties.entity_id === casePlace.id)) } });
    }
    const [name, action, key, last] = path.split('/');
    const row = rows.find((entry) => entry.name === name);
    if (action === 'editable-copy') {
      const body = route.request().postDataJSON();
      return route.fulfill({ json: create(body.title, true, body.description) });
    }
    if (!row) return route.fallback();
    const features = collections.get(name);
    const ownGroups = groups.get(name);
    const visibleFeatures = () => features.map((feature) => {
      const properties = { ...feature.properties };
      if (properties.entity_id === casePlace.id && !placeAlive) delete properties.entity_id;
      // what the server adds to a marker that follows a case item
      if (properties.entity_id) Object.assign(properties, { entity_type: 'place',
        entity_label: properties.entity_id === casePlace.id ? casePlace.label : properties.name });
      return { ...feature, properties };
    });
    const answer = () => ({ layer: row, groups: ownGroups, checkpoint: checkpoints.has(name) ? 'c'.repeat(32) : null, document: { type: 'FeatureCollection', features: visibleFeatures() } });
    const changed = () => { row.features = features.length; row.sha256 = (++serial).toString(16).padStart(64, '0'); row.edit_revision = row.sha256; row.edit_changed = checkpoints.has(name); };
    if (!action && method === 'PATCH') { Object.assign(row, route.request().postDataJSON()); changed(); return route.fulfill({ json: row }); }
    if (!action && method === 'DELETE') { rows.splice(rows.indexOf(row), 1); return route.fulfill({ json: { deleted: ['layer'], trash: 'deleted-layer' } }); }
    if (action === 'edit' && key === 'finish') {
      if (route.request().postDataJSON().discard) {
        const before = checkpoints.get(name);
        features.splice(0, features.length, ...before.features); ownGroups.splice(0, ownGroups.length, ...before.groups); row.hidden = before.hidden;
        row.title = before.title; row.description = before.description;
      }
      checkpoints.delete(name); changed(); row.edit_changed = false;
      return route.fulfill({ json: answer() });
    }
    if (action === 'edit') {
      if (method === 'POST' && !checkpoints.has(name)) checkpoints.set(name, { features: structuredClone(features), groups: structuredClone(ownGroups), hidden: [...row.hidden], title: row.title, description: row.description });
      if (method === 'PATCH') { Object.assign(row, route.request().postDataJSON()); changed(); }
      return route.fulfill({ json: answer() });
    }
    if (action === 'data') return route.fulfill({ json: { type: 'FeatureCollection', features: visibleFeatures().map((feature) => {
      const group = ownGroups?.find((group) => group.id === feature.properties.group);
      return { ...feature, properties: { ...feature.properties, icon_scale: group?.size ?? 1, stroke_width: group?.stroke ?? 2,
        ...(group?.mode === 'uniform' ? { category: group.name, colour: group.colour, symbol: group.symbol, icon: '' } : {}) } };
    }).sort((a, b) => (ownGroups?.findIndex((group) => group.id === b.properties.group) ?? 0) - (ownGroups?.findIndex((group) => group.id === a.properties.group) ?? 0))
      .map((feature, index) => ({ ...feature, id: index, properties: { ...feature.properties, index } })) } });
    if (action === 'features' && key === 'order') {
      const body = route.request().postDataJSON(), moving = new Set(body.keys), order = features.toReversed();
      const block = order.filter((feature) => moving.has(feature.properties.key));
      const target = order.filter((feature) => feature.properties.group === body.group && !moving.has(feature.properties.key));
      const at = body.before ? target.findIndex((feature) => feature.properties.key === body.before) : target.length;
      block.forEach((feature) => { feature.properties.group = body.group; }); target.splice(at, 0, ...block);
      const sorted = ownGroups.toReversed().flatMap((group) => (group.id === body.group ? target : order.filter((feature) => feature.properties.group === group.id && !moving.has(feature.properties.key))).toReversed());
      features.splice(0, features.length, ...sorted); changed(); return route.fulfill({ json: answer() });
    }
    if (action === 'groups' && key === 'order') {
      const sorted = route.request().postDataJSON().ids.map((id) => ownGroups.find((group) => group.id === id));
      ownGroups.splice(0, ownGroups.length, ...sorted); changed(); return route.fulfill({ json: answer() });
    }
    if (action === 'selection' && last === 'restore') {
      for (const item of batches.get(`${name}/${key}`)) features.splice(item.at, 0, item.feature);
      changed(); return route.fulfill({ json: answer() });
    }
    if (action === 'selection') {
      const body = route.request().postDataJSON(), keys = new Set(body.keys);
      if (body.remove) {
        const batch = (++serial).toString(16).padStart(32, '0');
        batches.set(`${name}/${batch}`, features.map((feature, at) => ({ feature, at })).filter(({ feature }) => keys.has(feature.properties.key)));
        const keep = features.filter((feature) => !keys.has(feature.properties.key)); features.splice(0, features.length, ...keep);
        changed(); return route.fulfill({ json: { ...answer(), batch } });
      }
      const shift = (coords) => typeof coords[0] === 'number' ? coords.map((value, index) => value + (body.offset[index] ?? 0)) : coords.map(shift);
      for (const feature of features) if (keys.has(feature.properties.key)) {
        if (body.offset) feature.geometry.coordinates = shift(feature.geometry.coordinates);
        // a first and a last day land as a feature with no history keeps them
        const { start, end, ...changes } = body.changes ?? {};
        Object.assign(feature.properties, changes);
        if (start !== undefined) feature.properties.date = start;
        if (end !== undefined) { feature.properties.date_end = end; delete feature.properties.end_unknown; }
        if (changes.end_unknown) delete feature.properties.date_end;
      }
      changed(); return route.fulfill({ json: { ...answer(), ...(body.offset ? { kept: 0 } : {}) } });
    }
    if (action === 'merge') {
      const { keys } = route.request().postDataJSON(), [first, ...rest] = keys.map((one) => features.find((feature) => feature.properties.key === one));
      first.geometry = { type: 'MultiLineString', coordinates: [first, ...rest].map((feature) => feature.geometry.coordinates) };
      const keep = features.filter((feature) => !rest.includes(feature)); features.splice(0, features.length, ...keep);
      changed(); return route.fulfill({ json: { ...answer(), batch: 'merged', key: first.properties.key } });
    }
    if (action === 'export') {
      exports.push({ format: key, body: route.request().postDataJSON() });
      const content = key === 'geojson' ? JSON.stringify({ type: 'FeatureCollection', features: visibleFeatures() }) : '<kml><Document /></kml>';
      return route.fulfill({ body: content, contentType: key === 'geojson' ? 'application/geo+json' : 'application/octet-stream' });
    }
    if (action === 'groups' && !key) {
      const group = { id: `group-${++serial}`, name: route.request().postDataJSON().name,
        mode: 'uniform', colour: '#0072b2', symbol: 'pin' };
      ownGroups.push(group); changed();
      return route.fulfill({ json: { ...answer(), group } });
    }
    if (action === 'groups' && method === 'PATCH') {
      Object.assign(ownGroups.find((group) => group.id === key), route.request().postDataJSON()); changed();
      return route.fulfill({ json: answer() });
    }
    if (action === 'links' && method === 'POST') {
      const { items, group: target } = route.request().postDataJSON();
      let added = 0;
      for (const { id } of items) if (!features.some((feature) => feature.properties.entity_id === id)) {
        added += 1;
        features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [2.35, 48.85] },
          properties: { key: `shared-${++serial}`, name: casePlace.label, category: 'Markers',
            colour: '#0072b2', symbol: 'pin', group: target || 'markers', entity_id: id, index: features.length } });
      }
      changed(); return route.fulfill({ json: { ...answer(), added } });
    }
    if (action === 'markers' && method === 'POST' && !key) {
      const body = route.request().postDataJSON();
      const marker = { type: 'Feature', geometry: { type: 'Point', coordinates: [body.lon, body.lat] },
        properties: { key: `marker-${++serial}`, name: body.name || `Marker ${features.length + 1}`,
          colour: body.colour, symbol: body.symbol, group: body.group || 'markers', category: 'Markers', index: features.length,
          ...Object.fromEntries(['date', 'links', 'provenance'].filter((field) => body[field]).map((field) => [field, body[field]])) } };
      features.push(marker);
      changed();
      return route.fulfill({ json: { layer: row, marker } });
    }
    if (action === 'markers' && last === 'place') {
      promotions += 1;
      const marker = features.find((entry) => entry.properties.key === key);
      marker.properties.entity_id = `place-${promotions}`;
      changed();
      return route.fulfill({ json: { layer: row, marker,
        place: { id: marker.properties.entity_id, label: marker.properties.name } } });
    }
    if (action === 'markers' && method === 'PATCH') {
      const marker = features.find((entry) => entry.properties.key === key);
      const { geometry, ...properties } = route.request().postDataJSON();
      if (geometry) marker.geometry = geometry;
      Object.assign(marker.properties, properties); changed();
      return route.fulfill({ json: { layer: row, marker } });
    }
    if (action === 'shapes' && method === 'POST') {
      const body = route.request().postDataJSON();
      const number = (shapeSerial.get(name) ?? 0) + 1; shapeSerial.set(name, number);
      features.push({ type: 'Feature', geometry: body.geometry, properties: { key: `shape-${++serial}`, name: body.name || `${body.geometry.type === 'LineString' ? 'Line' : 'Area'} ${number}`,
        group: body.group || 'markers', category: 'Markers', colour: body.colour, symbol: 'pin', icon: '', index: features.length } });
      changed(); return route.fulfill({ json: answer() });
    }
    if (action === 'markers' && method === 'DELETE') {
      const at = features.findIndex((feature) => feature.properties.key === key);
      removed.set(`${name}/${key}`, { marker: features.splice(at, 1)[0], at });
      changed(); return route.fulfill({ json: answer() });
    }
    if (action === 'revert' && method === 'POST') {
      // the editor's undo and redo: whole features back by their key, the ones an edit made out
      const { put = [], drop = [] } = route.request().postDataJSON();
      const keep = features.filter((feature) => !drop.includes(feature.properties.key)); features.splice(0, features.length, ...keep);
      for (const feature of put) {
        const at = features.findIndex((entry) => entry.properties.key === feature.properties.key);
        if (at >= 0) features[at] = structuredClone(feature); else features.push(structuredClone(feature));
      }
      changed(); return route.fulfill({ json: answer() });
    }
    if (action === 'markers' && last === 'restore') {
      const { marker, at } = removed.get(`${name}/${key}`);
      features.splice(at, 0, marker); changed(); return route.fulfill({ json: answer() });
    }
    return route.fallback();
  });
  return { rows, collections, groups, uploads, exports, get promotions() { return promotions; },
    get deleted() { return deleted; }, get placeAlive() { return placeAlive; } };
}

test('a personal layer saves repeated clicks, stops with Escape and promotes only on request', async ({ page }) => {
  const fixture = await personalFixture(page);
  await page.goto('/#satellite?ll=48.85,2.35&z=16');
  await awaitMapReady(page);
  await expect(page.getByRole('tab', { name: 'Layers', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Saved', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New layer', exact: true }).click();
  await page.getByRole('dialog', { name: 'New layer' }).getByRole('textbox', { name: 'Name', exact: true }).fill('Working map');
  await page.getByRole('button', { name: 'Create layer', exact: true }).click();
  const panel = page.getByRole('region', { name: 'My layers' });
  await tools(page).getByRole('button', { name: 'Add markers', exact: true }).click();
  await chooseIcon(page, tools(page), 'Style', 'Star');
  await page.getByRole('button', { name: 'Style orange', exact: true }).click();
  const map = await page.locator('.map').boundingBox();
  await page.mouse.click(map.x + map.width * 0.4, map.y + map.height * 0.5);
  await page.mouse.click(map.x + map.width * 0.55, map.y + map.height * 0.55);
  await expect(panel.getByText('2 features', { exact: true })).toBeVisible();
  expect(fixture.promotions).toBe(0);
  expect(fixture.collections.get(fixture.rows[0].name).every((feature) =>
    feature.properties.symbol === 'star' && feature.properties.colour === '#d55e00')).toBe(true);
  await page.keyboard.press('Escape');
  await expect(tools(page).getByRole('button', { name: 'Add markers', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.click(map.x + map.width * 0.7, map.y + map.height * 0.6);
  await expect(panel.getByText('2 features', { exact: true })).toBeVisible();
  await tools(page).getByRole('button', { name: 'Done', exact: true }).click();
  await clickCard(page, map.x + map.width * 0.4, map.y + map.height * 0.5 - 9);
  await expect(page.locator('.layer-card')).toContainText('Marker 1');
  await page.screenshot({ path: test.info().outputPath('compact-marker-popup.png') });
  const action = page.locator('.layer-card').getByRole('button', { name: 'Edit feature', exact: true });
  expect(await action.innerText()).toBe('');
  expect((await action.boundingBox()).width).toBeLessThanOrEqual(26);
  await page.locator('.layer-card').getByRole('button', { name: 'Edit feature', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('personal-layer-editor.png') });
  await panel.getByRole('button', { name: 'Feature actions', exact: true }).click();
  await menuItem(page, 'Feature actions', 'Save as case place').click();
  await expect(panel.getByText('Follows the place “Marker 1”', { exact: true })).toBeVisible();
  expect(fixture.promotions).toBe(1);
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Edit Working map', exact: true }).click();
  await expect(panel.getByText('2 features', { exact: true })).toBeVisible();
});

test('an imported layer starts an independent editable copy', async ({ page }) => {
  const fixture = await personalFixture(page, { imported: true });
  await page.goto('/#satellite?ll=48.85,2.35&z=16');
  await awaitMapReady(page);
  await page.getByRole('button', { name: 'Create editable copy of Source map', exact: true }).click();
  await page.getByRole('button', { name: 'Create layer', exact: true }).click();
  const panel = page.getByRole('region', { name: 'My layers' });
  await expect(panel.getByText('Copy of source.kmz', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Original marker', exact: true }).click();
  await panel.getByRole('button', { name: 'Feature actions', exact: true }).click();
  await expect(menuItem(page, 'Feature actions', 'Save as case place')).toBeVisible();
  expect(fixture.rows.find((row) => row.name === 'source').features).toBe(1);
  expect(fixture.promotions).toBe(0);
});

test('a downloaded KMZ opens through the file picker and its marker can be edited', async ({ page }) => {
  const fixture = await personalFixture(page);
  const kmz = Buffer.from('UEsDBBQAAAAIAEV7S12Fb9xrVAAAAHIAAAAHAAAAZG9jLmttbLPJzs2xswnISUxOzU0syrazyUvMTbXzL8pMz8xLzFEAiaUW2eiDRW0C8jPzSuxskvPzi1KA0iWpxXZGesamOiYWehamNvrI4jb6UMX6SGbrgywDAFBLAQIUAxQAAAAIAEV7S12Fb9xrVAAAAHIAAAAHAAAAAAAAAAAAAACAAQAAAABkb2Mua21sUEsFBgAAAAABAAEANQAAAHkAAAAAAA==', 'base64');
  await page.goto('/#satellite?ll=48.85,2.35&z=16');
  await awaitMapReady(page);
  await page.getByRole('button', { name: 'New layer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New layer' });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('KMZ map');
  await dialog.getByRole('button', { name: 'From a file', exact: true }).click();
  await dialog.locator('input[type=file]').setInputFiles({ name: 'source.kmz',
    mimeType: 'application/vnd.google-earth.kmz', buffer: kmz });
  await dialog.getByRole('button', { name: 'Create layer', exact: true }).click();
  const panel = page.getByRole('region', { name: 'My layers' });
  await expect(panel.getByText('Copy of source.kmz', { exact: true })).toBeVisible();
  expect(fixture.uploads).toHaveLength(1);
  expect(fixture.uploads[0].includes(kmz)).toBe(true);
  expect(fixture.uploads[0].toString()).not.toContain('name="icons"');
  await panel.getByRole('button', { name: 'Original marker', exact: true }).click();
  await panel.getByLabel('Feature name', { exact: true }).fill('Reviewed marker');
  await panel.getByLabel('Feature name', { exact: true }).press('Enter');
  await chooseIcon(page, panel, 'Feature style', 'Flag');
  await expect(panel.getByRole('button', { name: 'Reviewed marker', exact: true })).toBeVisible();
  await expect.poll(() => fixture.collections.get(fixture.rows[0].name)[0].properties.symbol).toBe('flag');
  await page.keyboard.press('Escape');
  expect(fixture.promotions).toBe(0);
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  const map = await page.locator('.map').boundingBox();
  await clickCard(page, map.x + map.width / 2, map.y + map.height / 2 - 9);
  await page.locator('.layer-card').getByRole('button', { name: 'Edit feature', exact: true }).click();
  await expect(panel.getByLabel('Feature name', { exact: true })).toHaveValue('Reviewed marker');
});

test('groups share round icons, case places span layers, and popup removals can be undone', async ({ page }) => {
  const fixture = await personalFixture(page, { shared: true });
  await page.goto('/#satellite?ll=48.85,2.35&z=16');
  await awaitMapReady(page);
  const panel = page.getByRole('region', { name: 'My layers' });
  const createLayer = async (title) => {
    await panel.getByRole('button', { name: 'New layer', exact: true }).click();
    await page.getByRole('dialog', { name: 'New layer' }).getByRole('textbox', { name: 'Name', exact: true }).fill(title);
    await page.getByRole('button', { name: 'Create layer', exact: true }).click();
    await expect(tools(page).getByRole('button', { name: 'Add markers', exact: true })).toBeVisible();
  };
  const addGate = async () => {
    await tools(page).getByRole('button', { name: 'Add from the case', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add from the case' });
    await dialog.getByRole('checkbox', { name: 'Case gate', exact: true }).check();
    await dialog.getByRole('button', { name: 'Add 1', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Case gate', exact: true })).toBeVisible();
  };
  await createLayer('Checked map');
  const first = fixture.rows[0];
  await panel.getByRole('button', { name: 'New group', exact: true }).click();
  await panel.getByLabel('New group name').fill('Verified');
  await panel.getByRole('button', { name: 'Create group', exact: true }).click();
  await panel.getByRole('button', { name: 'Settings of group Verified', exact: true }).click();
  const settings = page.getByRole('group', { name: 'Settings of group Verified', exact: true });
  await expect(settings.getByLabel('One style for the whole group')).toBeChecked();
  await settings.getByRole('button', { name: 'Group style', exact: true }).click();
  const palette = page.getByRole('group', { name: 'Group style icon palette', exact: true });
  await expect(palette.getByRole('button')).toHaveCount(66);
  await page.screenshot({ path: test.info().outputPath('round-icon-palette.png') });
  await page.getByLabel('Group style find icon').click();
  await expect(palette).toBeVisible();
  await settings.getByLabel('Group name', { exact: true }).fill('Verified sites');
  await settings.getByLabel('Group name', { exact: true }).press('Enter');
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
  await expect(page.getByLabel('One style for the whole group')).toHaveCount(0);
  await expect.poll(() => fixture.groups.get(first.name)[1].name).toBe('Verified sites');
  await panel.getByRole('button', { name: 'Settings of group Verified sites', exact: true }).click();
  await page.getByRole('button', { name: 'Group style', exact: true }).click();
  await page.getByLabel('Group style find icon').fill('Building');
  await page.getByRole('button', { name: 'Group style Building icon', exact: true }).click();
  await page.getByRole('button', { name: 'Group style green', exact: true }).click();
  await expect.poll(() => fixture.groups.get(first.name)[1].symbol).toBe('badge-building');
  await tools(page).getByRole('button', { name: 'Add markers', exact: true }).click();
  const box = await page.locator('.map').boundingBox();
  await page.mouse.click(box.x + box.width * 0.37, box.y + box.height * 0.5);
  await expect(panel.getByText('1 feature', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.click(box.x + box.width * 0.37, box.y + box.height * 0.5);
  await expect(panel.getByLabel('Feature name', { exact: true })).toHaveValue('Marker 1');
  await addGate();
  await panel.getByRole('button', { name: 'Case gate', exact: true }).click();
  await panel.getByRole('button', { name: 'Feature style', exact: true }).click();
  await expect(page.getByText('Verified sites has one style for all its features. A pick here restyles the whole group.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: test.info().outputPath('compact-group-editor.png') });
  await panel.getByRole('button', { name: 'Done', exact: true }).click();

  await createLayer('Footage map');
  const second = fixture.rows[0];
  await addGate();
  await panel.getByRole('button', { name: 'Case gate', exact: true }).click();
  await chooseIcon(page, panel, 'Feature style', 'FPV drone');
  await expect.poll(() => fixture.collections.get(second.name)[0].properties.symbol).toBe('badge-fpv-drone');
  await page.keyboard.press('Escape');
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await panel.getByRole('button', { name: 'Move Checked map', exact: true }).press('ArrowUp');
  await expect.poll(() => fixture.rows[0].title).toBe('Checked map');
  await page.screenshot({ path: test.info().outputPath('personal-layer-list.png') });

  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await clickCard(page, centre.x, centre.y);
  const card = page.locator('.layer-card');
  await expect(card).toContainText('Checked map');
  await page.locator('.maplibregl-popup-close-button').click();
  await panel.getByRole('button', { name: 'Checked map', exact: true }).click();
  await clickCard(page, centre.x, centre.y);
  await expect(card).toContainText('Footage map');
  await card.getByRole('button', { name: 'Remove from this layer', exact: true }).click();
  await expect.poll(() => fixture.collections.get(second.name).length).toBe(0);
  expect(fixture.placeAlive).toBe(true);
  expect(fixture.collections.get(first.name).some((feature) => feature.properties.entity_id === 'shared-place')).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).last().click();
  await expect.poll(() => fixture.collections.get(second.name).length).toBe(1);

  await clickCard(page, centre.x, centre.y);
  await card.getByRole('button', { name: 'Delete case place', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete this case place?' });
  await expect(confirm).toContainText('Gate proof');
  await expect(confirm).toContainText('Checked map');
  await expect(confirm).toContainText('Footage map');
  await expect(confirm).toContainText('media placed by those proofs');
  await expect(confirm).toContainText('Gate footage');
  await expect(confirm).toContainText('Media placed only through this place lose this map position.');
  expect(fixture.deleted).toBe(0);
  await confirm.getByRole('button', { name: 'Delete case place', exact: true }).click();
  await expect.poll(() => fixture.deleted).toBe(1);
  expect(fixture.collections.get(second.name)[0].geometry.coordinates).toEqual([2.35, 48.85]);
  await page.getByRole('button', { name: 'Undo', exact: true }).last().click();
  await expect.poll(() => fixture.placeAlive).toBe(true);

  await panel.getByRole('button', { name: 'Remove Footage map', exact: true }).click();
  await page.getByRole('alertdialog', { name: 'Remove this layer?' }).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Edit Footage map', exact: true })).toHaveCount(0);
  expect(fixture.placeAlive).toBe(true);
});

test('a saved place exposes compact icon actions and previews deletion before changing the case', async ({ page }) => {
  const fixture = await personalFixture(page, { shared: true });
  await page.route(`**/api/cases/${CASE_ID}/entities/shared-place/chain`,
    (route) => route.fulfill({ json: { relations: [] } }));
  await page.goto('/#satellite?ll=48.85,2.35&z=16');
  await awaitMapReady(page);
  await showSaved(page, 'Places');
  await page.locator('.saved-mark-place').click();
  const popup = page.locator('.saved-popup');
  for (const label of ['Delete case place', 'Edit', 'Trace footprint']) {
    const button = popup.getByRole('button', { name: label, exact: true });
    await expect(button).toBeVisible();
    expect(await button.innerText()).toBe('');
    expect((await button.boundingBox()).width).toBeLessThanOrEqual(26);
  }
  await page.screenshot({ path: test.info().outputPath('compact-saved-place-popup.png') });
  await popup.getByRole('button', { name: 'Delete case place', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: 'Delete this case place?' })).toBeVisible();
  expect(fixture.deleted).toBe(0);
});

test('the edit bar moves where it is dropped, docks upright on a side, and goes back on a double-click', async ({ page }) => {
  await personalFixture(page);
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  await createPersonalLayer(page, 'Bar map');
  const bar = tools(page), map = await page.locator('.map').boundingBox();
  await expect(bar).toHaveAttribute('aria-orientation', 'horizontal');
  const grip = await bar.getByRole('button', { name: 'Move the tool bar', exact: true }).boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(map.x + 30, map.y + map.height * .6, { steps: 10 }); await page.mouse.up();
  await expect(bar).toHaveAttribute('aria-orientation', 'vertical');
  const docked = await bar.boundingBox();
  expect(docked.x - map.x).toBeLessThan(20);
  // it keeps clear of the map's zoom buttons
  const zoom = await page.locator('.maplibregl-ctrl-group').first().boundingBox();
  expect(docked.y >= zoom.y + zoom.height || docked.y + docked.height <= zoom.y || docked.x >= zoom.x + zoom.width).toBe(true);
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('azimut:layer-bar'))).edge).toBe('left');
  await page.screenshot({ path: test.info().outputPath('edit-bar-docked-left.png') });
  await page.reload(); await page.getByRole('button', { name: 'Edit Bar map', exact: true }).click();
  await expect(tools(page)).toHaveAttribute('aria-orientation', 'vertical');
  await tools(page).getByRole('button', { name: 'Move the tool bar', exact: true }).dblclick();
  await expect(tools(page)).toHaveAttribute('aria-orientation', 'horizontal');
});

test('a right-click on a marker opens its menu, and its status and style change from there', async ({ page }) => {
  const fixture = await personalFixture(page);
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  const panel = await createPersonalLayer(page, 'Menu map');
  const map = await page.locator('.map').boundingBox(), at = { x: map.x + map.width * .4, y: map.y + map.height * .5 };
  await chooseIcon(page, tools(page), 'Style', 'Tank');
  await tools(page).getByRole('button', { name: 'Add markers', exact: true }).click();
  await page.mouse.click(at.x, at.y); await page.keyboard.press('Escape');
  await expect(panel.getByText('1 feature', { exact: true })).toBeVisible();
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Feature actions', exact: true });
  await expect(menu).toBeVisible();
  await expect(page.getByLabel('This point', { exact: true })).toHaveCount(0);
  await menu.getByRole('button', { name: 'Destroyed', exact: true }).click();
  const features = fixture.collections.get(fixture.rows[0].name);
  await expect.poll(() => features[0].properties.status).toBe('destroyed');
  await menu.getByRole('button', { name: 'Feature style', exact: true }).click();
  await page.getByRole('button', { name: 'Feature style orange', exact: true }).click();
  await expect.poll(() => features[0].properties.colour).toBe('#d55e00');
  await page.screenshot({ path: test.info().outputPath('feature-right-click-menu.png') });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('a layer followed over time dates a move to the day its cursor is on', async ({ page }) => {
  const fixture = await personalFixture(page);
  const moves = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/selection')) moves.push(request.postDataJSON());
  });
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  const panel = await createPersonalLayer(page, 'Front');
  const map = await page.locator('.map').boundingBox();
  const pin = { x: map.x + map.width * .4, y: map.y + map.height * .45 };
  await tools(page).getByRole('button', { name: 'Add markers', exact: true }).click();
  await page.mouse.click(pin.x, pin.y); await page.keyboard.press('Escape');
  await expect(panel.getByText('1 feature', { exact: true })).toBeVisible();
  // off until asked for: nothing of time shows
  await expect(page.getByRole('group', { name: 'Time', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Layer actions', exact: true }).click();
  await page.getByRole('menu', { name: 'Layer actions', exact: true }).getByRole('menuitemcheckbox', { name: 'Track over time' }).click();
  await expect.poll(() => fixture.rows[0].track?.on).toBe(true);
  const time = page.getByRole('group', { name: 'Time', exact: true });
  await expect(time).toBeVisible();
  // followed, the bar dates the edits from today: no "now" that would slide to tomorrow
  const undated = tools(page).getByRole('button', { name: 'No date', exact: true });
  const dated = tools(page).getByRole('button', { name: /^From / });
  await expect(dated).toHaveAttribute('aria-pressed', 'true');
  await expect(undated).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: test.info().outputPath('layer-dated-edits.png') });
  const today = new Date().toISOString().slice(0, 10);
  await page.mouse.move(pin.x, pin.y - 18); await page.mouse.down();
  await page.mouse.move(pin.x + 30, pin.y - 18, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => moves.at(-1)?.at ?? null).toBe(today);
  // a day back: the bar dates the edits from it
  await time.getByRole('slider').press('ArrowLeft');
  await expect(dated).toHaveAttribute('aria-pressed', 'true');
  let count = moves.length;
  await page.mouse.move(pin.x + 30, pin.y - 18); await page.mouse.down();
  await page.mouse.move(pin.x + 60, pin.y - 18, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => moves.length).toBeGreaterThan(count);
  expect(moves.at(-1).at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(moves.at(-1).at < today).toBe(true);
  expect(moves.at(-1).fix).toBeUndefined();
  // with no date, a move carries none: it counts on every day
  await undated.click();
  await expect(undated).toHaveAttribute('aria-pressed', 'true');
  count = moves.length;
  await page.mouse.move(pin.x + 60, pin.y - 18); await page.mouse.down();
  await page.mouse.move(pin.x + 100, pin.y - 18, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => moves.length).toBeGreaterThan(count);
  expect(moves.at(-1).at).toBeUndefined();
});

test('a selection on a layer followed over time takes one first day for all its features', async ({ page }) => {
  const fixture = await personalFixture(page);
  const edits = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/selection')) edits.push(request.postDataJSON());
  });
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  const panel = await createPersonalLayer(page, 'Candidates');
  const map = await page.locator('.map').boundingBox();
  await tools(page).getByRole('button', { name: 'Add markers', exact: true }).click();
  await page.mouse.click(map.x + map.width * .4, map.y + map.height * .45);
  await page.mouse.click(map.x + map.width * .6, map.y + map.height * .45);
  await page.keyboard.press('Escape');
  await expect(panel.getByText('2 features', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Layer actions', exact: true }).click();
  await page.getByRole('menu', { name: 'Layer actions', exact: true }).getByRole('menuitemcheckbox', { name: 'Track over time' }).click();
  await expect.poll(() => fixture.rows[0].track?.on).toBe(true);
  const rows = panel.locator('.feature-row');
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Shift'] });
  const sheet = panel.getByRole('group', { name: 'Selected features', exact: true });
  await expect(sheet.getByText('2 selected', { exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'When it first shows', exact: true }).click();
  const first = `${new Date().toISOString().slice(0, 8)}01`;
  await page.locator(`.float-menu button.day[title="${first}"]`).click();
  await expect.poll(() => edits.at(-1)?.changes ?? null).toEqual({ start: first });
  expect(edits.at(-1).keys).toHaveLength(2);
  await expect(sheet.getByRole('button', { name: 'When it first shows', exact: true })).toHaveText(/^From /);
  // an end nobody knows is said only once pressed, beside Today
  const leaves = sheet.getByRole('button', { name: 'When it leaves the map', exact: true });
  await expect(leaves).toHaveText('Still there');
  await leaves.click();
  await page.locator('.float-menu .acts').getByRole('button', { name: 'Unknown', exact: true }).click();
  await expect.poll(() => edits.at(-1)?.changes ?? null).toEqual({ end_unknown: true });
  await expect(leaves).toHaveText('Unknown');
  await expect(rows.nth(0).locator('.day')).toHaveText(/ → \?$/);
});
