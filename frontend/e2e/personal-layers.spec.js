import { expect, test } from '@playwright/test';
import { awaitMapReady, CASE_ID, installAppFixture, showSaved } from './app.fixture.js';

async function chooseIcon(panel, label, icon) {
  await panel.getByRole('button', { name: `${label} icons`, exact: true }).click();
  await panel.getByRole('button', { name: `${label} ${icon} icon`, exact: true }).click();
}

async function clickCard(page, x, y) {
  const card = page.locator('.layer-card');
  await page.mouse.click(x, y);
  await expect.poll(async () => {
    if (await card.isVisible()) return true;
    await page.mouse.click(x, y);
    return card.isVisible();
  }).toBe(true);
}

test('long imported groups expand explicitly and a checked range moves and removes together', async ({ page }) => {
  const fixture = await personalFixture(page, { imported: true, count: 250 });
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  await page.getByRole('button', { name: 'Create editable copy of Source map', exact: true }).click();
  await page.getByRole('button', { name: 'Create layer', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Layer editor', exact: true });
  await expect(panel.locator('.features li')).toHaveCount(100);
  await panel.getByRole('button', { name: 'Show all 250', exact: true }).click();
  await expect(panel.locator('.features li')).toHaveCount(250);
  await panel.getByRole('checkbox', { name: 'Select Point 250', exact: true }).click();
  await panel.getByRole('checkbox', { name: 'Select Point 241', exact: true }).click({ modifiers: ['Shift'] });
  await expect(panel.getByText('10 selected', { exact: true })).toBeVisible();
  const own = fixture.rows.find((row) => row.editable), features = fixture.collections.get(own.name);
  const before = structuredClone(features);
  await panel.getByRole('button', { name: 'Move selection', exact: true }).click();
  await page.getByRole('button', { name: 'Move vertex 1.1', exact: true }).press('Shift+ArrowRight');
  await panel.getByRole('button', { name: 'Save geometry', exact: true }).click();
  await expect.poll(() => features.at(-1).geometry.coordinates[0]).not.toBe(before.at(-1).geometry.coordinates[0]);
  expect(features[0].geometry).toEqual(before[0].geometry);
  await panel.getByRole('button', { name: 'Remove selected from layer', exact: true }).click();
  await expect(panel.getByText('240 features', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(panel.getByText('250 features', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Point 1', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Move marker', exact: true })).toBeInViewport();
  expect(fixture.promotions).toBe(0);
});

test('personal layers download their styles and saved maps restore the camera and legend', async ({ page }) => {
  const fixture = await personalFixture(page);
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  const panel = await createPersonalLayer(page, 'Download map');
  const map = await page.locator('.map').boundingBox();
  await panel.getByRole('button', { name: 'Add markers', exact: true }).click();
  await chooseIcon(panel, 'New marker', 'Tank');
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
  await page.getByRole('button', { name: 'My maps', exact: true }).click();
  const maps = page.getByRole('dialog', { name: 'My maps', exact: true });
  await maps.getByLabel('Map name', { exact: true }).fill('Review view');
  await maps.getByLabel('Legend note', { exact: true }).fill('Working markers');
  await maps.getByRole('button', { name: 'Save this map', exact: true }).click();
  await expect(maps.getByRole('button', { name: 'Review view', exact: true })).toBeVisible();
  expect(fixture.maps[0].layers[0].name).toBe(fixture.rows[0].name);
  await maps.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Map legend' })).toContainText('Working markers');
  await page.reload(); await awaitMapReady(page);
  await page.getByRole('button', { name: 'My maps', exact: true }).click();
  await maps.getByRole('button', { name: 'Review view', exact: true }).click();
  await expect(maps).not.toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Map legend' })).toContainText('Review view');
  await page.screenshot({ path: test.info().outputPath('saved-map-legend.png') });
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
  expect(result.badges).toHaveLength(52);
  for (const badge of result.badges) { expect(badge.bounds.left).toBeGreaterThan(0); expect(badge.bounds.right).toBeLessThan(63); }
  expect(Math.abs(result.pinHeight - result.roundHeight)).toBeLessThan(1);
});

test('reordering groups changes which overlapping pin or round marker receives a click', async ({ page }) => {
  await personalFixture(page);
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  const panel = await createPersonalLayer(page, 'Mixed symbols');
  const map = await page.locator('.map').boundingBox(), point = { x: map.x + map.width * .4, y: map.y + map.height * .5 };
  await panel.getByRole('button', { name: 'Add markers', exact: true }).click();
  await page.mouse.click(point.x, point.y); await page.keyboard.press('Escape');
  await panel.getByRole('button', { name: 'New group', exact: true }).click();
  await panel.getByLabel('New group name').fill('Vehicles');
  await panel.getByRole('button', { name: 'Create group', exact: true }).click();
  await chooseIcon(panel, 'Group', 'Tank');
  await panel.getByRole('button', { name: 'Add markers', exact: true }).click();
  await page.mouse.click(point.x, point.y); await page.keyboard.press('Escape');
  await expect(panel.getByText('2 features', { exact: true })).toBeVisible();
  await clickCard(page, point.x, point.y);
  await expect(page.locator('.layer-card')).toContainText('Marker 1');
  await page.locator('.maplibregl-popup-close-button').click();
  await panel.getByRole('button', { name: 'Move group Vehicles', exact: true })
    .dragTo(panel.getByRole('button', { name: 'Move group Markers', exact: true }));
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

test('group size and native dragging persist, while Back restores the session baseline', async ({ page }) => {
  const fixture = await personalFixture(page);
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  let panel = await createPersonalLayer(page, 'Group map');
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Group map', exact: true }).click();
  panel = page.getByRole('region', { name: 'Layer editor', exact: true });
  await panel.getByRole('button', { name: 'New group', exact: true }).click();
  await panel.getByLabel('New group name').fill('Vehicles');
  await panel.getByRole('button', { name: 'Create group', exact: true }).click();
  const size = panel.getByRole('slider', { name: 'Icon size for Vehicles' });
  await size.fill('2'); await size.dispatchEvent('change');
  await expect(panel.locator('output').first()).toHaveText('200%');
  const width = panel.getByRole('slider', { name: 'Line width for Vehicles' });
  await width.fill('5.5'); await width.dispatchEvent('change');
  await expect.poll(() => fixture.groups.get(fixture.rows[0].name)[1].stroke).toBe(5.5);
  await expect.poll(() => fixture.groups.get(fixture.rows[0].name)[1].size).toBe(2);
  await panel.getByRole('button', { name: 'Move group Vehicles', exact: true })
    .dragTo(panel.getByRole('button', { name: 'Move group Markers', exact: true }));
  await expect.poll(() => fixture.groups.get(fixture.rows[0].name)[0].name).toBe('Vehicles');
  await page.screenshot({ path: test.info().outputPath('group-size-and-order.png') });
  await panel.getByRole('button', { name: 'Back from layer editor' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Discard changes?' });
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(fixture.groups.get(fixture.rows[0].name)).toHaveLength(2);
  await panel.getByRole('button', { name: 'Back from layer editor' }).click();
  await confirm.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(panel).not.toBeVisible();
  expect(fixture.groups.get(fixture.rows[0].name).map((group) => group.name)).toEqual(['Markers']);
  await page.getByRole('button', { name: 'Edit Group map', exact: true }).click();
  await panel.getByRole('button', { name: 'Back from layer editor' }).click();
  await expect(panel).not.toBeVisible(); await expect(confirm).not.toBeVisible();
});

test('marker dragging and editable line and area vertices save geometry without creating case places', async ({ page }) => {
  const fixture = await personalFixture(page);
  await page.goto('/#satellite?ll=48.85,2.35&z=16'); await awaitMapReady(page);
  const panel = await createPersonalLayer(page, 'Drawn map');
  const map = await page.locator('.map').boundingBox();
  const click = (x, y) => page.mouse.click(map.x + map.width * x, map.y + map.height * y);
  await panel.getByRole('button', { name: 'Add markers', exact: true }).click(); await click(.4, .5);
  await expect(panel.getByText('1 feature', { exact: true })).toBeVisible(); await page.keyboard.press('Escape');
  const features = fixture.collections.get(fixture.rows[0].name);
  const initial = [...features[0].geometry.coordinates];
  await panel.getByRole('button', { name: 'Marker 1', exact: true }).click();
  await panel.getByRole('button', { name: 'Move marker', exact: true }).click();
  const handle = page.getByRole('button', { name: 'Move vertex 1.1', exact: true });
  const point = await handle.boundingBox();
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.down(); await page.mouse.move(point.x + 35, point.y + 25, { steps: 5 }); await page.mouse.up();
  expect(features[0].geometry.coordinates).toEqual(initial);
  await panel.getByRole('button', { name: 'Save geometry', exact: true }).click();
  await expect.poll(() => JSON.stringify(features[0].geometry.coordinates)).not.toBe(JSON.stringify(initial));
  await panel.getByRole('button', { name: 'Draw line', exact: true }).click();
  await click(.34, .40); await click(.48, .54); await page.keyboard.press('Enter');
  await expect(panel.getByText('2 features', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Draw area', exact: true }).click();
  await click(.34, .62); await click(.48, .62); await click(.48, .76);
  await panel.getByRole('button', { name: 'Save geometry', exact: true }).click();
  await expect(panel.getByText('3 features', { exact: true })).toBeVisible();
  const area = features.find((feature) => feature.geometry.type === 'Polygon');
  expect(area.geometry.coordinates[0][0]).toEqual(area.geometry.coordinates[0].at(-1));
  await panel.getByRole('button', { name: 'Area 2', exact: true }).click();
  await panel.getByRole('button', { name: 'Edit geometry', exact: true }).click();
  await page.getByRole('button', { name: 'Add vertex 1.1', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Move vertex/ })).toHaveCount(4);
  await page.getByRole('button', { name: 'Move vertex 1.2', exact: true }).press('Shift+ArrowRight');
  await panel.getByRole('button', { name: 'Save geometry', exact: true }).click();
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
    await panel.getByRole('button', { name: 'Add markers', exact: true }).click();
    await page.mouse.click(map.x + map.width * .35, map.y + map.height * .5);
    await expect(panel.getByText('1 feature', { exact: true })).toBeVisible(); await page.keyboard.press('Escape');
    await panel.getByRole('button', { name: 'Draw line', exact: true }).click();
    await page.mouse.click(map.x + map.width * .35, map.y + map.height * .4);
    await page.mouse.click(map.x + map.width * .50, map.y + map.height * .6);
    await panel.getByRole('button', { name: 'Save geometry', exact: true }).click();
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
  await panel.getByLabel('Selected marker name').fill('Unsaved across maps');
  for (const tool of ['detect', 'compare', 'horizon', 'satellite']) {
    await page.goto(`/#${tool}`);
    await expect(page.locator(`.topbar button[title="Guide: ${tool[0].toUpperCase() + tool.slice(1)}"]`)).toBeVisible();
    await expect(panel.getByLabel('Selected marker name')).toHaveValue('Unsaved across maps');
  }
  await panel.getByRole('button', { name: 'Back from layer editor' }).click();
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
  const maps = [];
  const shapeSerial = new Map();
  const rows = [];
  await page.route(`**/api/cases/${CASE_ID}/horizon/views`, (route) => route.fulfill({ json: [] }));
  const casePlace = { id: 'shared-place', label: 'Case gate', type: 'place', attrs: { lat: 48.85, lon: 2.35 } };
  let placeAlive = shared;
  let deleted = 0;
  const savedIndex = () => placeAlive ? [{ id: casePlace.id, kind: 'place', title: casePlace.label,
    lat: 48.85, lon: 2.35, relations: 1 }] : [];
  await page.route(`**/api/cases/${CASE_ID}/satellite/index`, (route) => route.fulfill({ json: savedIndex() }));
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
  const create = (title, fromSource = false) => {
    const name = `working-${++serial}`;
    const features = fromSource ? sourceFeatures.map((feature) => ({ ...feature,
      properties: { ...feature.properties, key: count === 1 ? 'imported-marker' : `imported-${feature.properties.index}`, group: 'markers' } })) : [];
    const row = { name, title, editable: true, source: { kind: 'editable' },
      origin: fromSource ? { source: source.source } : null,
      features: features.length, categories: [], icons: 0, hidden: [], refresh: {}, sha256: String(serial).repeat(64), edit_revision: '0'.repeat(64), edit_changed: false };
    collections.set(name, features);
    groups.set(name, [{ id: 'markers', name: 'Markers', mode: 'individual', colour: '#0072b2', symbol: 'pin', size: 1, stroke: 2 }]);
    rows.unshift(row);
    return row;
  };
  await page.route(`**/api/cases/${CASE_ID}/map-views`, (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(), id = body.id || (++serial).toString(16).padStart(32, '0');
      const saved = { ...body, id, version: 1 }, at = maps.findIndex((view) => view.id === id);
      if (at >= 0) maps[at] = saved; else maps.push(saved);
      return route.fulfill({ json: saved });
    }
    return route.fulfill({ json: maps });
  });
  await page.route(`**/api/cases/${CASE_ID}/map-layers`, (route) => route.fulfill({ json: rows }));
  await page.route(`**/api/cases/${CASE_ID}/map-layers/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.split('/map-layers/')[1];
    const method = route.request().method();
    if (path === 'editable' && method === 'POST') {
      return route.fulfill({ json: create(route.request().postDataJSON().title) });
    }
    if (path === 'editable/upload' && method === 'POST') {
      const payload = route.request().postDataBuffer();
      uploads.push(payload);
      const title = payload.toString().match(/name="title"\r\n\r\n([^\r]+)/)?.[1] || 'My layer';
      return route.fulfill({ json: create(title, true) });
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
        layers: rows.filter((row) => collections.get(row.name).some((feature) => feature.properties.place_id === casePlace.id)) } });
    }
    const [name, action, key, last] = path.split('/');
    const row = rows.find((entry) => entry.name === name);
    if (action === 'editable-copy') return route.fulfill({ json: create(route.request().postDataJSON().title, true) });
    if (!row) return route.fallback();
    const features = collections.get(name);
    const ownGroups = groups.get(name);
    const visibleFeatures = () => features.map((feature) => {
      const properties = { ...feature.properties };
      if (properties.place_id === casePlace.id && !placeAlive) delete properties.place_id;
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
      }
      checkpoints.delete(name); changed(); row.edit_changed = false;
      return route.fulfill({ json: answer() });
    }
    if (action === 'edit') {
      if (method === 'POST' && !checkpoints.has(name)) checkpoints.set(name, { features: structuredClone(features), groups: structuredClone(ownGroups), hidden: [...row.hidden] });
      return route.fulfill({ json: answer() });
    }
    if (action === 'data') return route.fulfill({ json: { type: 'FeatureCollection', features: visibleFeatures().map((feature) => {
      const group = ownGroups?.find((group) => group.id === feature.properties.group);
      return { ...feature, properties: { ...feature.properties, icon_scale: group?.size ?? 1, stroke_width: group?.stroke ?? 2,
        ...(group?.mode === 'uniform' ? { category: group.name, colour: group.colour, symbol: group.symbol, icon: '' } : {}) } };
    }).sort((a, b) => (ownGroups?.findIndex((group) => group.id === b.properties.group) ?? 0) - (ownGroups?.findIndex((group) => group.id === a.properties.group) ?? 0))
      .map((feature, index) => ({ ...feature, id: index, properties: { ...feature.properties, index } })) } });
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
        if (body.changes) Object.assign(feature.properties, body.changes);
      }
      changed(); return route.fulfill({ json: answer() });
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
    if (action === 'places' && method === 'POST') {
      const { ids, group: target } = route.request().postDataJSON();
      for (const id of ids) if (!features.some((feature) => feature.properties.place_id === id)) {
        features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [2.35, 48.85] },
          properties: { key: `shared-${++serial}`, name: casePlace.label, category: 'Markers',
            colour: '#0072b2', symbol: 'pin', group: target || 'markers', place_id: id, index: features.length } });
      }
      changed(); return route.fulfill({ json: answer() });
    }
    if (action === 'markers' && method === 'POST' && !key) {
      const body = route.request().postDataJSON();
      const marker = { type: 'Feature', geometry: { type: 'Point', coordinates: [body.lon, body.lat] },
        properties: { key: `marker-${++serial}`, name: body.name || `Marker ${features.length + 1}`,
          colour: body.colour, symbol: body.symbol, group: body.group || 'markers', category: 'Markers', index: features.length } };
      features.push(marker);
      changed();
      return route.fulfill({ json: { layer: row, marker } });
    }
    if (action === 'markers' && last === 'place') {
      promotions += 1;
      const marker = features.find((entry) => entry.properties.key === key);
      marker.properties.place_id = `place-${promotions}`;
      changed();
      return route.fulfill({ json: { layer: row, marker,
        place: { id: marker.properties.place_id, label: marker.properties.name } } });
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
    if (action === 'markers' && last === 'restore') {
      const { marker, at } = removed.get(`${name}/${key}`);
      features.splice(at, 0, marker); changed(); return route.fulfill({ json: answer() });
    }
    return route.fallback();
  });
  return { rows, collections, groups, uploads, exports, maps, get promotions() { return promotions; },
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
  await panel.getByRole('button', { name: 'Add markers', exact: true }).click();
  await chooseIcon(panel, 'New marker', 'Star');
  await panel.getByRole('button', { name: 'New marker orange', exact: true }).click();
  const map = await page.locator('.map').boundingBox();
  await page.mouse.click(map.x + map.width * 0.4, map.y + map.height * 0.5);
  await page.mouse.click(map.x + map.width * 0.55, map.y + map.height * 0.55);
  await expect(panel.getByText('2 features', { exact: true })).toBeVisible();
  expect(fixture.promotions).toBe(0);
  expect(fixture.collections.get(fixture.rows[0].name).every((feature) =>
    feature.properties.symbol === 'star' && feature.properties.colour === '#d55e00')).toBe(true);
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('button', { name: 'Add markers', exact: true })).toBeVisible();
  await page.mouse.click(map.x + map.width * 0.7, map.y + map.height * 0.6);
  await expect(panel.getByText('2 features', { exact: true })).toBeVisible();
  await clickCard(page, map.x + map.width * 0.4, map.y + map.height * 0.5 - 9);
  await expect(page.locator('.layer-card')).toContainText('Marker 1');
  await page.screenshot({ path: test.info().outputPath('compact-marker-popup.png') });
  const action = page.locator('.layer-card').getByRole('button', { name: 'Edit feature', exact: true });
  expect(await action.innerText()).toBe('');
  expect((await action.boundingBox()).width).toBeLessThanOrEqual(26);
  await page.locator('.layer-card').getByRole('button', { name: 'Edit feature', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('personal-layer-editor.png') });
  await panel.getByRole('button', { name: 'Save as case place', exact: true }).click();
  await expect(panel.getByText('Saved as case place', { exact: true })).toBeVisible();
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
  await expect(panel.getByRole('button', { name: 'Save as case place', exact: true })).toBeVisible();
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
  await panel.getByLabel('Selected marker name').fill('Reviewed marker');
  await chooseIcon(panel, 'Selected marker', 'Flag');
  await panel.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Reviewed marker', exact: true })).toBeVisible();
  expect(fixture.collections.get(fixture.rows[0].name)[0].properties.symbol).toBe('flag');
  expect(fixture.promotions).toBe(0);
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  const map = await page.locator('.map').boundingBox();
  await clickCard(page, map.x + map.width / 2, map.y + map.height / 2 - 9);
  await page.locator('.layer-card').getByRole('button', { name: 'Edit feature', exact: true }).click();
  await expect(panel.getByLabel('Selected marker name')).toHaveValue('Reviewed marker');
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
    await expect(panel.getByRole('button', { name: 'Add markers', exact: true })).toBeVisible();
  };
  const addGate = async () => {
    await panel.getByRole('button', { name: 'Add case places', exact: true }).click();
    await panel.getByRole('checkbox', { name: 'Case gate', exact: true }).check();
    await panel.getByRole('button', { name: 'Add selected (1)', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Case gate', exact: true })).toBeVisible();
  };
  await createLayer('Checked map');
  const first = fixture.rows[0];
  await panel.getByRole('button', { name: 'New group', exact: true }).click();
  await panel.getByLabel('New group name').fill('Verified');
  await panel.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(panel.getByLabel('Group style')).toHaveValue('uniform');
  await panel.getByRole('button', { name: 'Group icons', exact: true }).click();
  await expect(panel.getByRole('group', { name: 'Group icon palette', exact: true }).getByRole('button')).toHaveCount(56);
  await page.screenshot({ path: test.info().outputPath('round-icon-palette.png') });
  await panel.getByLabel('Group find icon').click();
  await expect(panel.getByRole('group', { name: 'Group icon palette', exact: true })).toBeVisible();
  await panel.getByLabel('Group name', { exact: true }).fill('Verified sites');
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await expect(panel.getByRole('group', { name: 'Group icon palette', exact: true })).toHaveCount(0);
  await expect(panel.getByLabel('Group style')).toHaveCount(0);
  await expect.poll(() => fixture.groups.get(first.name)[1].name).toBe('Verified sites');
  await panel.getByRole('button', { name: 'Edit group Verified sites', exact: true }).click();
  await panel.getByRole('button', { name: 'Group icons', exact: true }).click();
  await panel.getByLabel('Group find icon').fill('Building');
  await panel.getByRole('button', { name: 'Group Building icon', exact: true }).click();
  await panel.getByRole('button', { name: 'Group green', exact: true }).click();
  await expect.poll(() => fixture.groups.get(first.name)[1].symbol).toBe('badge-building');
  await panel.getByRole('button', { name: 'Add markers', exact: true }).click();
  const box = await page.locator('.map').boundingBox();
  await page.mouse.click(box.x + box.width * 0.37, box.y + box.height * 0.5);
  await expect(panel.getByText('1 feature', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await clickCard(page, box.x + box.width * 0.37, box.y + box.height * 0.5);
  await expect(page.locator('.layer-card')).toContainText('Marker 1');
  await addGate();
  await panel.getByRole('button', { name: 'Case gate', exact: true }).click();
  await expect(panel.getByText('Uses the style of Verified sites.', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('compact-group-editor.png') });
  await panel.getByRole('button', { name: 'Done', exact: true }).click();

  await createLayer('Footage map');
  const second = fixture.rows[0];
  await addGate();
  await panel.getByRole('button', { name: 'Case gate', exact: true }).click();
  await chooseIcon(panel, 'Selected marker', 'FPV drone');
  await panel.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => fixture.collections.get(second.name)[0].properties.symbol).toBe('badge-fpv-drone');
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
  expect(fixture.collections.get(first.name).some((feature) => feature.properties.place_id === 'shared-place')).toBe(true);
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
