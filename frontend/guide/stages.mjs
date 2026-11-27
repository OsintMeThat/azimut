/**
 * How each of the guide's pictures is staged in the demo case.
 *
 * One entry per picture `lib/guide.js` names, in the order they are taken: a stage may
 * lean on the one before it (a proof saved here is the thread posted next). Each one
 * brings the app into the state its page explains with the clicks an analyst would make,
 * and says what part of the window the picture keeps:
 *
 *   window  the browser size, so the tool is laid out as on a laptop
 *   clip    the element the picture is cut from (the tool, by default)
 *   crop    'anchors' (default) keeps the frames and a margin; 'full' keeps the clip
 *   focus   more elements the crop must hold, such as a menu that opened
 *   sidebar true keeps the case sidebar open
 *   after   false leaves what a picture taken from another one opened, which Escape
 *           otherwise closes for the next
 *   browser 'extension' takes the picture in the browser that has the capture
 *           extension loaded, over a map site (extension.mjs)
 *   film    what plays in the picture's place: `play({ page, frame })` moves the page,
 *           takes frames, and answers them in the order they run; `rate` is its bitrate
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { CAMERA, CAMERA_PLACE, CHANNEL, GLACIER_POINT, TERMINAL } from './demo.mjs';
import { AIRBASE, AREAS, MARKS, MAX_CLOUD, PASSES, REFERENCE, ROUTINE } from './airbase.mjs';
import { liftAnchors } from './extension.mjs';

const TOOLS = { width: 1000, height: 700 };
const WIDE = { width: 1100, height: 720 };
const LARGE = { width: 1200, height: 760 };
/** The size the Detect film was made at, the map wide beside its column. */
const FILM = { width: 1600, height: 900 };
/** Room for a tall column, kept landscape so the guide shows the picture whole. */
const TALL = { width: 1400, height: 880 };
/** Settings with every section of a tab on screen. */
const SETTINGS = { width: 1440, height: 900 };
/** General, the longest tab, with its 3D views row too: still wider than tall. */
const GENERAL = { width: 1440, height: 1080 };
/** Wide enough for Board's Details to open beside the rows rather than over them. */
const ROOMY = { width: 1360, height: 800 };

const CHANNEL_VIEW = `ll=${CHANNEL.lat},${CHANNEL.lon}&z=16`;
/** Al Udeid Air Base, where the analyzer journey stands from its first picture to its last. */
const AIRBASE_VIEW = `ll=${AIRBASE.lat},${AIRBASE.lon}&z=${AIRBASE.zoom}`;

/**
 * The 1901 photo of Half Dome from Glacier Point (photos/half_dome_1901.jpg), traced by eye
 * in its own pixels, 1554 by 1187, as an analyst would see it: the skyline in four lines
 * (the far ridge left of the Dome, the Dome, the far range behind it, the ridge on the
 * right), and the ridges seen in front of farther land.
 */
const HALF_DOME_1901 = {
  size: [1554, 1187],
  skyline: {
    farLeft: [[20, 172], [40, 162], [58, 157], [77, 160], [90, 167], [99, 175]],
    dome: [[100, 176], [101, 160], [103, 147], [110, 120], [113, 107], [115, 103], [140, 101], [167, 101], [187, 102], [213, 105], [240, 112], [263, 120], [283, 135], [300, 148], [317, 167], [333, 187], [347, 207], [358, 227], [365, 243], [368, 250]],
    farRange: [[380, 250], [430, 255], [475, 245], [500, 245], [545, 241], [600, 236], [630, 239], [670, 239], [705, 239], [740, 247], [770, 242], [805, 237], [845, 234], [870, 237], [905, 240], [930, 236], [955, 235], [980, 236], [1020, 222], [1040, 232], [1070, 240], [1110, 244], [1150, 246], [1180, 247]],
    right: [[1180, 249], [1200, 247], [1240, 237], [1280, 230], [1310, 225], [1340, 210], [1360, 209], [1390, 212], [1430, 207], [1460, 202], [1490, 197], [1515, 195]],
  },
  ridges: {
    wooded: [[390, 258], [410, 262], [480, 262], [530, 260], [590, 257], [640, 257], [680, 254], [705, 252], [730, 255], [760, 260], [780, 267]],
    shoulder: [[368, 250], [380, 275], [395, 300], [410, 330], [425, 360], [432, 390]],
    libertyCap: [[960, 452], [980, 430], [1000, 415], [1020, 405], [1040, 395], [1070, 385], [1100, 381], [1130, 380], [1160, 385], [1180, 392], [1195, 405], [1205, 420], [1215, 440], [1222, 465], [1226, 490]],
  },
};

/** Find's area round Yosemite Valley and its rims, as fractions of its map: about 10 km across, the 1901 point off its middle. */
const FIND_AREA = [[0.25, 0.33], [0.78, 0.31], [0.8, 0.71], [0.27, 0.73]];

/** What the guide's Try this search files (lib/findExample.js): the search these pictures show, as the app asked it. */
const FIND_EXAMPLE = new URL('../src/lib/findExample.json', import.meta.url);

/** The window the place found is filmed in: the view, cut from beside its column, landscape round the photo. */
const LOOK = { width: 1520, height: 900 };
/** The film of the place found, in frames: on one end of the slider, then the way to the other. */
const LOOK_HOLD = 30;
const LOOK_SWEEP = 45;

/** The one element of these on screen: tools stay mounted, hidden, once visited. */
const seen = (page, selector) => page.locator(selector).filter({ visible: true }).first();

/** The card of one file in a grid of cards. */
const card = (page, name) => page.locator('.canvas-body .media-card', { hasText: name }).filter({ visible: true }).first();

/**
 * What agrees between the photo and the capture of the channel, as fractions of each
 * picture: the bridge's east tower, and the green Evergreen cranes in front of it.
 * Read off the two pictures, the capture's at the zoom it was taken at (`demo.mjs`).
 */
const MATCHES = [
  // the east tower of the bridge, over the Evergreen terminal: where the deck meets Terminal Island
  { photo: [0.69, 0.09, 0.76, 0.36], capture: [0.713, 0.16, 0.77, 0.248] },
  { photo: [0.6, 0.22, 0.9, 0.62], capture: [0.58, 0.31, 0.71, 0.5] },
];

/** The two pictures of a proof on screen, photo first, read off the canvas it is drawn on. */
async function proofPictures(page) {
  const canvas = await seen(page, '[data-guide="proof.canvas"] .konva').boundingBox();
  const boxes = await page.evaluate(() => {
    const stage = window.Konva?.stages?.[0];
    if (!stage) return [];
    return stage
      .find('Image')
      .map((node) => node.getClientRect())
      .filter((r) => r.width > 120 && r.height > 80)
      .sort((a, b) => a.x - b.x || a.y - b.y);
  });
  return boxes.slice(0, 2).map((r) => ({ x: canvas.x + r.x, y: canvas.y + r.y, w: r.width, h: r.height }));
}

async function drawBox(page, picture, [x0, y0, x1, y1]) {
  await page.mouse.move(picture.x + picture.w * x0, picture.y + picture.h * y0);
  await page.mouse.down();
  await page.mouse.move(picture.x + picture.w * x1, picture.y + picture.h * y1, { steps: 6 });
  await page.mouse.up();
}

/** Where a coordinate stands on the world, 0 to 1 each way, in web Mercator. */
function mercator({ lat, lon }) {
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
}

/**
 * Where `point` is drawn on the map of the tool in view, in page pixels: the map's middle
 * is `view`, and the zoom in the app's address counts 256-pixel tiles, as the map sites do.
 */
async function onMap(page, view, point) {
  const box = await page.locator('[data-guide="map.ground"]').filter({ visible: true }).first().boundingBox();
  const size = 256 * 2 ** view.zoom;
  const [middle, there] = [mercator(view), mercator(point)];
  return {
    x: box.x + box.width / 2 + (there.x - middle.x) * size,
    y: box.y + box.height / 2 + (there.y - middle.y) * size,
  };
}

/** The view a measure from the camera to the berth fits in. */
const SIGHT = {
  lat: (CAMERA.lat + TERMINAL.lat) / 2,
  lon: (CAMERA.lon + TERMINAL.lon) / 2,
  zoom: 16,
};

/**
 * A reader's own icon pack, for Settings, Icons: the app's pictograms
 * (components/Icon.svelte) on coloured tiles, in the groups a pack's folders make.
 */
const PICTOGRAMS = (() => {
  const source = readFileSync(new URL('../src/components/Icon.svelte', import.meta.url), 'utf8');
  const path = (glyph) => new RegExp(`\\n\\s+${glyph}: '([^']+)'`).exec(source)?.[1];
  return [
    ['Vessel', 'ship', 'Movement', '#0e7490'],
    ['Aircraft', 'plane', 'Movement', '#0e7490'],
    ['Vehicle', 'car', 'Movement', '#0e7490'],
    ['Person', 'user', 'Movement', '#0e7490'],
    ['Building', 'building', 'Places', '#4d7c0f'],
    ['Checkpoint', 'flag', 'Places', '#4d7c0f'],
    ['Camera position', 'camera', 'Places', '#4d7c0f'],
    ['Fire', 'flame', 'Events', '#b45309'],
    ['Sighting', 'eye', 'Events', '#b45309'],
    ['Target', 'crosshair', 'Events', '#b45309'],
  ]
    .map(([name, glyph, group, colour]) => ({ name, d: path(glyph), group, colour }))
    .filter((icon) => icon.d);
})();

/** The pack filed as Settings files one: each icon drawn in the browser and sent as a PNG. */
async function fileIcons(page) {
  const filed = await page.evaluate(async (icons) => {
    const form = new FormData();
    for (const icon of icons) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = icon.colour;
      ctx.beginPath();
      ctx.roundRect(4, 4, 120, 120, 26);
      ctx.fill();
      ctx.translate(22, 22);
      ctx.scale(84 / 24, 84 / 24);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.9;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(new Path2D(icon.d));
      const blob = await new Promise((done) => canvas.toBlob(done, 'image/png'));
      form.append('files', blob, `${icon.name}.png`);
      form.append('groups', icon.group);
    }
    return (await fetch('/api/icons', { method: 'POST', body: form })).ok;
  }, PICTOGRAMS);
  if (!filed) throw new Error('the icon pack was refused');
}

/** Where Geolocate first opens the map in the journeys: far out, nothing found yet. */
const SEARCH_VIEW = { lat: 36.6, lon: -119.6, zoom: 6 };
/** The channel once the search found it: the bridge's east tower, the Evergreen cranes and the west bank in one view. */
const MEASURE_VIEW = { lat: 33.7445, lon: -118.2735, zoom: 16 };
/**
 * The bridge's east tower, read off the matching capture where the proof boxes it. In the
 * photo it stands right behind the Evergreen cranes (`TERMINAL`), so the camera is on the
 * line through both, high on the west bank: `CAMERA` lies on it, and the line is drawn on
 * to `LINE_END`, a little past it into town.
 */
const EAST_TOWER = { lat: 33.7492, lon: -118.2688 };
const LINE_END = { lat: 33.74108, lon: -118.28031 };
/**
 * The lead an analyst drops once the line is drawn, the case's own pins put away: where
 * the line leaves the car park for the first buildings of town, the camera's spot and the
 * point the proof names as it.
 */
const LEADS = [CAMERA];
/**
 * The video's lead, on the water: it is filmed from a ship heading south down the Main
 * Channel toward the sea, two cranes on a pier's tip close on its left and a tall building
 * at the end of the west pier far ahead on its right.
 */
const VIDEO_LEADS = [{ lat: 33.73115, lon: -118.27364 }];
/** Where the video's ship was found: the Main Channel between the oil tanks and the sea. */
const VIDEO_VIEW = { lat: 33.7262, lon: -118.2735, zoom: 16 };
/** The video's capture: the camera's spot, the two cranes and the building at the channel's end in one picture. */
const VIDEO_CAPTURE = { lat: 33.7262, lon: -118.2725, zoom: 16, width: 900, height: 800, provider: 'usgs-imagery' };
/**
 * What agrees between a frame of the video and its capture, as fractions of each picture:
 * the two cranes on the left bank (33.730681, -118.271214), then the building at the far
 * end on the right (33.721331, -118.272483).
 */
const VIDEO_MATCHES = [
  { photo: [0.005, 0.21, 0.155, 0.47], capture: [0.533, 0.151, 0.6, 0.221] },
  { photo: [0.782, 0.35, 0.842, 0.412], capture: [0.473, 0.813, 0.529, 0.869] },
];
/** The capture that matches, framed as the demo case's own (demo.mjs), so the proof's boxes fall where they did. */
const MATCHING_CAPTURE = { ...CHANNEL, zoom: 16, width: 1000, height: 700, provider: 'usgs-imagery' };

/** A tab of Inspect's panel, by its name. */
const inspectTab = (page, name) => seen(page, '[data-guide="inspect.tabs"]').locator('button', { hasText: name });

/** The demo clip open in Inspect on its Scenes tab, the ship's passage marked to geolocate once. */
async function clipScenes(go, page) {
  await go('inspect');
  await page.locator('.canvas-body').getByText('channel_departure', { exact: true }).first().click();
  await page.locator('[data-guide="inspect.strip"] img').nth(2).waitFor({ timeout: 60_000 });
  await inspectTab(page, 'Scenes').click();
  if (await page.getByTestId('scene-row').count()) return;
  // Passage, then a drag across the bar over where the ship leaves the channel
  await seen(page, '[data-guide="inspect.scene"]').locator('button', { hasText: 'Passage' }).click();
  const bar = await seen(page, '.track').boundingBox();
  const at = (fraction) => [bar.x + bar.width * fraction, bar.y + bar.height / 2];
  await page.mouse.move(...at(0.15));
  await page.mouse.down();
  await page.mouse.move(...at(0.45), { steps: 4 });
  await page.mouse.move(...at(0.75), { steps: 4 });
  await page.mouse.up();
  const label = page.getByTestId('scene-row').first().getByRole('textbox', { name: 'Scene label' });
  await label.waitFor({ timeout: 5000 }).then(async () => {
    await label.fill('Leaving by the Main Channel');
    await label.press('Enter');
  }).catch(() => {});
}

/** Geolocate pressed on the scene open in Inspect: the pill comes up over every tool. */
async function geolocate(page) {
  await seen(page, '[data-guide="inspect.scenes"]').getByRole('button', { name: 'Geolocate' }).first().click();
  await seen(page, '[data-guide="geo.pill"]').waitFor();
}

/** The pill's ✕ pressed, when a scene from an earlier picture is still held. */
async function stopHeld(page) {
  const stop = page.locator('[data-guide="geo.stop"]').filter({ visible: true });
  if (await stop.count()) {
    await stop.first().click();
    await page.waitForTimeout(600);
  }
}

/**
 * The case's own pins put away on the Satellite map, as its layer list switches Places
 * and Media off (`lib/map/layerMemory.js`), so a search does not open on the place the
 * demo case already saved; or put back, for the pictures taken after. Read at the next load.
 */
async function casePins(page, demo, shown) {
  await page.evaluate(
    ({ key, shown }) => {
      const kept = JSON.parse(localStorage.getItem(key) ?? '{}');
      const maps = { ...kept.maps };
      if (shown) delete maps.satellite;
      else maps.satellite = ['boundaries'];
      localStorage.setItem(key, JSON.stringify({ ...kept, maps }));
    },
    { key: `azimut:map-layers:${demo.caseId}`, shown }
  );
}

/** Satellite on `view` with the scene held, its picture beside the map as the pill's map icon brings it back. */
async function mapWithScene(go, page, demo, view) {
  await casePins(page, demo, false);
  await go(`satellite?ll=${view.lat},${view.lon}&z=${view.zoom}&p=usgs-imagery`);
  await seen(page, '[data-guide="geo.pill"]').getByRole('button', { name: 'Go to Satellite' }).click();
  await seen(page, '[data-guide="map.ref"]').waitFor();
  const hide = page.locator('[data-guide="sat.panel"] [title="Hide the panel"]').filter({ visible: true });
  if (await hide.count()) await hide.first().click();
  await page.waitForTimeout(1500);
}

/**
 * Drop a lead, then a click on each of `leads` on the map at `view`. With `take`, a frame
 * is taken after each press, for a film of it.
 */
async function dropLeads(page, view, leads, take = async () => {}) {
  await seen(page, '[data-guide="sat.place"]').getByRole('button', { name: 'Drop a lead' }).click();
  await take();
  for (const lead of leads) {
    const { x, y } = await onMap(page, view, lead);
    await page.mouse.click(x, y);
    // off the map, where the next lead's pin would follow the pointer over this one
    await page.mouse.move(1, 1);
    await page.waitForTimeout(500);
    await take();
  }
  await page.keyboard.press('Escape');
}

/**
 * The capture that matches, the photo's unless another is given, filed through the route
 * Capture uses: the server gathers it for the scene held, as it gathers any capture filed
 * meanwhile.
 */
async function captureScene(page, demo, capture = MATCHING_CAPTURE) {
  await page.evaluate(
    async ({ caseId, capture }) => {
      const answer = await fetch(`/api/cases/${caseId}/satellite/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(capture),
      });
      if (!answer.ok) throw new Error(`the capture was refused: ${answer.status}`);
    },
    { caseId: demo.caseId, capture }
  );
  // the pill counts it once the server's word comes back
  await page.waitForTimeout(2500);
}

/** One provider on a map's imagery chip, picked from its list, within `scope`. */
async function useImagery(scope, label) {
  await scope.locator('button[aria-label="Imagery provider"]').first().click();
  await scope.getByRole('option', { name: label }).first().click();
}

/**
 * Save proof pressed: the point the imagery proposed is checked on a map first, drawn
 * here from the public USGS imagery rather than the dialog's own default.
 */
async function saveToCheck(page) {
  await page.locator('[data-guide="proof.save"]').click();
  const check = page.getByRole('dialog', { name: /Check the point/ });
  await check.waitFor();
  await useImagery(check, 'USGS Imagery');
  await check.locator('[data-guide="point.lead"]').waitFor();
  await page.waitForTimeout(1500);
}

/** Use this point in the check: the proof is saved on the point it proposed, what the picture shows. */
async function keepPoint(page) {
  const check = page.getByRole('dialog', { name: /Check the point/ });
  await check.locator('[data-guide="point.use"]').click();
  await check.waitFor({ state: 'detached' });
  await page.waitForTimeout(2000);
  await closeSidebar(page);
}

/** The plus beside Coordinates: a second row, for the camera. */
async function addPointRow(page) {
  await page.locator('[data-guide="proof.add-point"]').click();
  await page.locator('[data-guide="proof.new-pin"]').waitFor();
}

/** The new row's pin icon: the map it opens, over the public imagery, the leads beside it. */
async function newRowMap(page) {
  await page.locator('[data-guide="proof.new-pin"]').click();
  const move = page.getByRole('dialog', { name: 'Move the point' });
  await move.waitFor();
  await useImagery(move, 'USGS Imagery');
  await move.locator('[data-guide="point.lead"]').waitFor();
  await page.waitForTimeout(1500);
}

/** Lead 1 pressed in that map: the pin goes where the camera stood. */
async function takeFirstLead(page) {
  await page.getByRole('dialog', { name: 'Move the point' }).locator('[data-guide="point.lead"]').click();
  await page.waitForTimeout(1500);
}

/** Use this point: the new row holds the camera's spot. */
async function useMovedPoint(page) {
  const move = page.getByRole('dialog', { name: 'Move the point' });
  await move.locator('[data-guide="point.use"]').click();
  await move.waitFor({ state: 'detached' });
  await page.waitForTimeout(800);
}

/** A row of the proof's points named, by its label's anchor, the field left after. */
async function namePoint(page, anchor, name) {
  const label = page.locator(`[data-guide="${anchor}"]`);
  await label.fill(name);
  await label.press('Tab');
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(500);
}

/** The eye beside the new row's label pressed: that point is where the camera stood. */
async function cameraPov(page) {
  await page.locator('[data-guide="proof.new-pov"]').click();
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(500);
}

/** Every picture of the proof on screen, left to right, read off the canvas it is drawn on. */
async function allProofPictures(page) {
  const canvas = await seen(page, '[data-guide="proof.canvas"] .konva').boundingBox();
  const boxes = await page.evaluate(() => {
    const stage = window.Konva?.stages?.[0];
    if (!stage) return [];
    return stage
      .find('Image')
      .map((node) => node.getClientRect())
      .filter((r) => r.width > 120 && r.height > 80)
      .sort((a, b) => a.x - b.x || a.y - b.y);
  });
  return boxes.map((r) => ({ x: canvas.x + r.x, y: canvas.y + r.y, w: r.width, h: r.height }));
}

/** The proof's page fitted to its frame, then marked out for the crop: its pictures and the line under them. */
async function framePage(page) {
  await page.keyboard.press('f');
  await page.waitForTimeout(400);
  const pictures = await allProofPictures(page);
  const left = Math.min(...pictures.map((p) => p.x));
  const top = Math.min(...pictures.map((p) => p.y));
  const right = Math.max(...pictures.map((p) => p.x + p.w));
  const bottom = Math.max(...pictures.map((p) => p.y + p.h));
  await page.evaluate(
    ({ left, top, width, height }) => {
      document.getElementById('guide-proof-page')?.remove();
      const page = document.createElement('div');
      page.id = 'guide-proof-page';
      Object.assign(page.style, {
        position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
        pointerEvents: 'none',
      });
      document.body.appendChild(page);
    },
    { left, top, width: right - left, height: bottom - top + 24 }
  );
}

/** The post's Mention emptied, as a practice post should be. */
async function clearMention(page) {
  const mention = page.locator('[data-guide="post.mention"]');
  await mention.fill('');
  await mention.press('Tab');
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(600);
}

/** Overlay pressed in Horizon, its list of the case's pictures put on one filter. */
async function pickerOn(page, filter) {
  await seen(page, '[data-guide="horizon.lay"]').click();
  const list = seen(page, '[data-guide="horizon.photos"]');
  // Overlay already on from the picture before: its own button asks for the photo again
  if (!(await list.waitFor({ timeout: 3000 }).then(() => true, () => false))) {
    await seen(page, '[aria-label="Add a photo or video"]').click();
  }
  await list.waitFor();
  await list.locator('[aria-label="Media type"]').getByRole('button', { name: filter, exact: true }).click();
  // an empty list is no picture
  if (await list.getByText('No media matches this filter.').isVisible()) throw new Error(`the case holds no ${filter.toLowerCase()} yet`);
  await page.mouse.move(1, 1);
  await page.waitForTimeout(1500);
}

/** The box tool taken up, unless it is in hand: a box drawn hands the cursor back to Select. */
async function armBox(page) {
  const box = page.locator('[data-guide="proof.box"]');
  if ((await box.getAttribute('aria-pressed')) !== 'true') await box.click();
}

/**
 * A film of one feature boxed on both pictures of the proof, the photo first, the tool
 * taken up again between the two as a reader presses R; the last box let go at the end.
 */
async function boxBoth(page, frame, match) {
  const { frames, take } = filmFrames(frame);
  const [photo, capture] = await proofPictures(page);
  if (!capture) throw new Error('the proof did not draw its two pictures');
  const drag = async (picture, [x0, y0, x1, y1]) => {
    const to = (t) => [picture.x + picture.w * (x0 + (x1 - x0) * t), picture.y + picture.h * (y0 + (y1 - y0) * t)];
    await page.mouse.move(...to(0));
    await page.mouse.down();
    for (let step = 1; step <= 8; step += 1) {
      await page.mouse.move(...to(step / 8));
      await take();
    }
    await page.mouse.up();
    await take(10);
  };
  await take(16);
  await armBox(page);
  await drag(photo, match.photo);
  await armBox(page);
  await take(6);
  await drag(capture, match.capture);
  const canvas = await seen(page, '[data-guide="proof.canvas"] .konva').boundingBox();
  await page.mouse.click(canvas.x + 6, canvas.y + 6);
  await page.mouse.move(1, 1);
  await take(40);
  return frames;
}

/** One match of the video's proof boxed on its frame, then on its capture, the canvas let go after. */
async function boxVideoMatch(page, match) {
  const pictures = await allProofPictures(page);
  const [frame, capture] = [pictures[0], pictures.at(-1)];
  if (!capture || capture === frame) throw new Error('the proof did not draw its frame and its capture');
  for (const [picture, at] of [[frame, match.photo], [capture, match.capture]]) {
    await armBox(page);
    await drawBox(page, picture, at);
  }
  const canvas = await seen(page, '[data-guide="proof.canvas"] .konva').boundingBox();
  await page.mouse.click(canvas.x + 6, canvas.y + 6);
}

/**
 * Detect on the apron, New detection pressed and `kind` (One pass, Routine) picked in its
 * menu. Detect opens where the map tabs last looked, so Satellite looks there first.
 */
async function newDetection(go, page, demo, kind) {
  await fileAreas(page, demo);
  await go(`satellite?${AIRBASE_VIEW}`);
  await page.locator('[data-map-ready="true"]').filter({ visible: true }).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.locator('.tabstrip').getByRole('button', { name: 'Detect', exact: true }).click();
  await pickImagery(page, 'OpenStreetMap').catch(() => {});
  await page.waitForTimeout(1500);
  const menu = page.locator('[data-guide="detect.new-menu"]').filter({ visible: true });
  for (let tries = 0; tries < 3 && !(await menu.count()); tries += 1) {
    await seen(page, '[data-guide="detect.new"]').locator('button').first().click();
    await page.waitForTimeout(500);
  }
  await menu.locator('.kind-copy', { hasText: kind }).first().click();
  await seen(page, '[data-guide="detect.where"]').waitFor();
}

/**
 * Each area's dates typed in When, as several areas ask them: A, the reference, and B
 * when given, each through its calendar's Enter a date.
 */
async function areaDates(page, { a, b = '' }) {
  const typed = async (button, label, day) => {
    await page.getByRole('button', { name: button }).filter({ visible: true }).first().click();
    await page.locator('details.manual-date summary').filter({ visible: true }).first().click();
    const field = page.getByRole('textbox', { name: label }).filter({ visible: true }).first();
    await field.fill(day.split('-').reverse().join('/'));
    await field.press('Enter');
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
  };
  for (const area of AREAS) {
    await typed(`Date A for ${area.name}`, `Reference for ${area.name}`, a);
    if (b) await typed(`Date B for ${area.name}`, `Pass for ${area.name}`, b);
  }
  await page.mouse.move(1, 1);
}

/** The case's routine opened from Detect's Routines tab, its own panel in the dock. */
async function openRoutine(page) {
  // the Routines tab takes the dock home, out of whatever it showed
  await seen(page, '[data-guide="detect.tabs"] [aria-label="Routines"]').click();
  await page.locator('button.title[title="Open this routine"]', { hasText: ROUTINE.title }).first().click();
  await seen(page, '[data-guide="detect.catch-up"]').waitFor({ timeout: 30_000 });
  await page.mouse.move(1, 1);
}

/** The four areas the owner's routine watches, saved in the case as Areas saves a drawn one. */
async function fileAreas(page, demo) {
  const saved = await route(page, 'GET', `/api/cases/${demo.caseId}/analysis/areas`);
  for (const area of AREAS) {
    if (saved.some((one) => one.name === area.name)) continue;
    await route(page, 'POST', `/api/cases/${demo.caseId}/analysis/areas`, {
      name: area.name,
      colour: '#38bdf8',
      geometry: { type: 'Polygon', coordinates: [[...area.ring, area.ring[0]]] },
    });
  }
}

/** Where: Al Udeid searched among the saved areas, its four ticked. */
async function airbaseAreas(page) {
  await seen(page, 'input[aria-label="Search areas or groups"]').fill('Al Udeid');
  await page.waitForTimeout(400);
  for (const area of AREAS) {
    await page.locator('[data-guide="detect.where"] .area-item', { hasText: area.name }).first().click();
    await page.waitForTimeout(250);
  }
  await page.mouse.move(1, 1);
  await page.waitForTimeout(800);
}

/**
 * The check's pins dropped where the Detect film's stand (`MARKS`): Should be found on each
 * aircraft that came, then Should stay empty on bare apron and look-alikes, a frame taken
 * after each click when filmed.
 */
async function dropCheckPins(page, take = async () => {}) {
  for (const expect of ['found', 'empty']) {
    // a pin button toggles, and the first comes armed once the passes are picked
    const arm = seen(page, `[data-guide="detect.pin-${expect}"]`);
    if ((await arm.getAttribute('aria-pressed')) !== 'true') await arm.click();
    await take(8);
    for (const mark of MARKS.filter((one) => one.expect === expect)) {
      const [lon, lat] = mark.point;
      const { x, y } = await onMap(page, AIRBASE, { lat, lon });
      await page.mouse.move(x, y, { steps: 4 });
      await page.mouse.click(x, y);
      await page.waitForTimeout(120);
      await take(3);
    }
  }
  await page.mouse.move(1, 1);
}

/** A film's frames, each one held for `hold` frames of the film. */
function filmFrames(frame) {
  const frames = [];
  const take = async (hold = 1) => {
    const path = await frame();
    for (let at = 0; at < hold; at += 1) frames.push(path);
  };
  return { frames, take };
}

/** The proof's facts tab, where the point, the source, the description and the date are. */
async function proofFacts(page) {
  await page.getByRole('tablist', { name: 'Proof settings' }).getByRole('tab', { name: /^Proof/ }).click();
}

/** The case sidebar put away, where saving a proof or opening a post brought it out. */
async function closeSidebar(page) {
  if (await page.locator('aside[data-guide="start.sidebar"]').isVisible()) {
    await page.locator('.topbar button[title^="Toggle case sidebar"]').click();
    await page.waitForTimeout(400);
  }
}

async function pickImagery(page, label) {
  const chip = page.locator('[data-guide="map.imagery"] .chip').filter({ visible: true }).first();
  await chip.click();
  await page.getByRole('menuitem', { name: label }).or(page.locator('button', { hasText: label })).filter({ visible: true }).first().click();
}

// -- a layer of one's own, built from nothing (the make-a-layer journey) ------------

/** The layer the journey builds, named as the Satellite page's own picture names it. */
const SURVEY = 'Channel survey';
/** The view every picture of the layer is taken at: the quay, the channel and the terminal's yard. */
const SURVEY_VIEW = { ...CHANNEL, zoom: 16 };
/** What the analyst draws, as they would trace it on the imagery. */
const CRANES = [{ lat: 33.7472, lon: -118.2716 }, { lat: 33.7466, lon: -118.2719 }, { lat: 33.746, lon: -118.2722 }];
/** The way a ship leaves the port, down the middle of the channel from under the bridge. */
const ROUTE = [{ lat: 33.747, lon: -118.2734 }, { lat: 33.7452, lon: -118.2743 }, { lat: 33.7434, lon: -118.2752 }, { lat: 33.7416, lon: -118.2763 }];
/** The Evergreen terminal's yard, behind its cranes. */
const YARD = [
  { lat: 33.7478, lon: -118.2705 }, { lat: 33.7474, lon: -118.268 }, { lat: 33.7446, lon: -118.2672 },
  { lat: 33.7428, lon: -118.2696 }, { lat: 33.7452, lon: -118.2716 },
];
/**
 * What the case dates, as a group of events on a tracked layer: the three dated claims
 * of the demo case (demo.mjs), each where its photo shows it.
 */
const SIGHTINGS = [
  { name: 'Container yard photo', at: '2006-11-02', lat: 33.7452, lon: -118.2688, symbol: 'badge-image' },
  { name: 'YM Success', at: '2009-02-03', lat: 33.748, lon: -118.2729, symbol: 'badge-ship' },
  { name: 'Ship leaving', at: '2020-05-15', lat: 33.7432, lon: -118.2752, symbol: 'badge-ship' },
];
/** The day the ship of the proof had left: the YM Success is in port on 3 Feb 2009 only. */
const SHIP_GONE = '2009-02-04';
/** The date step's window: tall enough for the day box over the list and a feature's sheet under it. */
const DATED = { width: 1100, height: 850 };
/** Where the route and the yard are picked on the map: on the line between two of its points, and inside the yard. */
const ROUTE_MIDDLE = { lat: (ROUTE[1].lat + ROUTE[2].lat) / 2, lon: (ROUTE[1].lon + ROUTE[2].lon) / 2 };
const YARD_MIDDLE = { lat: 33.7456, lon: -118.2694 };
/** The two groups the layer is sorted into: the cranes, and the line and the area. */
const GROUP_ONE = 'Cranes';
const GROUP_TWO = 'Port';

/** A call to the app's own routes, made from the page as the app makes it. */
async function route(page, method, path, body) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const answer = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!answer.ok) throw new Error(`${method} ${path}: ${answer.status} ${await answer.text()}`);
      return answer.json();
    },
    { method, path, body }
  );
}

/** The case's layer of that title, by the name its routes take. */
async function layerNamed(page, demo, title) {
  const rows = await route(page, 'GET', `/api/cases/${demo.caseId}/map-layers`);
  return rows.find((row) => row.title === title)?.name ?? null;
}

/** Satellite on the layer's ground, its panel open on the layers. */
async function layersPanel(go, page) {
  await go(`satellite?ll=${SURVEY_VIEW.lat},${SURVEY_VIEW.lon}&z=${SURVEY_VIEW.zoom}&p=usgs-imagery`);
  const show = page.locator('[data-guide="sat.panel"] [title="Show the panel"]').filter({ visible: true });
  if (await show.count()) await show.first().click();
  await seen(page, '[data-guide="sat.mylayers"]').waitFor();
}

/** Every edit the layer's panel says it is saving, saved. */
async function layerSaved(page) {
  await page.waitForFunction(() => !document.querySelector('[data-guide="layer.panel"] .saving'), null, { timeout: 30_000 });
}

/** Nothing picked in the layer, as its sheet's close button leaves it. */
async function clearPick(page) {
  const clear = page.locator('[data-guide="layer.panel"] [aria-label="Clear the selection"]').filter({ visible: true });
  if (await clear.count()) await clear.first().click();
}

/**
 * A feature picked on the map where it is drawn, which keeps the view where it is (a row
 * pressed would fly to it); by its row when the click lands beside it.
 */
async function pickAt(page, point, name) {
  await clearPick(page);
  const spot = await onMap(page, SURVEY_VIEW, point);
  await page.mouse.click(spot.x, spot.y);
  const field = seen(page, '[data-guide="layer.sheet-name"]');
  const picked = await field.waitFor({ timeout: 3000 }).then(async () => (await field.inputValue()) === name).catch(() => false);
  if (!picked) await seen(page, `[data-guide="layer.feature"]:has-text("${name}")`).click();
  await seen(page, '[data-guide="layer.sheet-name"]').waitFor();
}

/** Where the yard's south-east corner is pulled to on today: the stacks reach further out. */
const YARD_GROWN = { lat: 33.7431, lon: -118.2652 };

/** The picked Yard's south-east corner dragged out to `YARD_GROWN`, a frame taken along the way when filmed. */
async function growYard(page, take = async () => {}) {
  const from = await onMap(page, SURVEY_VIEW, YARD[2]);
  const to = await onMap(page, SURVEY_VIEW, YARD_GROWN);
  await page.mouse.move(from.x, from.y);
  await take(4);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10);
    await take();
  }
  await page.mouse.up();
  await take(4);
  await layerSaved(page);
}

/** One of the cranes picked on the map, by its marker. */
const pickCrane = (page, index, name) => pickAt(page, CRANES[index], name);

/** A feature picked, renamed, and saved. */
async function rename(page, point, from, to) {
  await pickAt(page, point, from);
  const name = seen(page, '[data-guide="layer.sheet-name"]');
  await name.fill(to);
  await name.press('Enter');
  await layerSaved(page);
}

/**
 * The survey open for editing again after Done put it down, as its pencil in My layers
 * opens it, aiming what comes next at `group` as the last feature picked there would.
 */
async function editSurvey(go, page, group) {
  if (await page.locator('[data-guide="layer.tools"]').filter({ visible: true }).count()) return;
  await layersPanel(go, page);
  await seen(page, `[data-guide="sat.mylayers"] button[aria-label="Edit ${SURVEY}"]`).click();
  await seen(page, '[data-guide="layer.tools"]').waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('[data-guide="layer.panel"] .note')?.textContent?.includes('Opening'));
  if (!group) return;
  // the bar's Style button holds the group what comes next goes into
  const style = seen(page, '[data-guide="layer.tools"] button.style-button[aria-label="Style"]');
  await style.click();
  await seen(page, '.group-row select').selectOption({ label: group });
  await style.click();
  await page.waitForTimeout(300);
}

/** The proof's marker picked on the map, where the proof's point puts it. */
async function pickProof(page, demo) {
  await clearPick(page);
  const name = await layerNamed(page, demo, SURVEY);
  const data = await route(page, 'GET', `/api/cases/${demo.caseId}/map-layers/${encodeURIComponent(name)}/data`);
  const linked = data.features.find((one) => one.properties.entity_id);
  const [lon, lat] = linked.geometry.coordinates;
  const spot = await onMap(page, SURVEY_VIEW, { lat, lon });
  await page.mouse.click(spot.x, spot.y);
  const end = seen(page, '[data-guide="layer.feature-end"]');
  if (!(await end.waitFor({ timeout: 3000 }).then(() => true).catch(() => false))) await seen(page, '[data-guide="layer.linked"]').click();
  await seen(page, '[data-guide="layer.feature-end"]').waitFor();
}

/** A frame once the map has drawn what the last press changed. */
async function drawn(page, frame) {
  await page.waitForTimeout(250);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  return frame();
}

/**
 * A film of shapes drawn corner by corner: the tool pressed, the pointer brought to each
 * corner so the line follows it, a click there, and the shape saved by `end`.
 */
async function drawFilm(page, frame, tool, corners, end) {
  const frames = [];
  const hold = (path, count) => frames.push(...Array(count).fill(path));
  hold(await drawn(page, frame), 20);
  await seen(page, `[data-guide="${tool}"]`).click();
  hold(await drawn(page, frame), 12);
  let from = null;
  for (const corner of corners) {
    const to = await onMap(page, SURVEY_VIEW, corner);
    if (from && tool !== 'layer.markers') {
      for (const step of [1, 2, 3]) {
        await page.mouse.move(from.x + ((to.x - from.x) * step) / 3, from.y + ((to.y - from.y) * step) / 3);
        hold(await drawn(page, frame), 2);
      }
    }
    await page.mouse.click(to.x, to.y);
    hold(await drawn(page, frame), 10);
    from = to;
  }
  await page.keyboard.press(end);
  await layerSaved(page);
  hold(await drawn(page, frame), 40);
  return frames;
}


// -- a plate laid out from a place in the Map (the make-a-plate journey) -------------

/**
 * The Copernicus id of the guide's workspace, put away while the plate's grounds are
 * read as a reader starting out has them, Sentinel-2 locked, and put back after.
 */
let copernicusHeld = '';

/** What the journey's comparison is called: the channel on two Wayback releases. */
let pairTitle = '';

/**
 * The survey layer tracked over time, the case's dated sightings in it, as the layer
 * pictures leave it: done here when those pictures were not taken in the same run.
 */
async function surveyTracked(page, demo) {
  const rows = await route(page, 'GET', `/api/cases/${demo.caseId}/map-layers`);
  const row = rows.find((one) => one.title === SURVEY);
  if (!row || row.track?.on) return;
  const at = `/api/cases/${demo.caseId}/map-layers/${encodeURIComponent(row.name)}`;
  await route(page, 'PATCH', `${at}/edit`, { track: { on: true, zone: 'UTC' } });
  const sightings = (await route(page, 'POST', `${at}/groups`, { name: 'Sightings' })).group.id;
  await route(page, 'PATCH', `${at}/groups/${sightings}`, { mode: 'individual', events: true });
  for (const { name, at: day, lat, lon, symbol } of SIGHTINGS) {
    await route(page, 'POST', `${at}/markers`, { name, lat, lon, symbol, colour: '#cc79a7', group: sightings, at: day });
  }
}

/**
 * A comparison of the channel on two Wayback releases, as Compare saves one: the oldest
 * release of 2014 against the newest, which Before and after is laid on.
 */
async function waybackPair(page, demo) {
  const { releases } = await route(page, 'GET', '/api/satellite/wayback/releases');
  const newest = releases[0];
  const older = releases.filter((one) => String(one.date).startsWith('2014')).at(-1) ?? releases.at(-1);
  pairTitle = `Main Channel, ${String(older.date).slice(0, 4)} and ${String(newest.date).slice(0, 4)}`;
  const side = (release) => ({ present: true, provider: 'esri-wayback', overlays: [], wayback_release: release.release });
  await route(page, 'POST', `/api/cases/${demo.caseId}/compare/sessions`, {
    title: pairTitle,
    spec: { version: 2, camera: { ...CHANNEL, zoom: 16, bearing: 0 }, mode: 'swipe', divider: 50, opacity: 50, a: side(older), b: side(newest) },
  });
}

/**
 * Esri's imagery left out of every picture of the plate (photos/CREDITS.md): its tiles,
 * asked one at a time or in a batch (lib/map/tileBatch.js), are asked of the public USGS
 * imagery instead, so a map on World Imagery or Wayback shows a real ground under its
 * frame, its layers and its day, never Esri's pixels. The guide's words say so.
 */
const ESRI_TILES = /\/api\/tiles\/(?:batch\/)?esri/;
const usgsForEsri = (route) =>
  route.continue({ url: route.request().url().replace(/\/api\/tiles\/(batch\/)?esri[^/?]*/, '/api/tiles/$1usgs-imagery') });

/**
 * The Map drawing the case's observations and not the survey, switched by the eyes of
 * its layer panel, the panel put away again: a new plate draws what the Map draws, and
 * the journey ticks the survey on the plate itself.
 */
async function mapDrawsObservations(page) {
  const show = page.locator('[data-guide="sat.panel"] [title="Show the panel"]').filter({ visible: true });
  if (await show.count()) await show.first().click();
  const eye = (title) => page.locator(`[data-guide="sat.panel"] button.eye[aria-label="${title}"]`).filter({ visible: true }).first();
  await eye(SURVEY).waitFor();
  for (const [title, wanted] of [['Channel observations', 'true'], [SURVEY, 'false']]) {
    if ((await eye(title).getAttribute('aria-pressed')) !== wanted) await eye(title).click();
  }
  await seen(page, '[data-guide="sat.panel"] [title="Hide the panel"]').click();
}

/** The year the plate's day bar shows, or 0 on a page with no day. */
async function plateYear(page) {
  const said = await seen(page, '[data-guide="plate.slides"] button.moment').textContent();
  return Number(/\d{4}/.exec(said ?? '')?.[0] ?? 0);
}

/** The plate's day bar stepped by its arrows to the day of `year`, one press at a time; `take` after each press. */
async function plateDayTo(page, year, take = async () => {}) {
  const days = seen(page, '[data-guide="plate.slides"]');
  for (let press = 0; press < 8; press += 1) {
    const shown = await plateYear(page);
    if (shown === year) return;
    const arrow = days.locator(`[aria-label="${shown && shown > year ? 'Previous day' : 'Next day'}"]`);
    if (await arrow.isDisabled()) return;
    await arrow.click();
    await page.waitForTimeout(900);
    await take();
  }
}

/** A press round the paper, which drops what is picked on the plate. */
async function plateUnpicked(page) {
  await page.locator('[data-guide="plate.page"]').click({ position: { x: 16, y: 16 } });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

/** Back to the plates of the case, then New plate and one of its chips. */
async function newPlateAsking(page, chip) {
  const back = page.locator('[data-guide="plate.home"]').filter({ visible: true });
  if (await back.count()) await back.first().click();
  await seen(page, '[data-guide="plate.new"]').click();
  await page.getByRole('dialog', { name: 'New plate' }).waitFor();
  await seen(page, `[data-guide="plate.ask-${chip}"]`).click();
  await page.waitForTimeout(500);
}

/** The key's rows named for what they show, rather than the layers' own group names. */
const KEY_NAMES = [
  [/\(Line of sight\)/, 'Camera and berth'],
  [/\(Landmarks\)/, 'Vincent Thomas Bridge'],
  [/\(Cranes\)/, 'Evergreen cranes'],
  [/^Structures, lines$/, 'Bridge deck'],
  [/^Structures, areas$/, 'Evergreen yard'],
];

/** New plate, as tall as two rows of its layouts. */
const DIALOG = { width: 1280, height: 900 };

/** The legend picked has its rows named for what they show, rather than after the layers' own groups. */
async function legendNamed(page) {
  const rows = page.locator('[data-guide="plate.inspector"] input[aria-label^="Name of "]').filter({ visible: true });
  for (let index = 0; index < (await rows.count()); index += 1) {
    const row = rows.nth(index);
    const said = (await row.getAttribute('aria-label')).replace(/^Name of /, '');
    const name = KEY_NAMES.find(([match]) => match.test(said))?.[1];
    if (!name) continue;
    await row.fill(name);
    await row.press('Tab');
  }
}

/** The page alone, without the editor's line over it or its zoom under it. */
async function pageAlone(page, on) {
  await page.evaluate((on) => {
    document.getElementById('plate-page-alone')?.remove();
    if (!on) return;
    const style = document.createElement('style');
    style.id = 'plate-page-alone';
    style.textContent = '.on-step, [aria-label="Page zoom"], [aria-label="Runs past its box"] { visibility: hidden !important; }';
    document.head.append(style);
  }, on);
}

/** A press on the plate's element of that anchor, then its words written in the inspector. */
async function writeOn(page, anchor, words) {
  await seen(page, `[data-guide="${anchor}"]`).click();
  await seen(page, '[data-guide="plate.text"]').fill(words);
  await page.waitForTimeout(300);
}

/** Every export dialog of the journey, in one window, so they crop alike. */
const EXPORT_WINDOW = { width: 1200, height: 900 };
/** The page alone, as it leaves the app. */
const PAGE_ALONE = { width: 1500, height: 940 };

/** A stage of the plate editor: from the one before, in the plate's window, the whole tool. */
const onPlate = (shot, from, run, more = {}) => ({ shot, from, after: false, window: WIDE, crop: 'full', run, ...more });
/** A stage of New plate: from the one before, cut round the dialog. */
const inDialog = (shot, from, run) => ({ shot, from, after: false, window: DIALOG, clip: '.shell', focus: ['[role="dialog"]'], run });
/** Export pressed: the dialog, its preview drawn. */
async function plateExportOpen({ page }) {
  await seen(page, '[data-guide="plate.export"]').click();
  const dialog = page.getByRole('dialog', { name: 'Export the plate' });
  await dialog.waitFor();
  await dialog.locator('img.preview').waitFor({ timeout: 30_000 });
}
/** The page alone on its day, nothing picked, the editor's lines put away. */
async function pageResult(page) {
  await plateUnpicked(page);
  await pageAlone(page, true);
}

/**
 * One sitting, taken after every other picture (see the foot of this file), each
 * picture taken before the press it explains. The Geolocation card and Before and after
 * each end on their own; the House layout then carries the rest of the journey, on the
 * survey layer tracked over time.
 */
const PLATE_STAGES = [
  {
    // Satellite on the channel, with the rail the journey starts from
    shot: 'plate-go-map',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ go, page, demo }) {
      await go('satellite');
      await stopHeld(page);
      await surveyTracked(page, demo);
      await waybackPair(page, demo);
      const { api_keys: keys } = await route(page, 'GET', '/api/settings');
      copernicusHeld = keys?.sentinelhub ?? '';
      await route(page, 'PUT', '/api/settings/keys', { sentinelhub: '' });
      await page.route(ESRI_TILES, usgsForEsri);
      await go(`satellite?ll=${CHANNEL.lat},${CHANNEL.lon}&z=16&p=usgs-imagery`);
      await mapDrawsObservations(page);
    },
  },
  {
    shot: 'plate-go-compose',
    from: 'plate-go-map',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="rail.compose"]').click();
      await seen(page, '[data-guide="tab.plate"]').waitFor();
    },
  },
  {
    shot: 'plate-go-home',
    from: 'plate-go-compose',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="tab.plate"]').click();
      await seen(page, '[data-guide="plate.new"]').waitFor();
    },
  },
  inDialog('plate-new', 'plate-go-home', async ({ page }) => {
    // the plate read the grounds it offers as it opened: the workspace's id goes back
    await route(page, 'PUT', '/api/settings/keys', { sentinelhub: copernicusHeld });
    await seen(page, '[data-guide="plate.new"]').click();
    await page.getByRole('dialog', { name: 'New plate' }).waitFor();
    await page.waitForTimeout(600);
  }),

  // -- the Geolocation card, to its own end ---------------------------------------------
  inDialog('plate-new-geolocation', 'plate-new', async ({ page }) => {
    await seen(page, '[data-guide="plate.ask-geolocation"]').click();
    await page.waitForTimeout(500);
  }),
  inDialog('plate-new-geo-paper', 'plate-new-geolocation', async ({ page }) => {
    // a report's page, wide, so the card also reads as a landscape picture
    await seen(page, '[data-guide="plate.paper"] button:has-text("Report, A4")').click();
    await page.waitForTimeout(300);
  }),
  onPlate('plate-geo', 'plate-new-geo-paper', async ({ page }) => {
    await seen(page, '[data-guide="plate.create"]').click();
    await seen(page, '[data-guide="plate.picture"]').waitFor({ timeout: 30_000 });
  }, { settle: 6000 }),
  onPlate('plate-geo-picked', 'plate-geo', async ({ page }) => {
    await seen(page, '[data-guide="plate.picture"]').click();
    await seen(page, '[data-guide="plate.from-case"]').waitFor();
  }),
  onPlate('plate-geo-pictures', 'plate-geo-picked', async ({ page }) => {
    await seen(page, '[data-guide="plate.from-case"]').click();
    await seen(page, '[data-guide="plate.case-pictures"] img').waitFor();
    await page.waitForTimeout(800);
  }),
  onPlate('plate-geo-done', 'plate-geo-pictures', async ({ page }) => {
    await seen(page, '[data-guide="plate.case-pictures"] button[title*="bridge_channel"]').click();
    await page.waitForTimeout(600);
    await plateUnpicked(page);
  }, { settle: 3000 }),
  onPlate('plate-geo-add', 'plate-geo-done', async ({ page }) => {
    await seen(page, '[data-guide="plate.add"]').click();
    await seen(page, '[data-guide="plate.add-number"]').waitFor();
  }),
  onPlate('plate-geo-number', 'plate-geo-add', async ({ page }) => {
    await seen(page, '[data-guide="plate.add-number"]').click();
    await page.waitForTimeout(400);
  }),
  onPlate('plate-geo-numbered', 'plate-geo-number', async ({ page }) => {
    // the east tower of the bridge, the feature the photo and the map share
    const map = await seen(page, '[data-guide="plate.map"]').boundingBox();
    await page.mouse.click(map.x + map.width * 0.62, map.y + map.height * 0.12);
    await seen(page, '[data-guide="plate.text"]').waitFor();
  }, { settle: 2000 }),
  onPlate('plate-geo-matched', 'plate-geo-numbered', async ({ page }) => {
    await seen(page, '[data-guide="plate.text"]').fill('Bridge, east tower');
    await page.waitForTimeout(300);
    await plateUnpicked(page);
  }, { settle: 2000 }),
  onPlate('plate-geo-title', 'plate-geo-matched', async ({ page }) => {
    await seen(page, '[data-guide="plate.title"]').click();
    await seen(page, '[data-guide="plate.text"]').waitFor();
  }),
  onPlate('plate-geo-titled', 'plate-geo-title', async ({ page }) => {
    await seen(page, '[data-guide="plate.text"]').fill('A ship under the Vincent Thomas Bridge');
    await page.waitForTimeout(300);
    await plateUnpicked(page);
  }, { settle: 2000 }),
  onPlate('plate-geo-source', 'plate-geo-titled', async ({ page }) => {
    await seen(page, '[data-guide="plate.source-line"]').click();
    await seen(page, '[data-guide="plate.source-text"]').waitFor();
  }),
  onPlate('plate-geo-sourced', 'plate-geo-source', async ({ page }) => {
    await seen(page, '[data-guide="plate.source-text"]').fill('Posted by @harbor_watch · geolocated by {handle}');
    await page.waitForTimeout(300);
    await plateUnpicked(page);
  }, { settle: 3000 }),
  {
    shot: 'plate-geo-export',
    from: 'plate-geo-sourced',
    window: EXPORT_WINDOW,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    run: plateExportOpen,
  },
  {
    // the card alone, as it leaves the app
    shot: 'plate-card-result',
    from: 'plate-geo-export',
    window: PAGE_ALONE,
    clip: '[data-guide="plate.page"] .page',
    crop: 'full',
    settle: 6000,
    async run({ page }) {
      await pageResult(page);
    },
    async after({ page }) {
      await pageAlone(page, false);
    },
  },

  // -- Before and after, to its own end -----------------------------------------------
  inDialog('plate-new-change', 'plate-card-result', async ({ page }) => {
    await newPlateAsking(page, 'change');
    await seen(page, '[data-guide="plate.from-pair"]').waitFor();
  }),
  inDialog('plate-new-paired', 'plate-new-change', async ({ page }) => {
    await seen(page, 'select[aria-label="From a comparison"]').selectOption({ label: pairTitle });
    await page.waitForTimeout(400);
  }),
  inDialog('plate-new-paired-ticked', 'plate-new-paired', async ({ page }) => {
    await seen(page, '[data-guide="plate.map-layer"]').click();
    await page.waitForTimeout(300);
  }),
  onPlate('plate-pair', 'plate-new-paired-ticked', async ({ page }) => {
    await seen(page, '[data-guide="plate.create"]').click();
    await seen(page, '[data-guide="plate.map-before"]').waitFor({ timeout: 30_000 });
  }, { settle: 6000 }),
  onPlate('plate-pair-picked', 'plate-pair', async ({ page }) => {
    await seen(page, '[data-guide="plate.map-before"]').click();
    const that = seen(page, '[data-guide="plate.layers-that-day"]');
    await that.waitFor();
    await that.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  }, { settle: 3000 }),
  onPlate('plate-pair-before-dated', 'plate-pair-picked', async ({ page }) => {
    await seen(page, '[data-guide="plate.layers-that-day"] input').check();
    await page.waitForTimeout(500);
  }, { settle: 3000 }),
  onPlate('plate-pair-after', 'plate-pair-before-dated', async ({ page }) => {
    await seen(page, '[data-guide="plate.map-after"]').click();
    await seen(page, '[data-guide="plate.ground-day"]').waitFor();
  }, { settle: 3000 }),
  onPlate('plate-pair-after-menu', 'plate-pair-after', async ({ page }) => {
    await seen(page, '[data-guide="plate.ground-day"]').click();
    await seen(page, '[data-guide="plate.layers-that-day-menu"]').waitFor();
  }),
  onPlate('plate-pair-dated', 'plate-pair-after-menu', async ({ page }) => {
    await seen(page, '[data-guide="plate.layers-that-day-menu"] input').check();
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await plateUnpicked(page);
  }, { settle: 3000 }),
  onPlate('plate-pair-figure', 'plate-pair-dated', async ({ page }) => {
    await seen(page, '[data-guide="plate.figure"]').click();
    await seen(page, '[data-guide="plate.figure-text"]').waitFor();
  }),
  onPlate('plate-pair-figured', 'plate-pair-figure', async ({ page }) => {
    // the sample figure and its line taken off, as Delete does
    await seen(page, '[data-guide="plate.figure"]').click();
    await page.keyboard.press('Delete');
    await page.locator('[data-guide="plate.page"] [data-element="figure-said"]').click();
    await page.keyboard.press('Delete');
    await plateUnpicked(page);
  }, { settle: 3000 }),
  onPlate('plate-pair-legend', 'plate-pair-figured', async ({ page }) => {
    await seen(page, '[data-guide="plate.legend"]').click();
    const row = seen(page, '[data-guide="plate.legend-name"]');
    await row.waitFor();
    await row.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  }),
  onPlate('plate-pair-legend-named', 'plate-pair-legend', async ({ page }) => {
    await legendNamed(page);
    await seen(page, '[data-guide="plate.handle-w"]').waitFor();
  }, { settle: 2000 }),
  onPlate('plate-pair-widened', 'plate-pair-legend-named', async ({ page }) => {
    // its left handle taken to the left margin, over the foot the figure left free
    const handle = await seen(page, '[data-guide="plate.handle-w"]').boundingBox();
    const before = await seen(page, '[data-guide="plate.map-before"]').boundingBox();
    const [x, y] = [handle.x + handle.width / 2, handle.y + handle.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(before.x, y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const columns = seen(page, '[data-guide="plate.legend-columns"]');
    await columns.waitFor();
    await columns.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  }, { settle: 2000 }),
  onPlate('plate-pair-columns', 'plate-pair-widened', async ({ page }) => {
    await seen(page, '[data-guide="plate.legend-columns"]').fill('4');
    await page.keyboard.press('Tab');
    const fit = seen(page, '[data-guide="plate.fit"]');
    await fit.waitFor();
    await fit.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  }, { settle: 2000 }),
  onPlate('plate-pair-fitted', 'plate-pair-columns', async ({ page }) => {
    await seen(page, '[data-guide="plate.fit"]').click();
    await page.waitForTimeout(400);
    await plateUnpicked(page);
  }, { settle: 3000 }),
  {
    shot: 'plate-pair-export',
    from: 'plate-pair-fitted',
    window: EXPORT_WINDOW,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    run: plateExportOpen,
  },
  {
    // the before and after alone, as it leaves the app
    shot: 'plate-pair-result',
    from: 'plate-pair-export',
    window: PAGE_ALONE,
    clip: '[data-guide="plate.page"] .page',
    crop: 'full',
    settle: 6000,
    async run({ page }) {
      await pageResult(page);
    },
    async after({ page }) {
      await pageAlone(page, false);
    },
  },

  // -- A situation: the House layout, the trunk of the journey -------------------------
  inDialog('plate-new-situation', 'plate-pair-result', async ({ page }) => {
    await newPlateAsking(page, 'situation');
  }),
  inDialog('plate-new-ticked', 'plate-new-situation', async ({ page }) => {
    await seen(page, '[data-guide="plate.map-layer"]').click();
    await page.waitForTimeout(300);
  }),
  onPlate('plate-house', 'plate-new-ticked', async ({ page }) => {
    await seen(page, '[data-guide="plate.create"]').click();
    await seen(page, '[data-guide="plate.map"]').waitFor({ timeout: 30_000 });
  }, { settle: 9000 }),
  onPlate('plate-picked', 'plate-house', async ({ page }) => {
    await seen(page, '[data-guide="plate.map"]').click();
    await seen(page, '[data-guide="plate.frame"]').waitFor();
  }, { settle: 3000 }),
  onPlate('plate-framing', 'plate-picked', async ({ page }) => {
    await seen(page, '[data-guide="plate.frame"]').click();
    await page.waitForTimeout(500);
  }, {
    settle: 2000,
    film: {
      rate: '900k',
      async play({ page, frame }) {
        const frames = [];
        const hold = (path, count) => frames.push(...Array(count).fill(path));
        hold(await drawn(page, frame), 25);
        // the bridge brought down into the frame, the channel kept in its middle
        const map = await seen(page, '[data-guide="plate.framing"]').boundingBox();
        const [x, y] = [map.x + map.width / 2, map.y + map.height / 2];
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (const step of [1, 2, 3, 4, 5, 6]) {
          await page.mouse.move(x, y + (36 * step) / 6);
          hold(await drawn(page, frame), 4);
        }
        await page.mouse.up();
        await page.mouse.move(1, 1);
        hold(await drawn(page, frame), 40);
        return frames;
      },
    },
  }),
  onPlate('plate-moved', 'plate-framing', async ({ page }) => {
    await seen(page, '[data-guide="plate.frame-done"]').waitFor();
  }, { settle: 2000 }),
  onPlate('plate-framed', 'plate-moved', async ({ page }) => {
    await seen(page, '[data-guide="plate.frame-done"]').click();
    await page.waitForTimeout(500);
  }, { settle: 3000 }),
  onPlate('plate-layers-tab', 'plate-framed', async ({ page }) => {
    await seen(page, '[data-guide="plate.layers"]').click();
    await seen(page, '[data-guide="plate.layer-page"]').waitFor();
  }),
  onPlate('plate-days', 'plate-layers-tab', async ({ page }) => {
    await seen(page, '[data-guide="plate.on-page"]').click();
    await page.waitForTimeout(400);
  }, {
    settle: 2000,
    film: {
      rate: '900k',
      async play({ page, frame }) {
        const frames = [];
        const hold = (path, count) => frames.push(...Array(count).fill(path));
        hold(await drawn(page, frame), 30);
        await plateDayTo(page, 2009, async () => hold(await drawn(page, frame), 40));
        hold(await drawn(page, frame), 30);
        return frames;
      },
    },
  }),
  onPlate('plate-day', 'plate-days', async ({ page }) => {
    await plateDayTo(page, 2009);
    await seen(page, '[data-guide="plate.map-stays"]').waitFor();
  }, { settle: 3000 }),
  onPlate('plate-ground', 'plate-day', async ({ page }) => {
    const grounds = seen(page, '[role="radiogroup"][aria-label="Ground"]');
    await grounds.waitFor();
    await grounds.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  }, { settle: 3000 }),
  onPlate('plate-wayback', 'plate-ground', async ({ page }) => {
    await seen(page, '[data-guide="plate.ground-wayback"]').click();
    const release = seen(page, '[data-guide="plate.wayback-release"]');
    await release.waitFor();
    await release.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  }, { settle: 4000 }),
  onPlate('plate-wayback-dated', 'plate-wayback', async ({ page }) => {
    // the release nearest the page's day of 2009: Wayback's first
    const release = seen(page, '[data-guide="plate.wayback-release"]');
    await release.selectOption(await release.locator('option').last().getAttribute('value'));
    await page.waitForTimeout(500);
  }, { settle: 3000 }),
  onPlate('plate-grey', 'plate-wayback-dated', async ({ page }) => {
    const grounds = seen(page, '[role="radiogroup"][aria-label="Ground"]');
    await grounds.evaluate((node) => node.scrollIntoView({ block: 'center' }));
    await seen(page, '[data-guide="plate.ground-grey"]').click();
  }, { settle: 6000 }),
  onPlate('plate-named', 'plate-grey', async ({ page }) => {
    const name = seen(page, '[data-guide="plate.name"]');
    await name.fill('Main Channel, 3 February 2009');
    await name.press('Enter');
    await page.waitForTimeout(400);
  }),
  onPlate('plate-title', 'plate-named', async ({ page }) => {
    await seen(page, '[data-guide="plate.title"]').click();
    await seen(page, '[data-guide="plate.text"]').waitFor();
  }),
  onPlate('plate-titled', 'plate-title', async ({ page }) => {
    await seen(page, '[data-guide="plate.text"]').fill('Ship traffic in the Port of Los Angeles');
    await page.waitForTimeout(300);
    await plateUnpicked(page);
  }, { settle: 2000 }),
  onPlate('plate-legend', 'plate-titled', async ({ page }) => {
    await seen(page, '[data-guide="plate.legend"]').click();
    const row = seen(page, '[data-guide="plate.legend-name"]');
    await row.waitFor();
    await row.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  }),
  onPlate('plate-legend-named', 'plate-legend', async ({ page }) => {
    await legendNamed(page);
    await seen(page, '[data-guide="plate.handle"]').waitFor();
  }, { settle: 2000 }),
  onPlate('plate-legend-fit', 'plate-legend-named', async ({ page }) => {
    // its bottom handle brought up under the last row
    const handle = await seen(page, '[data-guide="plate.handle"]').boundingBox();
    const [x, y] = [handle.x + handle.width / 2, handle.y + handle.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 40, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await plateUnpicked(page);
  }, { settle: 2000 }),
  onPlate('plate-cartouche', 'plate-legend-fit', async ({ page }) => {
    await seen(page, '[data-guide="plate.cartouche"]').click();
    await seen(page, '[data-guide="plate.cartouche-text"]').waitFor();
  }),
  onPlate('plate-sourced', 'plate-cartouche', async ({ page }) => {
    await seen(page, '[data-guide="plate.cartouche-text"]').fill('Source: photo posted by @harbor_watch, 3 February 2009\nMade {today}');
    await page.waitForTimeout(300);
    await plateUnpicked(page);
  }, { settle: 2000 }),
  onPlate('plate-add-label', 'plate-sourced', async ({ page }) => {
    await seen(page, '[data-guide="plate.add"]').click();
    await seen(page, '[data-guide="plate.add-label"]').waitFor();
  }),
  onPlate('plate-mark', 'plate-add-label', async ({ page }) => {
    await seen(page, '[data-guide="plate.add-label"]').click();
    await page.waitForTimeout(400);
    const map = await seen(page, '[data-guide="plate.map"]').boundingBox();
    await page.mouse.move(map.x + map.width / 2, map.y + map.height * 0.4);
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(600);
  }, {
    film: {
      rate: '900k',
      async play({ page, frame }) {
        const frames = [];
        const hold = (path, count) => frames.push(...Array(count).fill(path));
        hold(await drawn(page, frame), 25);
        // the map's middle is the Main Channel, where the Map was looking
        const map = await seen(page, '[data-guide="plate.map"]').boundingBox();
        for (const step of [1, 2, 3, 4]) {
          await page.mouse.move(map.x + map.width * (0.8 - (0.3 * step) / 4), map.y + map.height * (0.75 - (0.25 * step) / 4));
          hold(await drawn(page, frame), 3);
        }
        await page.mouse.click(map.x + map.width / 2, map.y + map.height / 2);
        await page.mouse.move(1, 1);
        hold(await drawn(page, frame), 50);
        return frames;
      },
    },
  }),
  onPlate('plate-label', 'plate-mark', async ({ page }) => {
    await seen(page, '[data-guide="plate.text"]').waitFor();
  }, { settle: 2000 }),
  onPlate('plate-label-typed', 'plate-label', async ({ page }) => {
    await seen(page, '[data-guide="plate.text"]').fill('Main Channel');
    await seen(page, '[data-guide="plate.every-day"]').waitFor();
  }, { settle: 2000 }),
  onPlate('plate-marked', 'plate-label-typed', async ({ page }) => {
    await seen(page, '[data-guide="plate.every-day"]').click();
    await page.waitForTimeout(400);
    await seen(page, 'button[title="Fit the page to the window"]').click();
    await page.waitForTimeout(400);
    await plateUnpicked(page);
  }, { settle: 3000 }),
  {
    shot: 'plate-export',
    from: 'plate-marked',
    window: EXPORT_WINDOW,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    run: plateExportOpen,
  },
  onPlate('plate-slide', 'plate-export', async ({ page }) => {
    await seen(page, '[data-guide="plate.slide-add"]').click();
    await page.waitForTimeout(600);
  }, { settle: 3000 }),
  onPlate('plate-add-arrow', 'plate-slide', async ({ page }) => {
    await seen(page, '[data-guide="plate.add"]').click();
    await seen(page, '[data-guide="plate.add-arrow"]').waitFor();
  }),
  onPlate('plate-arrow', 'plate-add-arrow', async ({ page }) => {
    await seen(page, '[data-guide="plate.add-arrow"]').click();
    await page.waitForTimeout(400);
  }, {
    film: {
      rate: '900k',
      async play({ page, frame }) {
        const frames = [];
        const hold = (path, count) => frames.push(...Array(count).fill(path));
        hold(await drawn(page, frame), 25);
        // from the berth down the channel, the way the ship leaves the port
        const map = await seen(page, '[data-guide="plate.map"]').boundingBox();
        const at = (x, y) => [map.x + map.width * x, map.y + map.height * y];
        await page.mouse.move(...at(0.55, 0.35));
        hold(await drawn(page, frame), 6);
        await page.mouse.down();
        for (const step of [1, 2, 3, 4, 5]) {
          await page.mouse.move(...at(0.55 - (0.17 * step) / 5, 0.35 + (0.4 * step) / 5));
          hold(await drawn(page, frame), 3);
        }
        await page.mouse.up();
        await page.mouse.move(1, 1);
        hold(await drawn(page, frame), 45);
        await plateUnpicked(page);
        return frames;
      },
    },
  }),
  {
    shot: 'plate-export-video',
    from: 'plate-arrow',
    after: false,
    window: EXPORT_WINDOW,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    run: plateExportOpen,
  },
  {
    shot: 'plate-export-mp4',
    from: 'plate-export-video',
    after: false,
    window: EXPORT_WINDOW,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="plate.export-mp4"]').click();
      await page.waitForTimeout(400);
    },
  },
  {
    shot: 'plate-export-held',
    from: 'plate-export-mp4',
    after: false,
    window: EXPORT_WINDOW,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ page }) {
      const hold = seen(page, '[data-guide="plate.export-hold"]');
      await hold.fill('2.5');
      await hold.press('Tab');
      await page.waitForTimeout(300);
    },
  },
  {
    shot: 'plate-export-named',
    from: 'plate-export-held',
    window: EXPORT_WINDOW,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="plate.export-name"]').fill('Main Channel, 2006 to 2020');
      await page.waitForTimeout(300);
    },
  },
  {
    // the page alone, on 3 February 2009, as it leaves the app
    shot: 'plate-result',
    from: 'plate-export-named',
    after: false,
    window: PAGE_ALONE,
    clip: '[data-guide="plate.page"] .page',
    crop: 'full',
    settle: 9000,
    async run({ page }) {
      await seen(page, '[data-guide="plate.slides"] .tile.day:not(.idle)').click();
      await plateDayTo(page, 2009);
      await pageResult(page);
    },
  },
  {
    // the page alone from its first day, played: the video as it runs
    shot: 'plate-video-result',
    from: 'plate-result',
    window: PAGE_ALONE,
    clip: '[data-guide="plate.page"] .page',
    crop: 'full',
    settle: 6000,
    async run({ page }) {
      const back = seen(page, '[data-guide="plate.day-prev"]');
      while (!(await back.isDisabled())) {
        await back.click();
        await page.waitForTimeout(600);
      }
      await pageAlone(page, true);
    },
    film: {
      rate: '1200k',
      async play({ page, frame }) {
        const frames = [];
        const hold = (path, count) => frames.push(...Array(count).fill(path));
        hold(await drawn(page, frame), 20);
        const play = page.locator('[data-guide="plate.slides"] button.play');
        await play.click();
        // frames as fast as they come, each held as long as it took, so the film runs at the plate's pace
        const end = Date.now() + 16_000;
        while (Date.now() < end) {
          const began = Date.now();
          const path = await frame();
          hold(path, Math.max(1, Math.round((Date.now() - began) / 40)));
          if ((await play.getAttribute('aria-label')) === 'Play') break;
        }
        hold(await drawn(page, frame), 30);
        return frames;
      },
    },
    async after({ page }) {
      await pageAlone(page, false);
      await page.unroute(ESRI_TILES, usgsForEsri);
    },
  },
];

export const STAGES = [
  {
    shot: 'start',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    sidebar: true,
    async run({ go }) {
      await go('media');
    },
  },
  {
    shot: 'start-goto',
    from: 'start',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    sidebar: true,
    async run({ page }) {
      await page.keyboard.press('Control+k');
      await page.locator('[data-guide="palette.search"] input').fill('channel');
    },
  },
  {
    shot: 'extension',
    async run({ go, page }) {
      await go('settings');
      await page.locator('.canvas-body button', { hasText: 'Capture extension' }).first().click();
      // the folder is wherever the demo workspace was made: show the default instead
      await page.locator('[data-guide="ext.folder"] .row-hint').evaluate((el) => {
        el.textContent = '~/Azimut/.azimut/extension';
      });
    },
  },
  {
    shot: 'extension-capture',
    browser: 'extension',
    window: LARGE,
    // the panel and the map round it
    clip: 'body',
    crop: 'full',
    settle: 1500,
    async run({ ext }) {
      await ext.fresh();
      await ext.tools();
      await ext.map.mouse.move(1, 1);
      await liftAnchors(ext.map, ['ext.site', 'ext.case', 'ext.capture']);
    },
  },
  {
    shot: 'extension-tools',
    browser: 'extension',
    window: LARGE,
    clip: 'body',
    crop: 'full',
    settle: 2500,
    async run({ ext }) {
      const { map } = ext;
      await ext.fresh();
      await ext.tools();
      await map.locator('[data-guide="ext.measure"]').waitFor();
      // the photo held over the map, then a line from where it was taken to the berth
      await map.locator('[data-guide="ext.refs"]').click();
      await map.locator('[data-act="ref-add"]').click();
      await map.locator('.pick-item[title^="bridge_channel"]').click();
      // the picture is decoded onto the window's canvas once its bytes are in
      await map.locator('[data-guide="ext.ref"] canvas').waitFor();
      await map.waitForTimeout(1500);
      await map.locator('[data-guide="ext.measure"]').click();
      await map.locator('[data-act="measure-distance"]').click();
      for (const point of [CAMERA, TERMINAL]) {
        const { x, y } = ext.at(point);
        await map.mouse.click(x, y);
      }
      await map.mouse.move(1, 1);
      await liftAnchors(map, ['ext.measure', 'ext.points', 'ext.sky', 'ext.grid', 'ext.refs', 'ext.ref', 'ext.fires']);
    },
  },
  {
    shot: 'settings',
    window: GENERAL,
    focus: ['[data-guide="settings.nav"]'],
    async run({ go }) {
      await go('settings');
    },
  },
  ...[
    ['settings-publishing', 'Publishing', 'settings.signature'],
    ['settings-website', 'Website', 'settings.website-hub'],
    ['settings-imagery', 'Imagery', 'settings.eco'],
    ['settings-templates', 'Templates', 'settings.note-templates'],
    ['settings-icons', 'Icons', 'settings.icons-library'],
    ['settings-storage', 'Storage', 'settings.backup'],
    ['settings-system', 'System', 'settings.downloaders'],
  ].map(([shot, section, last]) => ({
    shot,
    from: 'settings',
    window: SETTINGS,
    after: false,
    focus: ['[data-guide="settings.nav"]'],
    async run({ page }) {
      // the demo workspace is a throwaway folder named by the environment: shown as a
      // reader's own installation would be
      if (section === 'Icons') await fileIcons(page);
      if (section === 'Storage') {
        await page.route('**/api/settings/workspace', async (route) => {
          const answer = await (await route.fetch()).json();
          await route.fulfill({ json: { ...answer, environment: false, root: '~/Azimut' } }).catch(() => {});
        });
      }
      await page.locator('[data-guide="settings.nav"] button', { hasText: section }).first().click();
      await seen(page, `[data-guide="${last}"]`).waitFor();
      if (section === 'Storage') {
        await page.waitForTimeout(500);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
      }
    },
  })),
  // Settings, Website: each panel of a site set up and read, its answers made up on the page
  ...['identity', 'hosting', 'articles', 'categories', 'readers', 'upkeep', 'yours'].map((tab) => ({
    shot: `settings-website-${tab}`,
    window: SETTINGS,
    crop: 'full',
    async run({ go, page }) {
      await siteHub(go, page, tab);
    },
  })),
  {
    shot: 'media',
    crop: 'full',
    async run({ go }) {
      await go('media');
    },
  },
  {
    shot: 'media-open-in',
    from: 'media',
    focus: ['[data-guide="media.open-in-menu"]', '[title="Open in…"][aria-expanded="true"]'],
    async run({ page }) {
      await card(page, 'bridge_channel').locator('[title="Open in…"]').click();
    },
  },
  {
    shot: 'media-viewer',
    from: 'media',
    // the viewer covers everything under the top bar
    clip: 'body',
    crop: 'full',
    async run({ page }) {
      await card(page, 'bridge_channel').locator('.thumb').click();
      await seen(page, '[data-guide="media.viewer"] img').waitFor();
    },
  },
  {
    // the Horizon aside's photo, Half Dome in 1901, open in the viewer
    shot: 'media-viewer-halfdome',
    from: 'media',
    clip: 'body',
    crop: 'full',
    async run({ page }) {
      await card(page, 'half_dome_1901').locator('.thumb').click();
      await seen(page, '[data-guide="media.viewer"] img').waitFor();
    },
  },
  {
    shot: 'files',
    async run({ go, page }) {
      await go('files');
      await page.locator('[data-guide="files.tree"] .trow', { hasText: 'Sources' }).first().click();
      await page.locator('.grid-pane .tile.folder', { hasText: 'harbor_watch' }).first().dblclick();
    },
  },
  {
    shot: 'files-menu',
    from: 'files',
    focus: ['[data-guide="files.menu"]'],
    async run({ page }) {
      await seen(page, '[data-guide="files.tile"]').click({ button: 'right' });
    },
  },
  {
    shot: 'reverse',
    async run({ go, page }) {
      await go('reverse');
      await page.locator('.canvas-body').getByText('bridge_channel', { exact: true }).first().click();
    },
  },
  {
    shot: 'inspect',
    window: WIDE,
    async run({ go, page }) {
      // the video's own picture first, then the frames cut from it, then their save, and
      // the passage the ship leaves by marked as a scene to geolocate
      await clipScenes(go, page);
      await seen(page, '[data-guide="inspect.save"]').waitFor({ timeout: 60_000 });
    },
  },
  {
    shot: 'inspect-adjust',
    from: 'inspect',
    window: WIDE,
    async run({ page }) {
      await seen(page, '[data-guide="inspect.tabs"]').locator('button', { hasText: 'Adjust' }).click();
    },
  },
  {
    shot: 'inspect-analyze',
    window: WIDE,
    crop: 'full',
    async run({ go, page }) {
      await go('inspect');
      // the photo itself, a JPEG, where error levels mean something
      await page.locator('.canvas-body').getByText('bridge_channel', { exact: true }).first().click();
      await seen(page, '[data-guide="inspect.tabs"]').locator('button', { hasText: 'Analyze' }).click();
      await seen(page, '[data-guide="inspect.analyze"] .runs button').click();
      await seen(page, '[data-guide="inspect.analyze"] input[type="checkbox"]').waitFor({ timeout: 60_000 });
      // laid at half strength, so the photo reads under the patches that light up
      await seen(page, '[data-guide="inspect.analyze"] input[type="range"]').evaluate((range) => {
        range.value = '0.55';
        range.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
  },
  {
    shot: 'collage',
    window: WIDE,
    async run({ go, page }) {
      await go('collage');
      await page.locator('.canvas-body').getByText('The bridge from both banks', { exact: true }).first().click();
    },
  },
  {
    shot: 'collage-straighten',
    from: 'collage',
    window: WIDE,
    focus: ['[data-guide="collage.straighten"]'],
    async run({ page }) {
      await page.locator('[data-guide="collage.straighten"] button', { hasText: 'Draw the line' }).click();
      // along the bridge deck of the first photo, which is level
      const piece = await seen(page, '.canvas-body img.node').boundingBox();
      for (const [x, y] of [[0.06, 0.352], [0.3, 0.348], [0.55, 0.352], [0.8, 0.358], [0.97, 0.362]]) {
        await page.mouse.click(piece.x + piece.width * x, piece.y + piece.height * y);
      }
    },
  },
  {
    // the clip picked under Videos, playing in the rail under the canvas, A and B set
    // round the stretch Panorama would stitch
    shot: 'collage-rail',
    window: WIDE,
    crop: 'full',
    async run({ go, page }) {
      await go('collage');
      await page.locator('.canvas-body').getByText('The bridge from both banks', { exact: true }).first().click();
      await seen(page, '[data-guide="collage.add"]').getByText('channel_departure', { exact: true }).first().click();
      const rail = seen(page, '[data-guide="collage.rail"]');
      const video = rail.locator('video').first();
      await video.waitFor();
      await page.waitForFunction(() => document.querySelector('[data-guide="collage.rail"] video')?.readyState >= 2);
      for (const [at, end] of [[0.4, 'A'], [5.2, 'B']]) {
        await video.evaluate(
          (el, time) =>
            new Promise((done) => {
              el.addEventListener('seeked', done, { once: true });
              el.currentTime = time;
            }),
          at
        );
        await page.waitForTimeout(400);
        await rail.locator('button.ab', { hasText: end }).first().click();
      }
      await page.mouse.move(1, 1);
    },
  },
  {
    shot: 'satellite',
    window: WIDE,
    map: true,
    async run({ go, page }) {
      await go(`satellite?${CHANNEL_VIEW}&p=usgs-imagery`);
      const row = page.locator('[data-guide="sat.panel"] .row, [data-guide="sat.panel"] li, [data-guide="sat.panel"] div', { hasText: 'Channel observations' }).last();
      await row.locator('button').first().click();
      // folded, so the map has the room; its number opens it
      await seen(page, '[data-guide="sat.panel"] [title="Hide the panel"]').click();
    },
  },
  {
    shot: 'satellite-menu',
    from: 'satellite',
    window: WIDE,
    map: true,
    focus: ['[data-guide="map.menu"]'],
    async run({ page }) {
      const box = await page.locator('[data-guide="map.ground"]').filter({ visible: true }).first().boundingBox();
      // low enough under the search bar for the whole menu to open below the click
      await page.mouse.click(box.x + box.width * 0.4, box.y + 150, { button: 'right' });
    },
  },
  {
    shot: 'satellite-capture',
    from: 'satellite',
    window: WIDE,
    map: true,
    focus: ['[data-guide="sat.capture-menu"]', '[data-guide="sat.capture"]'],
    async run({ page }) {
      await seen(page, '[data-guide="sat.capture"]').locator('button').last().click();
    },
  },
  {
    shot: 'satellite-refs',
    from: 'satellite',
    window: WIDE,
    map: true,
    focus: ['[data-guide="map.ref"]'],
    async run({ page }) {
      await seen(page, '[data-guide="sat.tools"] [aria-label="Add reference"]').click();
      await seen(page, '.ref-pick[title^="bridge_channel"]').click();
      await seen(page, '[data-guide="map.ref"] img').waitFor();
    },
    // the window would sit over the pictures taken after this one
    async after({ page }) {
      await seen(page, '[data-guide="map.ref"] [title="Close"]').click();
    },
  },
  {
    shot: 'satellite-layers',
    from: 'satellite',
    window: WIDE,
    map: true,
    async run({ page }) {
      await seen(page, '[data-guide="sat.panel"] [title="Show the panel"]').click();
    },
  },
  {
    shot: 'satellite-mylayer',
    from: 'satellite',
    window: WIDE,
    map: true,
    after: false,
    focus: ['[data-guide="sat.panel"]'],
    async run({ page }) {
      const show = page.locator('[data-guide="sat.panel"] [title="Show the panel"]').filter({ visible: true });
      if (await show.count()) await show.first().click();
      const row = page.locator('[data-guide="sat.mylayers"] .row, [data-guide="sat.mylayers"] li, [data-guide="sat.mylayers"] div', { hasText: 'Channel survey' }).last();
      await row.locator('[title="Edit this layer"]').click();
      await seen(page, '[data-guide="layer.tools"]').waitFor();
      await page.waitForFunction(() => !document.querySelector('[data-guide="layer.panel"] .note')?.textContent?.includes('Opening'));
    },
  },
  {
    shot: 'satellite-measure',
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ go, page }) {
      // the layer left open by the picture before is put down first
      const done = page.locator('[data-guide="layer.panel"] .done').filter({ visible: true });
      if (await done.count()) await done.first().click();
      await go(`satellite?ll=${SIGHT.lat},${SIGHT.lon}&z=${SIGHT.zoom}&p=usgs-imagery`);
      const hide = page.locator('[data-guide="sat.panel"] [title="Hide the panel"]').filter({ visible: true });
      if (await hide.count()) await hide.first().click();
      await page.waitForTimeout(1500);
      await seen(page, '[data-guide="map.measure-tool"]').click();
      // from where the photo was taken to the berth it looks at, then what the lens took in
      const from = await onMap(page, SIGHT, CAMERA);
      const to = await onMap(page, SIGHT, TERMINAL);
      // a pin stands over its point, so a click just under its tip lands on the ground:
      // the photo's mark sits at the camera and an observation of the layer at the berth
      await page.mouse.click(from.x, from.y + 8);
      await page.mouse.dblclick(to.x, to.y + 8);
      await page.locator('[data-guide="map.measure"] button', { hasText: 'Cone' }).click();
      // the photo was taken with a long lens
      const opening = page.locator('[data-guide="map.measure"] input[type="number"]').first();
      await opening.fill('30');
      await opening.press('Enter');
    },
  },
  {
    // Align: the bridge's east tower, then the Evergreen cranes it stands right behind in
    // the photo, the line run on past the cranes to the west bank, loosened by 2°
    shot: 'satellite-align',
    window: LARGE,
    map: true,
    crop: 'full',
    async run({ go, page }) {
      // the camera's spot clear of the panel, the tower clear of the compass
      const view = { lat: 33.745, lon: -118.2765, zoom: 16 };
      await go(`satellite?ll=${view.lat},${view.lon}&z=${view.zoom}&p=usgs-imagery`);
      const hide = page.locator('[data-guide="sat.panel"] [title="Hide the panel"]').filter({ visible: true });
      if (await hide.count()) await hide.first().click();
      await page.waitForTimeout(1500);
      await seen(page, '[data-guide="map.align-tool"]').click();
      const tower = await onMap(page, view, EAST_TOWER);
      const cranes = await onMap(page, view, TERMINAL);
      await page.mouse.click(tower.x, tower.y);
      await page.waitForTimeout(600);
      await page.mouse.click(cranes.x, cranes.y);
      await page.mouse.move(1, 1);
      const panel = seen(page, '[data-guide="map.align"]');
      // the camera stands on the side of the nearer thing, past the cranes
      await panel.getByRole('button', { name: 'Past B' }).click();
      await panel.locator('input[type="range"]').evaluate((range) => {
        range.value = '2';
        range.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
  },
  {
    // Sun and moon over the channel, before Read a shadow is pressed
    shot: 'satellite-sun',
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ go, page }) {
      await go(`satellite?${CHANNEL_VIEW}&p=usgs-imagery`);
      const hide = page.locator('[data-guide="sat.panel"] [title="Hide the panel"]').filter({ visible: true });
      if (await hide.count()) await hide.first().click();
      await page.waitForTimeout(1500);
      await seen(page, '[data-guide="map.sky-tool"]').click();
      await seen(page, '[data-guide="map.shadow"]').waitFor();
      await page.waitForFunction(() => {
        const range = document.querySelector('[data-guide="map.sky"] input[type="range"]');
        return range && !range.disabled && Number(range.max) > 0;
      });
      // mid-morning, so the sun stands up whatever hour the picture is taken at
      await seen(page, '[data-guide="map.sky"] input[type="range"]').evaluate((range) => {
        range.value = String(Math.round(Number(range.max) * 0.42));
        range.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.mouse.move(1, 1);
    },
  },
  {
    // Grid Search over the terminal east of the channel: a box of 100 m cells, the first
    // row swept clear and one cell flagged, the way a sweep looks once begun
    shot: 'satellite-grid',
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ go, page }) {
      await go(`satellite?${CHANNEL_VIEW}&p=usgs-imagery`);
      const hide = page.locator('[data-guide="sat.panel"] [title="Hide the panel"]').filter({ visible: true });
      if (await hide.count()) await hide.first().click();
      await page.waitForTimeout(1500);
      await seen(page, '[data-guide="map.grid-tool"]').click();
      const panel = seen(page, '[data-guide="map.grid"]');
      const cell = panel.locator('input[type="number"]');
      await cell.fill('100');
      await cell.press('Enter');
      await panel.getByRole('button', { name: 'Box' }).click();
      const map = await page.locator('[data-guide="map.ground"]').filter({ visible: true }).first().boundingBox();
      const at = (x, y) => ({ x: map.x + map.width * x, y: map.y + map.height * y });
      const [from, to] = [at(0.56, 0.22), at(0.9, 0.82)];
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
      await page.mouse.move(to.x, to.y, { steps: 6 });
      await page.mouse.up();
      await seen(page, '[data-guide="map.grid"] .grid-cov').waitFor();
      await page.waitForTimeout(800);
      // a click clears a cell, a right click flags one
      const step = (to.x - from.x) / 6;
      for (let k = 0; k < 4; k += 1) await page.mouse.click(from.x + step * (k + 0.5), from.y + step * 0.5);
      await page.mouse.click(from.x + step * 1.5, from.y + step * 1.5, { button: 'right' });
      await page.mouse.move(1, 1);
      await page.waitForTimeout(600);
    },
    // the grid stays in the demo case, where only this panel's Saved grids would list it
  },
  {
    shot: 'compare',
    window: WIDE,
    map: true,
    async run({ go, page }) {
      await go(`compare?${CHANNEL_VIEW}`);
      await page.locator('.canvas-body button', { hasText: 'Open' }).filter({ visible: true }).first().click();
      await page.getByText('Main Channel, imagery against the map').filter({ visible: true }).first().click();
      // the empty comparison it opened on counts as unsaved work
      const discard = page.getByRole('button', { name: 'Discard changes' });
      if (await discard.isVisible().catch(() => false)) await discard.click();
    },
  },
  {
    shot: 'compare-new',
    from: 'compare',
    window: WIDE,
    map: true,
    focus: ['[data-guide="compare.new-menu"]'],
    async run({ page }) {
      await seen(page, '[data-guide="compare.new"]').click();
    },
  },
  {
    shot: 'detect',
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ go, page }) {
      await go(`detect?${CHANNEL_VIEW}`);
      await pickImagery(page, 'USGS Imagery').catch(() => {});
      await seen(page, '[data-guide="detect.tabs"] [aria-label="Areas"]').click();
      await seen(page, '[data-guide="detect.area"]').waitFor();
    },
  },
  {
    shot: 'detect-new',
    from: 'detect',
    window: WIDE,
    map: true,
    focus: ['[data-guide="detect.new-menu"]'],
    async run({ page }) {
      await seen(page, '[data-guide="detect.new"]').locator('button').first().click();
    },
  },
  // The analyzer journey is one story at one place: aircraft on the apron of Al Udeid
  // Air Base, the Detect film's ground, made in one sitting with the clicks an analyst
  // makes. Every picture has the same window and the same ground, from the button that
  // opens the library to the analyzer filed in it.
  {
    shot: 'detect-library',
    window: FILM,
    map: true,
    crop: 'full',
    after: false,
    async run({ go, page }) {
      // Detect opens where the map tabs last looked, a camera the window keeps, so the
      // Satellite tab looks there first and Detect is opened from its tab; the public
      // imagery has no aerial photographs at the airbase, so the map is OpenStreetMap
      // until a pass is drawn on it
      await go(`satellite?${AIRBASE_VIEW}`);
      await page.locator('[data-map-ready="true"]').filter({ visible: true }).first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      await page.locator('.tabstrip').getByRole('button', { name: 'Detect', exact: true }).click();
      await pickImagery(page, 'OpenStreetMap').catch(() => {});
      await seen(page, '[data-guide="detect.analyzers"]').click();
      await seen(page, '[data-guide="detect.library"]').waitFor();
    },
  },
  {
    shot: 'detect-analyzer-new',
    from: 'detect-library',
    window: FILM,
    map: true,
    crop: 'full',
    after: false,
    async run({ page }) {
      await seen(page, '[data-guide="detect.library-new"]').click();
      await page.locator('[data-guide="detect.reads"] button', { hasText: 'Two dates' }).filter({ visible: true }).first().click();
    },
  },
  {
    // Sentinel-1 picked: radar, its lock said while the Copernicus setup lacks its layer;
    // put back to Sentinel-2 and two dates after, for the analyzer the journey builds
    shot: 'detect-analyzer-radar',
    from: 'detect-analyzer-new',
    window: FILM,
    map: true,
    crop: 'full',
    async run({ page }) {
      await page.locator('[data-guide="detect.reads"] button', { hasText: 'Sentinel-1 · radar' }).filter({ visible: true }).first().click();
      await page.waitForTimeout(400);
    },
    async after({ page }) {
      await page.locator('[data-guide="detect.reads"] button', { hasText: 'Sentinel-2 · optical' }).filter({ visible: true }).first().click();
      await page.locator('[data-guide="detect.reads"] button', { hasText: 'Two dates' }).filter({ visible: true }).first().click();
    },
  },
  {
    shot: 'detect-first-rule',
    from: 'detect-analyzer-new',
    window: FILM,
    map: true,
    crop: 'full',
    after: false,
    async run({ page }) {
      // from a blank rule, named and set as AVIATION's one rule: brightness dropped by 7% or more
      await seen(page, '[data-guide="detect.start-from"] button.own').click();
      await seen(page, 'input[aria-label="Analyzer name"]').fill('AVIATION');
      await seen(page, 'select[aria-label="Rule 1 measures"]').selectOption('brightness');
      const reads = page.locator('[aria-label="Rule 1 reads"] button', { hasText: 'Change' }).filter({ visible: true });
      if (await reads.count()) await reads.first().click();
      await page.locator('[aria-label="Rule 1 comparison"] button', { hasText: 'Dropped' }).filter({ visible: true }).first().click();
      await seen(page, 'input[aria-label="Rule 1 value"]').fill('7');
      await page.keyboard.press('Tab');
      await page.evaluate(() => document.activeElement?.blur?.());
    },
  },
  {
    // Checks, New check: the passes looked up, one picked Before and a later one After
    shot: 'detect-passes',
    from: 'detect-first-rule',
    window: FILM,
    map: true,
    crop: 'full',
    settle: 4000,
    after: false,
    async run({ page, passes }) {
      // read for real only when the run was started to (GUIDE_DETECT_ONLINE), on an account that agreed to spend
      if (!passes && process.env.GUIDE_DETECT_ONLINE !== '1') {
        throw new Error('the airbase passes are not cached (airbase.mjs): reading them would spend Copernicus quota');
      }
      // The run's stand-in Copernicus id can ask the catalogue nothing, so the two
      // questions a new check asks are answered from what the cache holds: the passes
      // over the airbase, the two the film read (the catalogue's cloud figure was not
      // kept, so none is said), and the layers its account served, colour infrared
      // among them. The passes themselves come from the cached tiles.
      await page.route('**/api/satellite/sentinel/acquisitions', async (route) => {
        const dates = [...PASSES].reverse().map((date) => ({ date, cloud: null, granules: 1, coverage: 1 }));
        await route.fulfill({ json: { dates, truncated: false } }).catch(() => {});
      });
      await page.route('**/api/satellite/sentinel/layers?check=true', async (route) => {
        const plain = route.request().url().replace('?check=true', '');
        const answer = await (await route.fetch({ url: plain })).json();
        const layers = [...answer.layers, { id: 'COLOR_INFRARED', label: 'Color infrared', hint: 'Near infrared (B08) shown red.' }];
        await route.fulfill({ json: { ...answer, layers, source: 'instance' } }).catch(() => {});
      });
      await seen(page, '[data-guide="detect.checks"]').click();
      await page.locator('.builder button', { hasText: 'New check' }).filter({ visible: true }).first().click();
      const drawer = page.locator('section[aria-label="Passes of the new check"]');
      await drawer.locator('button', { hasText: /Find passes|Look again/ }).first().click();
      await drawer.locator(`[aria-label="Use ${PASSES[0]}"] button`, { hasText: 'Before' }).click();
      await drawer.locator(`[aria-label="Use ${PASSES[1]}"] button`, { hasText: 'After' }).click();
    },
  },
  {
    // Place the pins pressed, Should be found armed; the film drops the aircraft's pins,
    // then the empty ones on bare apron and look-alikes
    shot: 'detect-pinning',
    from: 'detect-passes',
    window: FILM,
    map: true,
    crop: 'full',
    settle: 5000,
    after: false,
    async run({ page }) {
      await page.locator('section[aria-label="Passes of the new check"] button', { hasText: 'Place the pins' }).click();
      await seen(page, 'input[aria-label="Name of the new check"]').fill('Apron check');
      await page.evaluate(() => document.activeElement?.blur?.());
      const found = seen(page, '[data-guide="detect.pin-found"]');
      if ((await found.getAttribute('aria-pressed')) !== 'true') await found.click();
      await page.mouse.move(1, 1);
    },
    film: {
      rate: '700k',
      async play({ page, frame }) {
        const { frames, take } = filmFrames(frame);
        await take(20);
        await dropCheckPins(page, take);
        await take(30);
        return frames;
      },
    },
  },
  {
    // the pins dropped and the check finished: its pins listed, the map split between its passes
    shot: 'detect-check',
    from: 'detect-pinning',
    window: FILM,
    map: true,
    crop: 'full',
    settle: 6000,
    after: false,
    async run({ page }) {
      // the film dropped them; taken alone, they are dropped here
      const count = await page.locator('[aria-label="Pin to drop on the map"] .count').textContent();
      if (!Number.parseInt(count ?? '0', 10)) await dropCheckPins(page);
      await page.locator('[data-guide="detect.bench"] button', { hasText: 'Finish' }).click();
      await seen(page, '[data-guide="detect.pins"]').waitFor();
      // put on the map again, the map frames the check's pins, as a reader opening it would
      const put = page.getByRole('button', { name: 'Put the check Apron check on the map' }).filter({ visible: true }).first();
      if ((await put.getAttribute('aria-pressed')) === 'true') await put.click();
      await put.click();
      await page.locator('[data-guide="detect.bench"] button', { hasText: 'Split' }).first().click();
    },
  },
  {
    shot: 'detect-builder',
    from: 'detect-check',
    window: FILM,
    map: true,
    crop: 'full',
    settle: 5000,
    after: false,
    async run({ page }) {
      // the film's second rule: near infrared dropping against the ground round it
      await page.locator('.builder [role="tab"]', { hasText: 'Rules' }).filter({ visible: true }).first().click();
      await page.locator('.builder button', { hasText: 'Add a rule' }).filter({ visible: true }).first().click();
      await seen(page, 'select[aria-label="Rule 2 measures"]').selectOption('band');
      await seen(page, 'select[aria-label="Rule 2 band"]').selectOption('B08');
      await page.locator('[aria-label="Rule 2 reads"] button', { hasText: 'Change' }).filter({ visible: true }).first().click();
      await page.locator('[aria-label="Rule 2 comparison"] button', { hasText: 'Dropped' }).filter({ visible: true }).first().click();
      await seen(page, 'input[aria-label="Rule 2 value"]').fill('5');
      await page.keyboard.press('Tab');
      await page.getByRole('checkbox', { name: 'Against the ground around it' }).nth(1).check();
      await page.evaluate(() => document.activeElement?.blur?.());
      // the panel back up to its tabs, the second rule's sentence still in view under them
      await seen(page, '[data-guide="detect.checks"]').evaluate((tab) => tab.scrollIntoView({ block: 'start' }));
      await seen(page, '[data-guide="detect.rules"]').waitFor();
    },
  },
  {
    shot: 'detect-seeit',
    from: 'detect-builder',
    window: FILM,
    map: true,
    crop: 'full',
    settle: 8000,
    after: false,
    async run({ page }) {
      // both passes in colour infrared, where the second rule's band shows red
      await seen(page, '[data-guide="detect.display"] button.select').click();
      await page.getByRole('menuitemradio', { name: /Color infrared/ }).filter({ visible: true }).first().click();
      await page.waitForFunction(
        () => document.querySelector('[data-guide="detect.display"]')?.textContent?.includes('Color infrared'),
        null,
        { timeout: 60_000 }
      );
    },
  },
  {
    shot: 'detect-tested',
    from: 'detect-seeit',
    window: FILM,
    map: true,
    crop: 'full',
    settle: 5000,
    after: false,
    async run({ page }) {
      // back on the passes in true colour, the second rule shown before taken out again:
      // AVIATION holds one rule, and the check is read through it
      await seen(page, '[data-guide="detect.display"] button.select').click();
      await page.getByRole('menuitemradio', { name: /True colour/ }).filter({ visible: true }).first().click();
      await page.locator('.builder [role="tab"]', { hasText: 'Rules' }).filter({ visible: true }).first().click();
      const second = page.getByRole('button', { name: 'Remove rule 2' }).filter({ visible: true });
      if (await second.count()) await second.first().click();
      await seen(page, '[data-guide="detect.test"]').click();
      await page.waitForFunction(
        () => /found/.test(document.querySelector('[data-guide="detect.verdict"]')?.textContent ?? ''),
        null,
        { timeout: 120_000 }
      );
    },
  },
  {
    shot: 'detect-mine',
    from: 'detect-tested',
    window: FILM,
    map: true,
    focus: ['[data-guide="detect.tabs"]', 'section[aria-label="My analyzers"]', '[data-guide="detect.library"]'],
    async run({ page }) {
      await seen(page, '[data-guide="detect.builder-save"]').click();
      await seen(page, 'section[aria-label="My analyzers"] .entry').waitFor();
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      // the check left the map: the base map the public imagery does not cover is
      // drawn from OpenStreetMap instead
      await pickImagery(page, 'OpenStreetMap').catch(() => {});
    },
  },
  // One pass of the saved analyzer over the apron, run for real: on the owner's account in
  // the run that reads it first (GUIDE_DETECT_ONLINE), from the guide's cache after, with
  // local images only, so no later run spends anything
  {
    // New detection pressed over the apron: One pass and Routine
    shot: 'detect-mine-menu',
    from: 'detect-mine',
    window: FILM,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="detect.new"]').locator('button').first().click();
      await seen(page, '[data-guide="detect.new-menu"]').waitFor();
    },
  },
  {
    // New detection, One pass: the four Al Udeid areas the case saved, ticked
    shot: 'detect-once-where',
    from: 'detect-mine',
    window: FILM,
    map: true,
    crop: 'full',
    settle: 3000,
    after: false,
    async run({ go, page, demo }) {
      await newDetection(go, page, demo, 'One pass');
      await airbaseAreas(page);
    },
  },
  {
    // What: the analyzer just saved, under Mine
    shot: 'detect-once-what',
    from: 'detect-once-where',
    window: FILM,
    map: true,
    crop: 'full',
    after: false,
    async run({ page }) {
      await page.getByRole('button', { name: /^Next: What/ }).filter({ visible: true }).first().click();
      const mine = page.getByRole('radio', { name: /AVIATION/ }).filter({ visible: true });
      if (!(await mine.count())) {
        await page.locator('button.fold', { has: page.locator('.label', { hasText: /^Mine$/ }) }).filter({ visible: true }).first().click();
      }
      await page.getByRole('radio', { name: /AVIATION/ }).filter({ visible: true }).first().click();
      await page.waitForTimeout(400);
    },
  },
  {
    // When: the check's two passes as A and B
    shot: 'detect-once-when',
    from: 'detect-once-what',
    window: FILM,
    map: true,
    crop: 'full',
    after: false,
    async run({ page }) {
      await page.getByRole('button', { name: /^Next: When/ }).filter({ visible: true }).first().click();
      await areaDates(page, { a: REFERENCE, b: PASSES[1] });
      const local = page.getByRole('checkbox', { name: 'Use local images only' });
      const online = process.env.GUIDE_DETECT_ONLINE === '1';
      if ((await local.count()) && (await local.first().isChecked()) === online) {
        await page.locator('details', { hasText: 'Picture and local images' }).locator('summary').first().click();
        await local.first().setChecked(!online);
      }
      await page.mouse.move(1, 1);
    },
  },
  {
    // Start: the run named, Where, What and When read back, Run this pass next
    shot: 'detect-once-start',
    from: 'detect-once-when',
    window: FILM,
    map: true,
    crop: 'full',
    after: false,
    async run({ page }) {
      await page.getByRole('button', { name: /^Next: Start/ }).filter({ visible: true }).first().click();
      await page.getByRole('textbox', { name: 'Detection name' }).fill('Al Udeid, July to September');
      await page.evaluate(() => document.activeElement?.blur?.());
    },
  },
  {
    // the pass run: what it found, kept for review on the map
    shot: 'detect-once-done',
    from: 'detect-once-start',
    window: FILM,
    map: true,
    crop: 'full',
    settle: 8000,
    after: false,
    async run({ page }) {
      await page.getByRole('button', { name: 'Run this pass' }).filter({ visible: true }).first().click();
      // ready shows what it did with the run (Export as layer); a failure says so in its line
      await seen(page, '[data-guide="detect.run"]').waitFor({ timeout: 60_000 });
      await page.waitForFunction(
        () => document.querySelector('[data-guide="detect.run"] .run-acts') || /fail|error|stopped/i.test(document.querySelector('[data-guide="detect.run"] .hint')?.textContent ?? ''),
        null,
        { timeout: 900_000 }
      );
      const failed = await page.locator('[data-guide="detect.run"] .run-acts').count() === 0;
      if (failed) throw new Error(`the pass did not run: ${await page.locator('[data-guide="detect.run"]').innerText()}`);
    },
  },
  // The case's routine over the same four areas: the wizard as it is filled in, then the
  // routine itself as the owner's case keeps it (airbase.mjs `copyRoutine`), its runs and
  // its dashboard shown as they are rather than read again
  {
    shot: 'detect-routine-where',
    window: FILM,
    map: true,
    crop: 'full',
    after: false,
    async run({ go, page, demo }) {
      await newDetection(go, page, demo, 'Routine');
      await airbaseAreas(page);
    },
  },
  {
    shot: 'detect-routine-what',
    from: 'detect-routine-where',
    window: FILM,
    map: true,
    crop: 'full',
    after: false,
    async run({ page }) {
      await page.getByRole('button', { name: /^Next: What/ }).filter({ visible: true }).first().click();
      const mine = page.getByRole('radio', { name: /AVIATION/ }).filter({ visible: true });
      if (!(await mine.count())) {
        await page.locator('button.fold', { has: page.locator('.label', { hasText: /^Mine$/ }) }).filter({ visible: true }).first().click();
      }
      await page.getByRole('radio', { name: /AVIATION/ }).filter({ visible: true }).first().click();
      // the routine's cloud ceiling, as the case set it
      await seen(page, 'input[aria-label="Maximum cloud cover"]').evaluate((input, value) => {
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, MAX_CLOUD);
    },
  },
  {
    // When: each pass compared with a fixed picture, the July reference
    shot: 'detect-routine-when',
    from: 'detect-routine-what',
    window: FILM,
    map: true,
    crop: 'full',
    after: false,
    async run({ page }) {
      await page.getByRole('button', { name: /^Next: When/ }).filter({ visible: true }).first().click();
      await page.getByRole('radio', { name: /A fixed picture/ }).filter({ visible: true }).first().click();
      await areaDates(page, { a: REFERENCE });
    },
  },
  {
    shot: 'detect-routine-start',
    from: 'detect-routine-when',
    window: FILM,
    map: true,
    crop: 'full',
    after: false,
    async run({ page }) {
      await page.getByRole('button', { name: /^Next: Start/ }).filter({ visible: true }).first().click();
      await page.getByRole('textbox', { name: 'Detection name' }).fill('Al Udeid Air Base Routine');
      await page.evaluate(() => document.activeElement?.blur?.());
    },
  },
  {
    // the routine's own panel, Run routine and Catch up: the case's routine, its runs read
    shot: 'detect-routine-saved',
    from: 'detect-routine-start',
    window: FILM,
    map: true,
    crop: 'full',
    after: false,
    settle: 5000,
    async run({ page }) {
      await openRoutine(page);
    },
  },
  {
    // Catch up: the passes since the July reference, the ones the routine read ticked as read
    shot: 'detect-routine-catchup',
    from: 'detect-routine-saved',
    window: FILM,
    map: true,
    crop: 'full',
    after: false,
    // the catalogue asked for real, one request: the passes since July with their cloud
    online: true,
    async run({ page }) {
      await seen(page, '[data-guide="detect.catch-up"]').click();
      await page.getByRole('button', { name: /Look for passes/ }).filter({ visible: true }).first().click();
      await page.locator('.catch .pass').first().waitFor({ timeout: 60_000 });
      await seen(page, '[data-guide="detect.catch-read"]').scrollIntoViewIfNeeded();
    },
  },
  {
    // back on the routine: its passes in bars, candidates per pass
    shot: 'detect-routine-read',
    from: 'detect-routine-catchup',
    window: FILM,
    map: true,
    crop: 'full',
    after: false,
    settle: 5000,
    async run({ page }) {
      await openRoutine(page);
      await seen(page, '[data-guide="detect.glance"]').waitFor({ timeout: 60_000 });
    },
  },
  {
    // the dashboard: candidates per pass since July, the spots that came and went
    shot: 'detect-routine-dashboard',
    from: 'detect-routine-read',
    window: FILM,
    clip: 'body',
    crop: 'full',
    settle: 4000,
    async run({ page }) {
      await seen(page, '[data-guide="detect.glance"]').click();
      await page.getByText('Candidates per pass').filter({ visible: true }).first().waitFor();
    },
  },
  {
    shot: 'horizon',
    window: LARGE,
    map: true,
    settle: 20_000,
    async run({ go, page }) {
      await go('horizon');
      await page.locator('.canvas-body button', { hasText: 'Open' }).filter({ visible: true }).first().click();
      await page.getByText('Half Dome from Glacier Point').filter({ visible: true }).first().click();
      await seen(page, '[data-guide="horizon.side"]').click();
    },
  },
  {
    shot: 'horizon-side',
    from: 'horizon',
    window: LARGE,
    map: true,
    settle: 6000,
    async run({ page }) {
      await seen(page, '[data-guide="horizon.side"]').click();
    },
  },
  {
    shot: 'horizon-overlay',
    window: LARGE,
    map: true,
    settle: 20_000,
    crop: 'full',
    async run({ go, page }) {
      await go('horizon');
      await page.locator('.canvas-body button', { hasText: 'Open' }).filter({ visible: true }).first().click();
      await page.getByText('Glacier Point, the 1901 photo').filter({ visible: true }).first().click();
      await seen(page, '[data-guide="horizon.overlay"]').waitFor({ timeout: 60_000 });
    },
    // the photo fades into the terrain and back, so the ridges are seen to agree
    film: {
      rate: '900k',
      async play({ page, frame }) {
        const slider = seen(page, '[data-guide="horizon.overlay"] input[type="range"]');
        const sweep = [];
        for (let at = 0; at <= LOOK_SWEEP; at += 1) {
          const t = at / LOOK_SWEEP;
          await slider.evaluate((input, value) => {
            input.value = String(value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }, Math.round(100 * t * t * (3 - 2 * t)));
          await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
          sweep.push(await frame());
        }
        const hold = (path) => Array(LOOK_HOLD).fill(path);
        return [...hold(sweep[0]), ...sweep, ...hold(sweep.at(-1)), ...[...sweep].reverse()];
      },
    },
  },
  {
    // Find's page, set up at once: the 1901 photo traced by eye, each line marked for what
    // is known of it, and the area drawn round the valley (the walk itself: FIND_STAGES)
    shot: 'find-setup',
    window: TALL,
    map: true,
    settle: 12_000,
    crop: 'full',
    async run({ go, page }) {
      await go('horizon');
      await page.locator('.canvas-body button', { hasText: 'Open' }).filter({ visible: true }).first().click();
      await page.getByText('Glacier Point, the 1901 photo').filter({ visible: true }).first().click();
      await seen(page, '[data-guide="horizon.overlay"]').waitFor({ timeout: 60_000 });
      await seen(page, '[data-guide="horizon.find"]').click();
      const photo = seen(page, '[data-guide="find.photo"]');
      const tool = (name) => photo.locator(`button[aria-label="${name}"]`).click();
      // the photo lies centred in its column, as wide or as tall as the column lets it
      const box = await photo.locator('.fp').boundingBox();
      const [width, height] = HALF_DOME_1901.size;
      const w = Math.min(box.width, (box.height * width) / height);
      const h = (w * height) / width;
      const at = ([x, y]) => [box.x + (box.width - w) / 2 + (x / width) * w, box.y + (box.height - h) / 2 + (y / height) * h];
      const along = async (line) => {
        const [first, ...rest] = line.map(at);
        await page.mouse.move(...first);
        await page.mouse.down();
        for (const point of rest) await page.mouse.move(...point, { steps: 3 });
        await page.mouse.up();
      };
      // drawn as seen, Alt keeping the magnet from moving a line onto another edge
      await page.keyboard.down('Alt');
      await tool('Trace skyline');
      for (const line of Object.values(HALF_DOME_1901.skyline)) await along(line);
      await tool('Trace a ridge');
      for (const line of Object.values(HALF_DOME_1901.ridges)) await along(line);
      await page.keyboard.up('Alt');
      // the Dome is the line anyone would know; haze may hide far land behind the far range
      await tool('Mark a key line');
      await page.mouse.click(...at(HALF_DOME_1901.skyline.dome[8]));
      await tool('Brush where far land may be hidden');
      await along(HALF_DOME_1901.skyline.farRange);
      await tool('Brush where far land may be hidden');
      // distances said wide: the domes under 10 km, the far range past it
      await tool('Say how far a line stands');
      const chips = photo.locator('[aria-label="How far the line stands"] button');
      const far = async (bands, ...lines) => {
        for (const chip of await chips.all()) {
          const on = (await chip.getAttribute('aria-pressed')) === 'true';
          if (on !== bands.includes((await chip.textContent()).trim())) await chip.click();
        }
        for (const line of lines) await page.mouse.click(...at(line[Math.floor(line.length / 2)]));
      };
      await far(['< 1 km', '1–3 km', '3–10 km'], HALF_DOME_1901.skyline.dome, HALF_DOME_1901.ridges.libertyCap);
      await far(['10–30 km', '> 30 km'], HALF_DOME_1901.skyline.farRange);
      await tool('Say how far a line stands');

      await seen(page, '[data-guide="find.steps"]').locator('button', { hasText: 'Draw the area' }).click();
      const map = await seen(page, '[data-guide="find.map"]').boundingBox();
      for (const [x, y] of FIND_AREA) await page.mouse.click(map.x + map.width * x, map.y + map.height * y);
      await page.keyboard.press('Enter');
      // a ground with the relief drawn, under a licence to show it
      await seen(page, '[data-guide="find.map"] button[aria-label="Map layers"]').click();
      await page.locator('#hz-find-layers button', { hasText: 'Topographic' }).click();
      await seen(page, '[data-guide="find.map"] button[aria-label="Map layers"]').click();
    },
  },
  {
    // what is known of the photo: the eye high over a deep valley, on its rim, and a lens
    // a camera's usual one or a little longer; a point every 50 m
    shot: 'find-know',
    from: 'find-setup',
    after: false,
    window: TALL,
    map: true,
    settle: 3000,
    crop: 'full',
    async run({ page }) {
      const steps = seen(page, '[data-guide="find.steps"]');
      await steps.locator('summary', { hasText: 'What you know' }).click();
      for (const pill of ['Summit or ridge', 'Slope', 'Above the land round', '×1', '×2–3']) {
        await steps.locator('button', { hasText: pill }).first().click();
      }
      await steps.locator('button', { hasText: 'More settings' }).click();
      await steps.locator('button[role="radio"]', { hasText: /^50 m$/ }).click();
      await seen(page, '[data-guide="find.grid"]').scrollIntoViewIfNeeded();
    },
  },
  // the search the setup runs, and the place it opens, are taken in the walk's own sitting (FIND_STAGES)
  {
    shot: 'coordinates',
    async run({ go, page }) {
      await go('coordinates');
      await page.locator('[data-guide="coords.paste"] input').fill(`${CAMERA.lat}, ${CAMERA.lon}`);
      await page.locator('[data-guide="coords.paste"] button[type="submit"]').click();
      const sky = page.locator('[data-guide="coords.sky"]');
      await sky.locator('input').first().fill('03/02/2009');
      await sky.locator('input').nth(1).fill('11:40');
      await sky.locator('input').nth(1).press('Enter');
    },
  },
  // -- a photo geolocated through its scene, the first journey ------------------
  {
    // the photo in Reverse Search, with the tab back to Media
    shot: 'reverse-photo',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    async run({ go, page }) {
      await go('reverse');
      await page.locator('.canvas-body').getByText('bridge_channel', { exact: true }).first().click();
      await seen(page, '[data-guide="reverse.engines"]').waitFor();
    },
  },
  // Media is photographed in one sitting, so its cards stand in the same order on every picture.
  {
    shot: 'media-rail',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    async run({ go, page }) {
      await go('media');
      await stopHeld(page);
    },
  },
  {
    // the photo's arrow pressed: Open in…
    shot: 'media-rail-menu',
    from: 'media-rail',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    async run({ page }) {
      await card(page, 'bridge_channel').locator('[title="Open in…"]').click();
      await seen(page, '[data-guide="media.mark"]').waitFor();
    },
  },
  {
    // the video's arrow pressed: Open in…
    shot: 'media-rail-video-menu',
    from: 'media-rail-menu',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    async run({ page }) {
      await card(page, 'channel_departure').locator('[title="Open in…"]').click();
      await seen(page, '[data-guide="media.open-inspect"]').waitFor();
    },
  },
  {
    // the video played full screen
    shot: 'media-viewer-video',
    from: 'media-rail-video-menu',
    window: LARGE,
    clip: 'body',
    crop: 'full',
    async run({ page }) {
      await card(page, 'channel_departure').locator('.thumb').click();
      await seen(page, '[data-guide="media.viewer"] video').waitFor();
      await page.waitForTimeout(1500);
    },
  },
  {
    // the photo just marked: the notice at the bottom, with Show
    shot: 'media-marked',
    from: 'media-viewer-video',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    async run({ page }) {
      // the pictures hide notices; this one is the step
      await page.addStyleTag({ content: '.toasts { display: flex !important; }' });
      await card(page, 'bridge_channel').locator('[title="Open in…"]').click();
      const mark = page.locator('[data-guide="media.mark"]');
      await mark.waitFor();
      if ((await mark.textContent()).includes('Marked')) {
        await page.keyboard.press('Escape');
        throw new Error('the photo was already marked: its notice cannot be shown');
      }
      await mark.click();
      await seen(page, '[data-guide="toast.action"]').waitFor();
      await page.mouse.move(1, 1);
    },
  },
  {
    // Show pressed: the case panel on its To-do, the photo's scene waiting with its Geolocate
    shot: 'todo-geolocate',
    from: 'media-marked',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="toast.action"]').click();
      await seen(page, '[data-guide="todo.go"]').waitFor();
      // the demo case says the photo was geolocated, which it is not yet here
      const done = page.getByRole('checkbox', { name: 'Complete Geolocate the photo' });
      if (await done.isChecked().catch(() => false)) await done.uncheck();
      await page.waitForTimeout(500);
    },
  },
  {
    // Geolocate pressed: the map far out, nothing found yet, the photo beside it
    shot: 'satellite-landed',
    from: 'todo-geolocate',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ go, page, demo }) {
      await seen(page, '[data-guide="todo.go"]').click();
      await seen(page, '[data-guide="geo.pill"]').waitFor();
      // the demo case saved the bridge already, which a reader's case has not: the search
      // answers from the place names, as it would for them
      await page.route('**/satellite/index', (route) => route.fulfill({ json: [] }));
      await mapWithScene(go, page, demo, SEARCH_VIEW);
    },
  },
  {
    // the name typed, its answer listed under it
    shot: 'satellite-search',
    from: 'satellite-landed',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ page }) {
      await seen(page, '[data-guide="sat.search"] input').click();
      await page.keyboard.type('Vincent Thomas Bridge', { delay: 40 });
      await seen(page, '[data-guide="sat.answer"]').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(2500);
    },
  },
  {
    // the channel the answer flew to, zoomed in: the bridge, the cranes, the west bank
    shot: 'satellite-port',
    from: 'satellite-search',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ go, page, demo }) {
      await page.unroute('**/satellite/index');
      await mapWithScene(go, page, demo, MEASURE_VIEW);
    },
  },
  {
    // Align pressed on the rail; the film clicks the bridge's east tower, then the cranes it
    // stands behind in the photo, runs the line on past them and folds the panel
    shot: 'tower-line',
    from: 'satellite-port',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ page }) {
      await seen(page, '[data-guide="map.align-tool"]').click();
      await page.mouse.move(1, 1);
      await page.waitForTimeout(800);
    },
    film: {
      rate: '500k',
      async play({ page, frame }) {
        const { frames, take } = filmFrames(frame);
        await take(20);
        const tower = await onMap(page, MEASURE_VIEW, EAST_TOWER);
        const cranes = await onMap(page, MEASURE_VIEW, TERMINAL);
        await page.mouse.click(tower.x, tower.y);
        await page.mouse.move(1, 1);
        await page.waitForTimeout(500);
        await take(20);
        await page.mouse.click(cranes.x, cranes.y);
        await page.mouse.move(1, 1);
        await page.waitForTimeout(800);
        await take(25);
        // the camera stands on the side of the nearer thing: the line runs on past the cranes
        await seen(page, '[data-guide="map.align"]').getByRole('button', { name: 'Past B' }).click();
        await page.mouse.move(1, 1);
        await page.waitForTimeout(800);
        await take(30);
        // folded to one line, the panel gives the photo back
        await seen(page, '[title="Fold the panel to one line"]').click();
        await page.mouse.move(1, 1);
        await page.waitForTimeout(600);
        await take(40);
        return frames;
      },
    },
  },
  {
    // a right-click where the line meets the west bank, the line still drawn
    shot: 'lead-menu',
    from: 'tower-line',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ page }) {
      // just beside the line, on the bank: a click on the line itself is the alignment's
      const { x, y } = await onMap(page, MEASURE_VIEW, LEADS[0]);
      await page.mouse.click(x - 8, y, { button: 'right' });
      await seen(page, '[data-guide="map.drop-lead"]').waitFor();
    },
  },
  {
    // Drop a lead here pressed: lead 1 on the line, before any capture
    shot: 'satellite-scene',
    from: 'lead-menu',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ page }) {
      await seen(page, '[data-guide="map.drop-lead"]').click();
      await page.mouse.move(1, 1);
      await page.waitForTimeout(1500);
    },
  },
  {
    // a right-click beside the first lead
    shot: 'scene-menu',
    from: 'satellite-scene',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ page }) {
      const { x, y } = await onMap(page, MEASURE_VIEW, LEADS[0]);
      await page.mouse.click(x - 30, y + 10, { button: 'right' });
      await seen(page, '[data-guide="map.menu"]').waitFor();
    },
  },
  {
    // Open in… unfolded: the map sites the spot opens on
    shot: 'scene-open-in',
    from: 'scene-menu',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ page }) {
      await seen(page, '[data-guide="map.open-in"]').click();
      await seen(page, '[data-guide="map.google-satellite"]').waitFor();
    },
    async after({ page }) {
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    },
  },
  {
    // the capture extension over another map site, the scene held in Azimut
    shot: 'extension-scene',
    from: 'scene-open-in',
    after: false,
    browser: 'extension',
    window: LARGE,
    clip: 'body',
    crop: 'full',
    settle: 1500,
    async run({ ext }) {
      await ext.fresh();
      await ext.tools();
      await ext.map.mouse.move(1, 1);
      await liftAnchors(ext.map, ['ext.capture']);
    },
  },
  {
    // the capture that matches, counted on the pill
    shot: 'satellite-captured',
    from: 'extension-scene',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ page, demo }) {
      await captureScene(page, demo);
      await page.mouse.move(1, 1);
    },
  },
  {
    // Make the proof: the photo beside the capture the scene gathered, nothing marked yet
    shot: 'proof-blank',
    from: 'satellite-captured',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page, demo }) {
      await casePins(page, demo, true);
      await seen(page, '[data-guide="geo.make"]').click();
      await seen(page, '[data-guide="proof.canvas"] .konva').waitFor({ timeout: 30_000 });
      await page.waitForFunction(() => (window.Konva?.stages?.[0]?.find('Image') ?? []).length >= 2, null, { timeout: 30_000 });
      await proofFacts(page);
      await closeSidebar(page);
    },
  },
  {
    // the box tool in hand; the film boxes the tower on the photo, then on the capture
    shot: 'proof-boxes',
    from: 'proof-blank',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await page.locator('[data-guide="proof.box"]').click();
    },
    film: {
      rate: '500k',
      async play({ page, frame }) {
        return boxBoth(page, frame, MATCHES[0]);
      },
    },
  },
  {
    // the tower boxed in red on both pictures, the box tool taken up again: the swatch next
    shot: 'proof-tower',
    from: 'proof-boxes',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await armBox(page);
      await page.mouse.move(1, 1);
    },
  },
  {
    // blue picked; the film boxes the cranes on the photo, then on the capture
    shot: 'proof-cranes',
    from: 'proof-tower',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      const tools = page.locator('[data-guide="proof.tools"]');
      await page.locator('[data-guide="proof.colour"]').click();
      await tools.locator('.flyout-colors.open .color-btn').nth(1).click();
      await armBox(page);
      await page.mouse.move(1, 1);
    },
    film: {
      rate: '500k',
      async play({ page, frame }) {
        return boxBoth(page, frame, MATCHES[1]);
      },
    },
  },
  {
    // both pictures marked; the first row's label next
    shot: 'proof-marked',
    from: 'proof-cranes',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await closeSidebar(page);
    },
  },
  {
    // the first row named for what the photo shows, the plus next
    shot: 'proof-labelled',
    from: 'proof-marked',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await namePoint(page, 'proof.first-label', 'YM Success');
    },
  },
  {
    shot: 'proof-row2',
    from: 'proof-labelled',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await addPointRow(page);
    },
  },
  {
    shot: 'proof-camera-map',
    from: 'proof-row2',
    after: false,
    window: TALL,
    clip: 'body',
    crop: 'full',
    async run({ page }) {
      await newRowMap(page);
    },
  },
  {
    shot: 'proof-camera-lead',
    from: 'proof-camera-map',
    after: false,
    window: TALL,
    clip: 'body',
    crop: 'full',
    async run({ page }) {
      await takeFirstLead(page);
    },
  },
  {
    shot: 'proof-camera',
    from: 'proof-camera-lead',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await useMovedPoint(page);
    },
  },
  {
    // the camera's row named, its eye next
    shot: 'proof-camera-named',
    from: 'proof-camera',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await namePoint(page, 'proof.new-label', 'Camera');
    },
  },
  {
    // the camera's row lit as the point of view; the description and date next
    shot: 'proof-camera-done',
    from: 'proof-camera-named',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await cameraPov(page);
    },
  },
  {
    // the description and the date typed in, Save proof next
    shot: 'proof-typed',
    from: 'proof-camera-done',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await page.getByPlaceholder('A formation of 13 helicopters heading east').fill('The YM Success under the Vincent Thomas Bridge, seen from the west bank of the Main Channel.');
      // the day the photo was taken, as its source dates it
      const when = page.locator('#proof-when');
      await when.fill('03/02/2009');
      await when.press('Enter');
      await page.evaluate(() => document.activeElement?.blur?.());
    },
  },
  {
    // Save proof pressed: the first point, the one the capture proposed, checked on the map
    shot: 'proof-check',
    from: 'proof-typed',
    after: false,
    window: TALL,
    clip: 'body',
    crop: 'full',
    async run({ page }) {
      await saveToCheck(page);
    },
  },
  {
    // the proof as the Geo Proof page shows it, saved: marked, dated, its place and its camera
    shot: 'proof',
    from: 'proof-check',
    after: false,
    window: TALL,
    async run({ page }) {
      await keepPoint(page);
      await closeSidebar(page);
    },
  },
  {
    shot: 'proof-result',
    from: 'proof',
    after: false,
    // wider than the composer's picture, so the page it fits fills more of it
    window: { width: 1500, height: 900 },
    clip: '[data-guide="proof.canvas"]',
    focus: ['#guide-proof-page'],
    async run({ page }) {
      await framePage(page);
    },
  },
  {
    shot: 'post',
    from: 'proof-result',
    after: false,
    window: TALL,
    async run({ page }) {
      // the proof goes on to the post as To Post sends it, its description and date with it
      await page.locator('[data-guide="proof.to-post"]').click();
      await page.locator('[data-guide="post.first"]').waitFor();
      await page.waitForTimeout(1500);
      await closeSidebar(page);
    },
  },
  {
    shot: 'post-cleared',
    from: 'post',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await clearMention(page);
    },
  },
  {
    shot: 'post-home',
    from: 'post-cleared',
    after: false,
    window: WIDE,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="post.home"]').click();
      await seen(page, '[data-guide="post.new"]').waitFor();
    },
  },

  // -- a video geolocated scene by scene, the second journey -------------------
  {
    shot: 'inspect-scenes',
    window: LARGE,
    // the whole window, the top bar where the pill stands included
    clip: '.shell',
    crop: 'full',
    async run({ go, page }) {
      await clipScenes(go, page);
      // Geolocate goes to the map; the pill's own link comes back to the scene
      await geolocate(page);
      await seen(page, '[data-guide="geo.pill"]').getByRole('button', { name: 'Open the scene in Inspect' }).click();
      await seen(page, '[data-guide="inspect.scenes"]').waitFor();
    },
  },
  {
    // the clip in Reverse Search, with the tab back to Media
    shot: 'reverse-video',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    async run({ go, page }) {
      await go('reverse');
      await page.locator('.canvas-body').getByText('channel_departure', { exact: true }).first().click();
      await seen(page, '[data-guide="reverse.engines"]').waitFor();
    },
  },
  {
    // the clip in Inspect as it comes in: no frame, no scene. The demo's own work on it
    // is cleared first, and a scene a picture before left held is let go.
    shot: 'inspect-video',
    window: WIDE,
    crop: 'full',
    async run({ go, page }) {
      await go('inspect');
      await stopHeld(page);
      await page.locator('.canvas-body').getByText('channel_departure', { exact: true }).first().click();
      await page.locator('[data-guide="inspect.strip"] img').first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1500);
      const clear = page.locator('[data-guide="inspect.file"]', { hasText: 'Clear work' }).filter({ visible: true });
      if (await clear.count()) {
        await clear.first().click();
        // the confirmation's own Clear work, drawn after the header's
        const confirm = page.getByRole('button', { name: 'Clear work', exact: true }).last();
        await confirm.click();
        await page.locator('[role="alertdialog"], [role="dialog"]').filter({ hasText: 'Clear the work' }).waitFor({ state: 'detached' }).catch(() => {});
        await page.waitForTimeout(2500);
      }
      await inspectTab(page, 'Scenes').click();
      await seen(page, '[data-guide="inspect.whole"]').waitFor();
    },
  },
  {
    // Whole video pressed, the player stopped where the cranes show best
    shot: 'inspect-video-scene',
    from: 'inspect-video',
    after: false,
    window: WIDE,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="inspect.whole"]').click();
      await page.getByTestId('scene-row').first().waitFor();
      const bar = await seen(page, '.track').boundingBox();
      await page.mouse.click(bar.x + bar.width * 0.2, bar.y + bar.height / 2);
      await page.mouse.move(1, 1);
      await page.waitForTimeout(1200);
    },
  },
  {
    // the frame captured into the scene, its Geolocate beside it
    shot: 'video-scene',
    from: 'inspect-video-scene',
    after: false,
    window: WIDE,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="inspect.capture"]').click();
      await page.locator('[data-guide="inspect.strip"] img').nth(1).waitFor({ timeout: 30_000 });
      await seen(page, '[data-guide="scene.geolocate"]').waitFor();
      await page.waitForTimeout(800);
    },
  },
  {
    // Geolocate pressed: the map far out, nothing found yet, the video beside it
    shot: 'satellite-video',
    from: 'video-scene',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ go, page, demo }) {
      await seen(page, '[data-guide="scene.geolocate"]').click();
      await seen(page, '[data-guide="geo.pill"]').waitFor();
      // the search answers from the place names, as in a case that saved nothing there yet
      await page.route('**/satellite/index', (route) => route.fulfill({ json: [] }));
      await mapWithScene(go, page, demo, SEARCH_VIEW);
    },
  },
  {
    shot: 'satellite-video-search',
    from: 'satellite-video',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ page }) {
      await seen(page, '[data-guide="sat.search"] input').click();
      await page.keyboard.type('Port of Los Angeles', { delay: 40 });
      await seen(page, '[data-guide="sat.answer"]').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(2500);
    },
  },
  {
    // the channel the answer flew to, zoomed in south of the oil tanks, no lead yet
    shot: 'satellite-video-port',
    from: 'satellite-video-search',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ go, page, demo }) {
      await page.unroute('**/satellite/index');
      await mapWithScene(go, page, demo, VIDEO_VIEW);
    },
  },
  {
    // the lead mid-channel, level with the two cranes on the ship's left
    shot: 'satellite-video-leads',
    from: 'satellite-video-port',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ page }) {
      await dropLeads(page, VIDEO_VIEW, VIDEO_LEADS);
    },
  },
  {
    // a right-click beside the first lead, the video beside the map
    shot: 'scene-menu-video',
    from: 'satellite-video-leads',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ page }) {
      const { x, y } = await onMap(page, VIDEO_VIEW, VIDEO_LEADS[0]);
      await page.mouse.click(x + 30, y + 10, { button: 'right' });
      await seen(page, '[data-guide="map.menu"]').waitFor();
    },
  },
  {
    shot: 'scene-open-in-video',
    from: 'scene-menu-video',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ page }) {
      await seen(page, '[data-guide="map.open-in"]').click();
      await seen(page, '[data-guide="map.google-satellite"]').waitFor();
    },
    async after({ page }) {
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    },
  },
  {
    // the capture extension over another map site, the video's scene held in Azimut
    shot: 'extension-scene-video',
    from: 'scene-open-in-video',
    after: false,
    browser: 'extension',
    window: LARGE,
    clip: 'body',
    crop: 'full',
    settle: 1500,
    async run({ ext }) {
      await ext.fresh();
      await ext.tools();
      await ext.map.mouse.move(1, 1);
      await liftAnchors(ext.map, ['ext.capture']);
    },
  },
  {
    // the capture that matches, counted on the pill
    shot: 'satellite-video-captured',
    from: 'extension-scene-video',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ page, demo }) {
      await captureScene(page, demo, VIDEO_CAPTURE);
      await page.mouse.move(1, 1);
    },
  },
  {
    // the pill's Make the proof asks Inspect which frames go beside the capture
    shot: 'proof-chooser',
    from: 'satellite-video-captured',
    after: false,
    window: LARGE,
    clip: 'body',
    crop: 'full',
    async run({ page, demo }) {
      await casePins(page, demo, true);
      await seen(page, '[data-guide="geo.make"]').click();
      await page.getByRole('dialog', { name: 'Make the proof' }).locator('[data-guide="proof.make"]').waitFor();
      await page.waitForTimeout(1000);
    },
  },
  {
    // the video's proof before its marks: the frame beside the capture
    shot: 'proof-video',
    from: 'proof-chooser',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await page.locator('[data-guide="proof.make"]').click();
      await seen(page, '[data-guide="proof.canvas"] .konva').waitFor({ timeout: 30_000 });
      await page.waitForFunction(() => (window.Konva?.stages?.[0]?.find('Image') ?? []).length >= 2, null, { timeout: 30_000 });
      await page.waitForTimeout(1500);
      await proofFacts(page);
      await closeSidebar(page);
      // the page fitted to the canvas
      await page.keyboard.press('f');
    },
  },
  {
    // the two cranes boxed in red on the frame and on the capture, the box tool taken up again: the swatch next
    shot: 'proof-video-cranes',
    from: 'proof-video',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await boxVideoMatch(page, VIDEO_MATCHES[0]);
      await armBox(page);
      await page.mouse.move(1, 1);
    },
  },
  {
    // blue picked, the building at the channel's end boxed on both: both pictures marked
    shot: 'proof-video-marked',
    from: 'proof-video-cranes',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      const tools = page.locator('[data-guide="proof.tools"]');
      await page.locator('[data-guide="proof.colour"]').click();
      await tools.locator('.flyout-colors.open .color-btn').nth(1).click();
      await boxVideoMatch(page, VIDEO_MATCHES[1]);
      await closeSidebar(page);
    },
  },
  {
    // the first row named for what the video shows, the plus next
    shot: 'proof-video-labelled',
    from: 'proof-video-marked',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await namePoint(page, 'proof.first-label', 'Main Channel');
    },
  },
  {
    shot: 'proof-video-row2',
    from: 'proof-video-labelled',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await addPointRow(page);
    },
  },
  {
    shot: 'proof-video-camera-map',
    from: 'proof-video-row2',
    after: false,
    window: TALL,
    clip: 'body',
    crop: 'full',
    async run({ page }) {
      await newRowMap(page);
    },
  },
  {
    shot: 'proof-video-camera-lead',
    from: 'proof-video-camera-map',
    after: false,
    window: TALL,
    clip: 'body',
    crop: 'full',
    async run({ page }) {
      await takeFirstLead(page);
    },
  },
  {
    shot: 'proof-video-camera',
    from: 'proof-video-camera-lead',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await useMovedPoint(page);
    },
  },
  {
    // the camera's row named, its eye next
    shot: 'proof-video-named',
    from: 'proof-video-camera',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await namePoint(page, 'proof.new-label', 'Camera');
    },
  },
  {
    // the camera's row lit as the point of view, the description and date next
    shot: 'proof-video-done',
    from: 'proof-video-named',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await cameraPov(page);
    },
  },
  {
    // the description and the date typed in, Save proof next
    shot: 'proof-video-typed',
    from: 'proof-video-done',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await page.getByPlaceholder('A formation of 13 helicopters heading east').fill('A ship leaves the port by the Main Channel, two tugs ahead of it.');
      const when = page.locator('#proof-when');
      await when.fill('15/05/2020');
      await when.press('Enter');
      await page.evaluate(() => document.activeElement?.blur?.());
    },
  },
  {
    // Save proof: the first point, the one the capture proposed, checked on the map
    shot: 'proof-video-check',
    from: 'proof-video-typed',
    after: false,
    window: TALL,
    clip: 'body',
    crop: 'full',
    async run({ page }) {
      await saveToCheck(page);
    },
  },
  {
    // the point kept: the proof saved, To Post next
    shot: 'proof-video-saved',
    from: 'proof-video-check',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await keepPoint(page);
    },
  },
  {
    // the video's proof as it leaves the case: its page, fitted and cut to its pictures
    shot: 'proof-video-result',
    from: 'proof-video-saved',
    after: false,
    window: { width: 1500, height: 900 },
    clip: '[data-guide="proof.canvas"]',
    focus: ['#guide-proof-page'],
    async run({ page }) {
      await framePage(page);
    },
  },
  {
    shot: 'post-video',
    from: 'proof-video-result',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await page.locator('[data-guide="proof.to-post"]').click();
      await page.locator('[data-guide="post.first"]').waitFor();
      await page.waitForTimeout(1500);
      await closeSidebar(page);
    },
  },
  {
    shot: 'post-video-cleared',
    from: 'post-video',
    after: false,
    window: TALL,
    crop: 'full',
    async run({ page }) {
      await clearMention(page);
    },
  },

  // -- the detours, taken with no scene held: the same pictures for a photo and a video --
  {
    // Horizon on Glacier Point, Overlay not pressed yet
    shot: 'horizon-view',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    settle: 20_000,
    async run({ go, page }) {
      await go('horizon');
      await stopHeld(page);
      await page.locator('.canvas-body button', { hasText: 'Open' }).filter({ visible: true }).first().click();
      await page.getByText('Half Dome from Glacier Point').filter({ visible: true }).first().click();
      await seen(page, '[data-guide="horizon.lay"]').waitFor();
    },
  },
  {
    // Overlay pressed, the case's photos only: the pictures to lay over the view
    shot: 'horizon-pick',
    from: 'horizon-view',
    window: LARGE,
    clip: 'body',
    crop: 'full',
    async run({ page }) {
      await pickerOn(page, 'Photos');
    },
  },
  {
    // the 1901 photo laid over the terrain; the film slides from the photo to the terrain and back
    shot: 'horizon-scene',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    settle: 20_000,
    async run({ go, page }) {
      await go('horizon');
      await stopHeld(page);
      await page.locator('.canvas-body button', { hasText: 'Open' }).filter({ visible: true }).first().click();
      await page.getByText('Glacier Point, the 1901 photo').filter({ visible: true }).first().click();
      await seen(page, '[data-guide="horizon.overlay"]').waitFor({ timeout: 60_000 });
    },
    film: {
      rate: '600k',
      async play({ page, frame }) {
        const slider = seen(page, '[data-guide="horizon.overlay"] input[type="range"]');
        const sweep = [];
        for (let at = 0; at <= LOOK_SWEEP; at += 1) {
          const t = at / LOOK_SWEEP;
          await slider.evaluate((input, value) => {
            input.value = String(value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }, Math.round(100 * t * t * (3 - 2 * t)));
          await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
          sweep.push(await frame());
        }
        const hold = (path) => Array(LOOK_HOLD).fill(path);
        return [...hold(sweep[0]), ...sweep, ...hold(sweep.at(-1)), ...[...sweep].reverse()];
      },
    },
  },
  {
    // the Horizon aside's place: Glacier Point right-clicked on the map, Look from here in the menu
    shot: 'glacier-menu',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ go, page }) {
      const view = { ...GLACIER_POINT, zoom: 15 };
      await go(`satellite?ll=${view.lat},${view.lon}&z=${view.zoom}&p=usgs-imagery`);
      await stopHeld(page);
      const { x, y } = await onMap(page, view, GLACIER_POINT);
      await page.mouse.click(x, y, { button: 'right' });
      await seen(page, '[data-guide="map.look"]').waitFor();
    },
  },
  {
    // Compare on the channel, both sides on the public imagery: Esri's dated archive may
    // not be shown in a picture (photos/CREDITS.md), so the case's own comparison of the
    // spot is opened and its map side set to the imagery too
    shot: 'compare-scene',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ go, page }) {
      await go(`compare?${CHANNEL_VIEW}`);
      await stopHeld(page);
      await page.locator('.canvas-body button', { hasText: 'Open' }).filter({ visible: true }).first().click();
      await page.getByText('Main Channel, imagery against the map').filter({ visible: true }).first().click();
      const discard = page.getByRole('button', { name: 'Discard changes' });
      if (await discard.isVisible().catch(() => false)) await discard.click();
      const sides = page.locator('[data-guide="compare.source"]').filter({ visible: true });
      await sides.first().waitFor();
      await page.waitForTimeout(2000);
      const names = sides.locator('button[aria-label="Imagery provider"] .name');
      for (let tries = 0; tries < 4; tries += 1) {
        const off = (await names.allTextContents()).findIndex((name) => name.trim() !== 'USGS Imagery');
        if (off < 0) break;
        await useImagery(sides.nth(off), 'USGS Imagery');
        await page.waitForTimeout(2000);
      }
      const shown = await names.allTextContents();
      if (shown.length < 2 || shown.some((name) => name.trim() !== 'USGS Imagery')) {
        throw new Error(`Compare still shows ${shown.join(' and ')}: no Esri picture is kept`);
      }
      await page.mouse.move(1, 1);
    },
  },
  {
    // B's imagery chip open, Esri Wayback in its list
    shot: 'compare-menu',
    from: 'compare-scene',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ page }) {
      const sides = page.locator('[data-guide="compare.source"]').filter({ visible: true });
      await sides.nth(1).locator('button[aria-label="Imagery provider"]').click();
      await seen(page, '[data-guide="imagery.wayback"]').waitFor();
    },
  },
  {
    shot: 'plate',
    window: WIDE,
    settle: 6000,
    async run({ go, page }) {
      await go('plate');
      // a new plate starts on the Map's ground, with the layers the Satellite stage put on,
      // its questions answered as they stand
      await seen(page, '.canvas-body button:has-text("New plate")').click();
      await seen(page, '[role="dialog"] button:has-text("Create plate")').click();
      // the plate puts the sidebar away itself once its page is laid out
      await seen(page, '[data-guide="plate.page"]').waitFor();
      await page.waitForTimeout(1500);
    },
  },
  {
    shot: 'plate-add',
    from: 'plate',
    window: WIDE,
    focus: ['[data-guide="plate.add-groups"]'],
    async run({ page }) {
      await seen(page, '[data-guide="plate.add"]').click();
    },
  },
  {
    shot: 'plate-layers',
    from: 'plate',
    window: WIDE,
    focus: ['[data-guide="plate.list"]', '[data-guide="plate.page"]'],
    async run({ page }) {
      await seen(page, '[data-guide="plate.layers"]').click();
      await seen(page, '[data-guide="plate.list"] section.map').waitFor();
    },
  },
  {
    shot: 'plate-home',
    from: 'plate',
    // short enough that the ready plates, framed whole, keep the picture landscape
    window: { width: WIDE.width, height: 540 },
    focus: ['[data-guide="plate.ready"]'],
    async run({ page }) {
      await seen(page, '[data-guide="plate.home"]').click();
      await seen(page, '[data-guide="plate.ready"]').waitFor();
      // the case's plates and the analyst's templates come first: the ready ones are
      // brought up to the top, their heading in sight
      await page.locator('h4:has-text("Ready plates")').evaluate((node) => node.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
    },
  },
  {
    shot: 'plate-made',
    from: 'plate-home',
    window: { width: 1500, height: 940 },
    // the paper alone, as it leaves the app
    clip: '[data-guide="plate.page"] .page',
    crop: 'full',
    settle: 9000,
    async run({ page }) {
      // the Locator on the case's survey layer, in the Tactical look: the place, a closer
      // look at the cranes, and where it lies on a globe
      await seen(page, '[data-guide="plate.ready"] button.open:has-text("Locator")').click();
      await seen(page, '[data-guide="plate.page"] .page').waitFor();
      await seen(page, '[data-guide="plate.looks"] button:has-text("Tactical")').click();
      // the column may still be on Layers, where the picture before left it
      await seen(page, 'button:has-text("On the page")').click();
      const rows = page.locator('[data-guide="plate.list"] button.row');
      // the closer look comes on Esri imagery, which no picture shows (photos/CREDITS.md):
      // on the look's own ground instead
      await rows.filter({ hasText: 'Detail' }).first().click();
      await seen(page, '[aria-label="Ground"] button[title="Tactical, dark blue"]').click();
      // drawn lines, so a closer look wide enough to hold the quay, its roads and its sheds
      await seen(page, 'input[aria-label="Zoom"]').fill('16.2');
      await page.keyboard.press('Tab');
      // the title names the place rather than the case
      await rows.filter({ hasText: 'Demo case' }).first().click();
      await seen(page, 'textarea[aria-label="Text"]').fill('Main Channel, Port of Los Angeles');
      // nothing picked as it leaves: a press round the paper drops the pick
      await page.locator('[data-guide="plate.page"]').click({ position: { x: 16, y: 16 } });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1500);
    },
  },
  {
    shot: 'notebook',
    window: WIDE,
    async run({ go, page }) {
      await go('notebook');
      await seen(page, '[data-guide="notebook.cards"]').waitFor();
    },
  },
  {
    shot: 'notebook-note',
    from: 'notebook',
    window: WIDE,
    async run({ page }) {
      await seen(page, '[data-guide="notebook.case"] button.open').click();
      await seen(page, '.cm-editor .cm-chip').waitFor();
      // the diagram is drawn by Mermaid, a moment after the page
      await seen(page, '.cm-block-diagram svg').waitFor();
    },
  },
  {
    shot: 'timeline',
    window: WIDE,
    async run({ go }) {
      await go('timeline');
    },
  },
  {
    shot: 'board',
    window: ROOMY,
    // the whole index, never a strip cut after its first rows
    crop: 'full',
    async run({ go }) {
      await go('board');
    },
  },
  {
    shot: 'board-details',
    from: 'board',
    window: ROOMY,
    crop: 'full',
    async run({ page }) {
      await page.locator('.canvas-body').getByText(CAMERA_PLACE, { exact: true }).filter({ visible: true }).first().click();
      await seen(page, '[data-guide="board.details"]').waitFor();
    },
  },
  {
    shot: 'graph',
    window: WIDE,
    settle: 2000,
    async run({ go, page }) {
      await go('graph');
      // the drawing settles after the page does: wait for it, then fit it to the frame
      await page.waitForTimeout(3000);
      await seen(page, '[data-guide="graph.canvas"]').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('0');
    },
  },
  {
    shot: 'sheet',
    window: WIDE,
    async run({ go, page }) {
      await go('sheet');
      await page.locator('.canvas-body').getByText('Files to geolocate', { exact: true }).first().click();
    },
  },
  {
    shot: 'sheet-new',
    from: 'sheet',
    window: WIDE,
    // the sheet whole, its title too, under the menu
    crop: 'full',
    focus: ['[data-guide="sheet.new-menu"]'],
    async run({ page }) {
      await seen(page, '[data-guide="sheet.new"]').click();
    },
  },

  // -- a layer of one's own, the make-a-layer journey ----------------------------
  // One sitting, after every other picture: the demo's own survey layer goes to the
  // Trash, and the analyst builds it again from nothing, each picture taken before the
  // press it explains. It starts from the proof the geolocation pictures composed,
  // saved here when nothing saved it yet, which the layer takes in from the case.
  {
    // the app on another workspace, the rail on its left
    shot: 'layer-home',
    from: 'proof',
    after: false,
    window: WIDE,
    clip: '.shell',
    crop: 'full',
    async run({ go, page, demo }) {
      const proofs = `/api/cases/${demo.caseId}/proofs`;
      const save = page.locator('[data-guide="proof.save"]', { hasText: 'Save proof' }).filter({ visible: true });
      if (!(await route(page, 'GET', proofs)).length && (await save.count())) {
        await save.first().click();
        // saving asks to check the point taken from the imagery once
        const keep = page.getByRole('button', { name: 'Use this point' });
        await keep.waitFor({ timeout: 8000 }).then(() => keep.click()).catch(() => {});
        for (let wait = 0; wait < 60 && !(await route(page, 'GET', proofs)).length; wait += 1) await page.waitForTimeout(500);
      }
      // the scene held since its proof would draw its leads on every map
      const stop = page.locator('[data-guide="geo.pill"] button[aria-label="Stop geolocating"]');
      if (await stop.count()) await stop.click();
      await go('satellite');
      const built = await layerNamed(page, demo, SURVEY);
      if (built) await route(page, 'DELETE', `/api/cases/${demo.caseId}/map-layers/${encodeURIComponent(built)}`);
      await layersPanel(go, page);
      // the observations and the located files drawn over the ground would cross every shape drawn here
      for (const title of ['Channel observations', 'Media']) {
        const eye = page.locator(`[data-guide="sat.panel"] button[aria-label="${title}"][aria-pressed="true"]`).filter({ visible: true });
        if (await eye.count()) await eye.first().click();
      }
      await seen(page, '[data-guide="sat.panel"] [title="Hide the panel"]').click();
      // left by the rail rather than a reload, so the Map comes back on the public
      // domain imagery it was opened on, never on Esri's (photos/CREDITS.md)
      await seen(page, '[data-guide="rail.collect"]').click();
      await closeSidebar(page);
    },
  },
  {
    // Map pressed: it opens on Satellite, on the ground to map, its panel folded
    shot: 'layer-start',
    from: 'layer-home',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ go, page }) {
      await seen(page, '[data-guide="rail.map"]').click();
      await seen(page, '[data-guide="tab.satellite"]').waitFor();
      await layersPanel(go, page);
      await seen(page, '[data-guide="sat.panel"] [title="Hide the panel"]').click();
      await seen(page, '[data-guide="sat.panel-open"]').waitFor();
    },
  },
  {
    // the panel open: My layers empty
    shot: 'layer-panel',
    from: 'layer-start',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="sat.panel-open"]').click();
      await seen(page, '[data-guide="layer.new"]').waitFor();
    },
  },
  {
    // New layer, as it opens
    shot: 'layer-new-fresh',
    from: 'layer-panel',
    after: false,
    window: WIDE,
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="layer.new"]').click();
      await page.getByRole('dialog', { name: 'New layer' }).waitFor();
    },
  },
  {
    // named: Create layer still to press
    shot: 'layer-new',
    from: 'layer-new-fresh',
    after: false,
    window: WIDE,
    focus: ['[role="dialog"]'],
    async run({ page }) {
      const dialog = page.getByRole('dialog', { name: 'New layer' });
      await dialog.locator('[data-guide="layer.name"] input').fill(SURVEY);
    },
  },
  {
    // Create layer pressed: the layer open, empty, its tools on the map; then markers, a click each
    shot: 'layer-points',
    from: 'layer-new',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="layer.create"]').click();
      await seen(page, '[data-guide="layer.tools"]').waitFor({ timeout: 30_000 });
      await page.waitForFunction(() => !document.querySelector('[data-guide="layer.panel"] .note')?.textContent?.includes('Opening'));
    },
    film: {
      rate: '900k',
      play: ({ page, frame }) => drawFilm(page, frame, 'layer.markers', CRANES, 'Escape'),
    },
  },
  {
    // the markers drawn; a line, point by point
    shot: 'layer-line',
    from: 'layer-points',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await layerSaved(page);
      await clearPick(page);
    },
    film: {
      rate: '900k',
      play: ({ page, frame }) => drawFilm(page, frame, 'layer.line', ROUTE, 'Enter'),
    },
  },
  {
    // the line drawn; an area, corner by corner
    shot: 'layer-area',
    from: 'layer-line',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await layerSaved(page);
      await clearPick(page);
    },
    film: {
      rate: '900k',
      play: ({ page, frame }) => drawFilm(page, frame, 'layer.area', YARD, 'Enter'),
    },
  },
  {
    // everything drawn, all in Features
    shot: 'layer-drawn',
    from: 'layer-area',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await layerSaved(page);
      await clearPick(page);
    },
  },
  {
    // New group pressed: its name still to type
    shot: 'layer-group-new',
    from: 'layer-drawn',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="layer.new-group"]').click();
      await seen(page, '[data-guide="layer.group-field"]').waitFor();
    },
  },
  {
    // the second group made, empty, under the first
    shot: 'layer-group-made',
    from: 'layer-group-new',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      const field = seen(page, '[data-guide="layer.group-field"]');
      await field.fill(GROUP_TWO);
      await field.press('Enter');
      await seen(page, `[aria-label="Group ${GROUP_TWO}"]`).waitFor();
      await layerSaved(page);
    },
  },
  {
    // the area and the line dragged into it
    shot: 'layer-sorted',
    from: 'layer-group-made',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      const into = seen(page, `[aria-label="Group ${GROUP_TWO}"]`);
      for (const name of ['Area 1', 'Line 1']) {
        await seen(page, `[data-guide="layer.feature"]:has-text("${name}")`).dragTo(into);
        await layerSaved(page);
      }
      await clearPick(page);
    },
  },
  {
    // the first group's settings, as they open
    shot: 'layer-group-menu',
    from: 'layer-sorted',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="layer.group-more"]').click();
      await seen(page, '[data-guide="layer.group-name"]').waitFor();
    },
  },
  {
    // the group renamed: One style still to press
    shot: 'layer-group-named',
    from: 'layer-group-menu',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      const name = seen(page, '[data-guide="layer.group-name"]');
      await name.fill(GROUP_ONE);
      await name.press('Enter');
      await layerSaved(page);
    },
  },
  {
    // One style pressed: the group's look beside Style
    shot: 'layer-group-onestyle',
    from: 'layer-group-named',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="layer.group-style"]').click();
      await seen(page, '[data-guide="layer.group-look"]').waitFor();
      await layerSaved(page);
    },
  },
  {
    // the group's palette, as it opens: one colour and its +
    shot: 'layer-group-palette',
    from: 'layer-group-onestyle',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="layer.group-look"]').click();
      await seen(page, '.float-menu[aria-label="Group style picker"] [data-guide="layer.style-more"]').waitFor();
    },
  },
  {
    // + pressed, then green: the icon still to find
    shot: 'layer-group-coloured',
    from: 'layer-group-palette',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '.float-menu[aria-label="Group style picker"] [data-guide="layer.style-more"]').click();
      await seen(page, '.float-menu[aria-label="Group style picker"] [aria-label$="more colours"] .swatch[title^="Green,"]').click();
      await layerSaved(page);
    },
  },
  {
    // harbour typed: the anchor icon still to press
    shot: 'layer-group-found',
    from: 'layer-group-coloured',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '.float-menu[aria-label="Group style picker"] [data-guide="layer.style-find"]').fill('harbour');
      await seen(page, '.float-menu[aria-label="Group style picker"] button[title="Harbour"]').waitFor();
    },
  },
  {
    // the anchor picked, the palette put away: names still off
    shot: 'layer-group-styled',
    from: 'layer-group-found',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '.float-menu[aria-label="Group style picker"] button[title="Harbour"]').click();
      await layerSaved(page);
      await seen(page, '[data-guide="layer.group-look"]').click();
      await page.waitForTimeout(300);
    },
  },
  {
    // names on, the menu put away: a feature still to pick
    shot: 'layer-grouped',
    from: 'layer-group-styled',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="layer.group-names"] input').check();
      await layerSaved(page);
      await seen(page, `button[aria-label="Settings of group ${GROUP_ONE}"]`).click();
      await page.waitForTimeout(300);
    },
  },
  {
    // a marker picked on the map: its sheet, as it opens
    shot: 'layer-sheet',
    from: 'layer-grouped',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await pickCrane(page, 2, 'Marker 3');
      await seen(page, '[data-guide="layer.sheet-sources"]').waitFor();
    },
  },
  {
    // named: how sure, its sources and its note still to set
    shot: 'layer-sheet-named',
    from: 'layer-sheet',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      const name = seen(page, '[data-guide="layer.sheet-name"]');
      await name.fill('Crane 3');
      await name.press('Enter');
      await layerSaved(page);
    },
  },
  {
    // Sources open: + Add still to press
    shot: 'layer-sheet-sources',
    from: 'layer-sheet-named',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="layer.sheet-sources"]').click();
      await seen(page, '[data-guide="layer.sheet-add-source"]').waitFor();
      await layerSaved(page);
    },
  },
  {
    // the source added: the note still to write
    shot: 'layer-sheet-sourced',
    from: 'layer-sheet-sources',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="layer.sheet-add-source"]').click();
      const address = seen(page, '[data-guide="layer.panel"] input[aria-label="New source"]');
      await address.fill('https://example.org/posts/0412');
      await address.press('Enter');
      await layerSaved(page);
    },
  },
  {
    // every feature named and described, the yard picked last, nothing picked now
    shot: 'layer-built',
    from: 'layer-sheet-sourced',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="layer.sheet-note"]').click();
      const note = seen(page, '[data-guide="layer.panel"] textarea[aria-label="Feature note"]');
      await note.fill('Ship-to-shore crane of the Evergreen terminal, in front of the bridge in the photo.');
      await note.evaluate((field) => field.blur());
      await layerSaved(page);
      for (const [index, marker] of [[0, 'Marker 1'], [1, 'Marker 2']]) await rename(page, CRANES[index], marker, `Crane ${index + 1}`);
      // the yard last, as the step says: what is added next goes into its group, Port
      await rename(page, ROUTE_MIDDLE, 'Line 1', 'Route');
      await rename(page, YARD_MIDDLE, 'Area 1', 'Yard');
      await clearPick(page);
    },
  },
  {
    // Add from the case, as it opens
    shot: 'layer-link-fresh',
    from: 'layer-built',
    after: false,
    window: WIDE,
    focus: ['[role="dialog"]'],
    async run({ go, page }) {
      // open again where the picture with no proof put it down, aimed at Port as the yard left it
      await editSurvey(go, page, GROUP_TWO);
      // the photo's proof alone among the proofs: the video's, made earlier in a whole run,
      // would come first and be the one ticked
      await page.route('**/layer-links', async (route) => {
        const rows = await (await route.fetch()).json();
        const photo = rows.find((row) => row.kind === 'proof' && row.title.includes('YM Success'))?.id;
        await route.fulfill({ json: rows.filter((row) => row.kind !== 'proof' || row.id === photo) });
      });
      await seen(page, '[data-guide="layer.link"]').click();
      await seen(page, '[data-guide="layer.link-proofs"]').waitFor();
    },
  },
  {
    // the proofs only: one to tick
    shot: 'layer-link-proofs',
    from: 'layer-link-fresh',
    after: false,
    window: WIDE,
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="layer.link-proofs"]').click();
    },
  },
  {
    // the proof ticked, Add still to press
    shot: 'layer-link',
    from: 'layer-link-proofs',
    after: false,
    window: WIDE,
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await page.locator('[data-guide="layer.link-row"]', { hasText: 'YM Success' }).locator('input').check();
    },
  },
  {
    // the proof's marker added in Port, nothing picked: the layer's ⋮ and Done
    shot: 'layer-proofed',
    from: 'layer-link',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="layer.link-add"]').click();
      await page.getByRole('dialog', { name: 'Add from the case' }).waitFor({ state: 'hidden' });
      await page.unroute('**/layer-links');
      await layerSaved(page);
      await clearPick(page);
    },
  },
  {
    // the layer's ⋮: Track over time, Download layer
    shot: 'layer-menu',
    from: 'layer-proofed',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="layer.more"]').click();
      await seen(page, '[data-guide="layer.download-item"]').waitFor();
    },
  },
  {
    // Track over time pressed: the day box on today, Previous change beside the date
    shot: 'layer-tracked',
    from: 'layer-proofed',
    after: false,
    window: DATED,
    map: true,
    crop: 'full',
    async run({ go, page }) {
      await editSurvey(go, page);
      // the menu the picture before left open is pressed in, not toggled shut
      const track = page.locator('[data-guide="layer.track-on"]').filter({ visible: true });
      if (!(await track.count())) await seen(page, '[data-guide="layer.more"]').click();
      await seen(page, '[data-guide="layer.track-on"]').click();
      await seen(page, '[data-guide="layer.previous"]').waitFor();
      await layerSaved(page);
    },
  },
  {
    // back at the last change, the proof's day: its marker on the map
    shot: 'layer-back',
    from: 'layer-tracked',
    after: false,
    window: DATED,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="layer.previous"]').click();
      await seen(page, '[data-guide="layer.today"]').waitFor();
      await seen(page, '[data-guide="layer.linked"]').waitFor();
    },
  },
  {
    // the proof's marker picked: its sheet, Still there under its name
    shot: 'layer-ship',
    from: 'layer-back',
    after: false,
    window: DATED,
    map: true,
    crop: 'full',
    async run({ page, demo }) {
      await pickProof(page, demo);
    },
  },
  {
    // the day it had left set, nothing picked: Today still to press
    shot: 'layer-ended',
    from: 'layer-ship',
    after: false,
    window: DATED,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="layer.feature-end"]').click();
      await seen(page, `.float-menu[aria-label="When it leaves the map"] button.day[title="${SHIP_GONE}"]`).click();
      await layerSaved(page);
      await clearPick(page);
      await seen(page, '[data-guide="layer.today"]').waitFor();
    },
  },
  {
    // Today pressed, the Yard picked, its corners out; the film pulls its south-east corner out
    // to where the stacks reach now, a change dated to the day shown
    shot: 'layer-yard-picked',
    from: 'layer-ended',
    after: false,
    window: DATED,
    map: true,
    crop: 'full',
    async run({ page }) {
      // back on today first: the ship gone, its row keeping its days
      await seen(page, '[data-guide="layer.today"]').click();
      await layerSaved(page);
      await pickAt(page, YARD_MIDDLE, 'Yard');
      await page.mouse.move(1, 1);
      await page.waitForTimeout(600);
    },
    film: {
      rate: '600k',
      async play({ page, frame }) {
        const { frames, take } = filmFrames(frame);
        await take(16);
        await growYard(page, take);
        await take(24);
        return frames;
      },
    },
  },
  {
    // the yard grown and let go: the past menu, right of the date, next
    shot: 'layer-yard-grown',
    from: 'layer-yard-picked',
    after: false,
    window: DATED,
    map: true,
    crop: 'full',
    async run({ page }) {
      // the corner was pulled by the film of the picture before, which plays whenever that picture is taken
      await layerSaved(page);
      await clearPick(page);
      await page.mouse.move(1, 1);
    },
  },
  {
    // Since the state before: what the yard gained hatched, its old outline dashed
    shot: 'layer-yard-hatched',
    from: 'layer-yard-grown',
    after: false,
    window: DATED,
    map: true,
    crop: 'full',
    settle: 2500,
    async run({ page }) {
      await seen(page, '[data-guide="layer.past"]').click();
      await seen(page, '[data-guide="layer.past-since"]').click();
      await page.keyboard.press('Escape');
      await page.mouse.move(1, 1);
    },
  },
  {
    // the tracked layer's ⋮: Download layer under the time settings
    shot: 'layer-menu-tracked',
    from: 'layer-yard-hatched',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="layer.more"]').click();
      await seen(page, '[data-guide="layer.download-item"]').waitFor();
    },
  },
  {
    // Download layer, the tracked layer: the day shown or every state
    shot: 'layer-export-tracked',
    from: 'layer-menu-tracked',
    after: false,
    window: WIDE,
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="layer.download-item"]').click();
      await page.getByRole('dialog', { name: 'Download layer' }).waitFor();
    },
  },
  {
    // Every state ticked: KMZ still to press
    shot: 'layer-export-history',
    from: 'layer-export-tracked',
    window: WIDE,
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="layer.export-history"] input').check();
    },
  },
  {
    // Done pressed: the layer put away, drawn under My layers in the panel on the right
    shot: 'layer-kept',
    from: 'layer-export-history',
    after: false,
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ go, page }) {
      await seen(page, '[data-guide="layer.done"]').click();
      await layersPanel(go, page);
    },
  },
  {
    // the tracked layer as it leaves the case, on today: the panel folded
    shot: 'layer-made-tracked',
    from: 'layer-kept',
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="sat.panel"] [title="Hide the panel"]').click();
    },
  },
];

export const DEFAULT_WINDOW = TOOLS;

// The plate's pictures come last, after the layer's whose survey layer they lay out.
STAGES.push(...PLATE_STAGES);

// -- an article written in the Notebook (the write-an-article journey) ---------------

/** The article the journey writes in the demo case: every word below is typed by a step that gives it. */
const ARTICLE = 'A photo of the YM Success, placed on the west bank of the Main Channel';
const ARTICLE_LEAD =
  'A photo of the container ship YM Success, posted with no caption, was taken from the west bank of the Main Channel, in the Port of Los Angeles. The bridge and the cranes behind the ship line up only from there.';
const ARTICLE_FACT = 'The photo was posted with no caption and no place ';
const ARTICLE_STERN = '. The name YM Success reads on the ship’s stern in the photo ';
/** The sentence each figure stands under, as each way to a figure types it. */
const ARTICLE_EVIDENCE = {
  table: 'Of the three ports checked, only Los Angeles has a green suspension bridge over its berths.',
  chart: 'The case holds three dated photos of this stretch of the channel, from 2006 to 2020.',
  diagram: 'The port was found in three steps.',
};
/** The ports checked, as the case's sheet rules them in and out (demo.mjs). */
const ARTICLE_TABLE = [
  ['Port', 'Green suspension bridge'],
  ['Los Angeles, Main Channel', 'Yes, the Vincent Thomas Bridge'],
  ['Charleston, Wando Welch Terminal', 'No'],
  ['Miami', 'No'],
];
const ARTICLE_MAP_TITLE = 'Where the photo was taken';
/** The proof's two points, as the geolocation journey files them: the camera on the bank, the ship in the channel. */
const ARTICLE_PROOF_LINE =
  'From high on the west bank at 33.741680, -118.279460, the bridge’s east tower stands right behind the Evergreen cranes, as in the photo. The ship is in the channel at 33.745500, -118.274000, the point the proof gives.';
/** The day as the article first states it, then as it is corrected: what its Editions compare. */
const ARTICLE_DAY_FIRST = 'The photo was taken on 3 February 2009, the day the post gives.';
const ARTICLE_DAY = 'The post gives 3 February 2009 as the day of the photo. Nothing in the photo confirms it.';
const ARTICLE_CORRECTION = 'An earlier version said the photo was taken on 3 February 2009. That day is only the one the post gives.';
const ARTICLE_METHOD =
  'The bridge and the cranes were matched by eye on USGS imagery from The National Map, which does not say when it was taken. The account’s other port photos are not checked yet.';
const ARTICLE_LINK_WORDS = 'The National Map';
const ARTICLE_LINK = 'https://www.usgs.gov/programs/national-geospatial-program/national-map';
const ARTICLE_TEAM = 'Ask the Port of Los Angeles for the YM Success’s berth dates in early 2009.';
const ARTICLE_SUBTITLE = 'Photo: posted by @harbor_watch, cited below';
/** The timeline's event left out: the photo dated twice, once as the ship, once as the camera's spot. */
const ARTICLE_CHART_UNTICK = 'The photo was taken from the west bank of the Main Channel';
/** The parts of the template the figure's other ways start again from (`lib/notes/ready.js`). */
const ARTICLE_EVIDENCE_HINT = '<!--? A picture, a map or a proof for each point, with what it shows and what it cannot. -->';
const ARTICLE_UNSETTLED = '> [!unverified] What is not settled yet.';
const ARTICLE_METHOD_HINT = '<!--? How it was checked, and what stays unknown. Every figure is a minimum. -->';
/** The window the article is written in: the note, its header whole, room for its page beside it. */
const DESK = { width: 1440, height: 860 };
/** Settings with a whole card of the site in view, its fields, its how-to and Test connection. */
const DESK_TALL = { width: 1500, height: 1100 };
/** The proof the article shows, when the case has none of its own yet. */
const ARTICLE_PROOF = 'Bridge photo proof';
/** The guide's own picture of that proof, filed as its export. */
const PROOF_PICTURE = new URL('../src/assets/guide/proof-result.webp', import.meta.url);
/** Stand-ins typed where a credential goes in the guide's throwaway workspace: they open nothing. */
const GITHUB_STAND_IN = { account: 'your-name', token: 'github_pat_guide_stand_in_opens_nothing' };
const WORDPRESS_STAND_IN = { site: 'https://example.org', user: 'editor', password: 'guide stand in opens nothing' };

/** The article's note as the Notebook's home lists it, or null before the template made it. */
async function articleNote(page, demo) {
  const { items } = await route(page, 'GET', `/api/cases/${demo.caseId}/notes/index`);
  return items.find((row) => row.title === ARTICLE) ?? null;
}

/** The article's words changed by `edit`, written back through the route the editor saves with. */
async function editArticle(page, demo, edit) {
  const note = await articleNote(page, demo);
  if (!note) throw new Error('the article is not written yet: take its pictures from article-go-map on');
  const at = `/api/cases/${demo.caseId}/notes/${note.id}`;
  const { text } = await route(page, 'GET', at);
  const next = edit(text);
  if (next !== text) await route(page, 'PUT', at, { text: next });
}

/** Once the editor has saved what was typed: the article as the case holds it matches `pattern`. */
async function articleHolds(page, demo, pattern) {
  const note = await articleNote(page, demo);
  for (let tries = 0; tries < 60; tries += 1) {
    const { text } = await route(page, 'GET', `/api/cases/${demo.caseId}/notes/${note.id}`);
    if (pattern.test(text)) {
      // and nothing more on its way
      await page.waitForTimeout(1500);
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`the article was not saved as ${pattern}`);
}

/** The Notebook opened on the article, read again from the case. */
async function openArticle(go, page) {
  await go('notebook');
  const back = page.locator('[data-guide="notebook.home"]').filter({ visible: true });
  if (await back.count()) await back.first().click();
  await seen(page, `.note-card button.open[title="Open ${ARTICLE}"]`).click();
  await seen(page, '[data-guide="notebook.write"] .cm-line').waitFor();
  await page.waitForTimeout(1200);
  await closeSidebar(page);
}

/** The note with its page drawn beside it, as Page leaves it: the journey reads the article as its reader gets it, all along. */
async function pageBeside(page) {
  const paged = page.locator('[data-guide="notebook.view"] button', { hasText: 'Page' }).filter({ visible: true });
  if (await paged.count()) await paged.first().click();
  await page.waitForTimeout(400);
}

/** A line of the note holding `words`. */
const noteLine = (page, words) => page.locator('[data-guide="notebook.write"] .cm-line', { hasText: words }).last();

/** The cursor at the end of the paragraph holding `words`. */
async function endOf(page, words) {
  const line = noteLine(page, words);
  await line.scrollIntoViewIfNeeded();
  const box = await line.boundingBox();
  await page.mouse.click(box.x + box.width - 3, box.y + box.height - 5);
  await page.keyboard.press('End');
}

/** The words of the UNVERIFIED box selected by a drag across them, its name left as it is. */
async function selectUnverified(page, words) {
  await toTop(page, '[data-guide="notebook.unverified"]', 60);
  await selectWords(page, words);
}

/**
 * The cursor on the empty line just over the UNVERIFIED box, where what comes under a
 * figure goes, and the note scrolled so that line stands near the top: what is above it,
 * a figure or a map, is out of sight, as it differs with the way taken.
 */
async function lineOverUnverified(page) {
  await toTop(page, '[data-guide="notebook.unverified"]', 240);
  const box = await seen(page, '[data-guide="notebook.unverified"]').boundingBox();
  await page.mouse.click(box.x + box.width - 3, box.y + box.height / 2);
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  // a line of its own: words typed on the blank line under a table would join the table
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await toTop(page, '[data-guide="notebook.unverified"]', 90);
}

/** The note scrolled so the element `selector` (holding `words`, when given) stands `gap` pixels under the top of the page. */
async function toTop(page, selector, gap = 40, words = '') {
  const place = () =>
    page.evaluate(
      ({ selector, gap, words }) => {
        const element = [...document.querySelectorAll(selector)]
          .filter((one) => one.getBoundingClientRect().height > 0 && (!words || one.textContent.includes(words)))
          .pop();
        const scroller = element?.closest('.cm-scroller');
        if (!element || !scroller) return false;
        scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - gap;
        return true;
      },
      { selector, gap, words }
    );
  if (!(await place())) {
    // a long note draws only the lines near the view: the end first, where these parts are
    await page.evaluate(() => {
      for (const scroller of document.querySelectorAll('[data-guide="notebook.write"] .cm-scroller')) scroller.scrollTop = scroller.scrollHeight;
    });
    await page.waitForTimeout(500);
    await place();
  }
  await page.waitForTimeout(400);
}

/** `words` selected in the note, by a drag from their first letter to their last. */
async function selectWords(page, words) {
  const box = await page.evaluate((words) => {
    const content = document.querySelector('[data-guide="notebook.text"]');
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent.indexOf(words);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + words.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    }
    return null;
  }, words);
  if (!box) throw new Error(`${words} is not in the note`);
  await page.mouse.move(box.x + 1, box.y + box.h / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w - 1, box.y + box.h / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

/** An entry of the insert menu, by its anchor: the row it frames is what takes the press. */
const insertEntry = (page, id) => page.locator('.cm-insert-menu li', { has: page.locator(`[data-guide="notebook.insert-${id}"]`) }).first();

/** An option of the @ list, by its words. */
const mentionOption = (page, words) => page.locator('.cm-tooltip-autocomplete li', { hasText: words }).first();

/**
 * The article as it stood before its figure, the grey line under What the evidence shows
 * back, for a figure's other way; then that line typed as that way types it.
 */
async function beforeFigure(go, page, demo, way) {
  await editArticle(page, demo, (text) => {
    const head = '## What the evidence shows';
    const end = text.indexOf(head);
    if (end < 0) throw new Error('the article has no evidence part');
    return `${text.slice(0, end + head.length)}\n\n${ARTICLE_EVIDENCE_HINT}\n\n${ARTICLE_UNSETTLED}\n\n## Method and limits\n\n${ARTICLE_METHOD_HINT}\n`;
  });
  await openArticle(go, page);
  await pageBeside(page);
  await page.locator('[data-guide="notebook.guidance"]').first().click();
  await page.keyboard.type(ARTICLE_EVIDENCE[way]);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

/**
 * The proof the article shows. The case's own when the geolocation's pictures were taken in
 * the same run; else one filed through the route Geo Proof saves with, the photo and the
 * capture as its panels, the tower and the cranes boxed on each, and the guide's own
 * picture of that proof as its export.
 */
async function articleProof(page, demo) {
  const proofs = await route(page, 'GET', `/api/cases/${demo.caseId}/proofs`);
  if (proofs.length) return;
  const webp = readFileSync(PROOF_PICTURE).toString('base64');
  const refused = await page.evaluate(
    async ({ caseId, webp, photo, capture, title, matches }) => {
      const load = async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        return image;
      };
      const picture = await load(`data:image/webp;base64,${webp}`);
      const canvas = document.createElement('canvas');
      canvas.width = picture.naturalWidth;
      canvas.height = picture.naturalHeight;
      canvas.getContext('2d').drawImage(picture, 0, 0);
      const png = canvas.toDataURL('image/png').split(',')[1];
      const file = (path) => `/files/${encodeURIComponent(caseId)}/${path.split('/').map(encodeURIComponent).join('/')}`;
      const [left, right] = await Promise.all([load(file(photo)), load(file(capture))]);
      const sizes = { p0: [left.naturalWidth, left.naturalHeight], p1: [right.naturalWidth, right.naturalHeight] };
      const box = (panel, [x0, y0, x1, y1], color, id) => {
        const [w, h] = sizes[panel];
        return { id, panel, kind: 'rect', color, x: x0 * w, y: y0 * h, w: (x1 - x0) * w, h: (y1 - y0) * h };
      };
      const colours = ['#ff5252', '#38bdf8'];
      const shapes = matches.flatMap((match, at) => [
        box('p0', match.photo, colours[at], `s${at}a`),
        box('p1', match.capture, colours[at], `s${at}b`),
      ]);
      const answer = await fetch(`/api/cases/${caseId}/proofs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          png_base64: png,
          spec: {
            panels: [
              { id: 'p0', src: photo, natural: sizes.p0 },
              { id: 'p1', src: capture, natural: sizes.p1 },
            ],
            shapes,
          },
        }),
      });
      return answer.ok ? '' : `${answer.status} ${await answer.text()}`;
    },
    { caseId: demo.caseId, webp, photo: demo.photo, capture: demo.capture, title: ARTICLE_PROOF, matches: MATCHES }
  );
  if (refused) throw new Error(`the article's proof was refused: ${refused}`);
}

/** The export dialog opened from the note's header, its check read. */
async function exportOpen(page) {
  await seen(page, '[data-guide="notebook.pdf"]').click();
  await page.getByRole('dialog').filter({ hasText: 'Format' }).first().waitFor();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"] .checking'), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

/** A format of the export dialog, pressed. */
async function exportAs(page, format) {
  await seen(page, `[data-guide="notebook.format-${format}"]`).click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"] .checking'), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(800);
}

/** Settings' stand-ins for GitHub and WordPress taken away again, and the guard on GitHub lifted. */
async function forgetStandIns(page) {
  await page.unroute('**/github/check').catch(() => {});
  await route(page, 'DELETE', '/api/publishing/github').catch(() => {});
  await route(page, 'DELETE', '/api/publishing/wordpress').catch(() => {});
}

/** The site Settings › Website's panels are pictured with: GitHub set up, nothing reached. */
const SITE_ADDRESS = 'https://your-name.github.io/notes/';
const SITE_GITHUB = {
  account: 'your-name',
  repo: 'notes',
  branch: 'main',
  site: '',
  token: { set: true, hint: '…k3q9' },
  website: { title: '', logo: false, counting: '' },
  categories: ['Ports', 'Shipping'],
  added: [],
};
const siteItem = (folder, title, more = {}) => ({
  folder,
  address: `${SITE_ADDRESS}${folder}/`,
  title,
  summary: '',
  date: '2026-11-20',
  date_label: '20 November 2026',
  category: '',
  role: 'article',
  layout: 'article',
  image: '',
  bytes: 2_400_000,
  deletable: true,
  ...more,
});
/** What Read the site finds on it: three articles, two pages and a draft. */
const SITE_READ = {
  ok: true,
  address: SITE_ADDRESS,
  home: 'azimut',
  bar: 'azimut',
  footer: 'none',
  items: [
    siteItem('bridge-from-both-banks', 'The bridge from both banks', { category: 'Ports', date: '2026-11-24', date_label: '24 November 2026', bytes: 6_300_000 }),
    siteItem('channel-observations', 'Channel observations', { category: 'Ports', layout: 'map', date: '2026-11-22', date_label: '22 November 2026', bytes: 1_100_000 }),
    siteItem('a-yard-grows', 'A container yard grows', { category: 'Shipping', layout: 'story', date: '2026-11-18', date_label: '18 November 2026' }),
    siteItem('about', 'About', { role: 'page', date: '2026-11-02', date_label: '2 November 2026', bytes: 40_000 }),
    siteItem('legal-notice', 'Legal notice', { role: 'page', date: '2026-11-02', date_label: '2 November 2026', bytes: 30_000 }),
    siteItem('tug-routes', 'Tug routes, a draft', { role: 'unlisted', date: '2026-11-25', date_label: '25 November 2026', bytes: 900_000 }),
  ],
  categories: [
    { name: 'Ports', count: 2, pages: [] },
    { name: 'Shipping', count: 1, pages: [] },
  ],
  marked: [],
  legal: '',
  privacy: '',
  last: { date: '2026-11-25T18:40:00Z', message: 'Publish Tug routes, a draft' },
  size: { site: 11_200_000, repository: 26_500_000 },
  old_address: 0,
  warnings: [],
};

/**
 * Settings, Website, on the panel of `tab`, for a site set up and read: GitHub's settings and Read the site
 * answered on the page, never written to the demo's settings, so no later picture finds GitHub connected.
 */
async function siteHub(go, page, tab) {
  const publishing = async (asked) => {
    if (asked.request().method() !== 'GET') return asked.fallback();
    const answer = await (await asked.fetch()).json();
    return asked.fulfill({ json: { ...answer, github: SITE_GITHUB } });
  };
  const read = (asked) => asked.fulfill({ json: SITE_READ });
  await page.route('**/api/publishing', publishing);
  await page.route('**/api/publishing/github/site/read', read);
  try {
    await go('settings');
    await page.locator('[data-guide="settings.nav"] button', { hasText: 'Website' }).first().click();
    await seen(page, '[data-guide="settings.hub-articles"]').click();
    await seen(page, '#hub-panel-articles').locator('button', { hasText: 'Read the site' }).click();
    await seen(page, '[data-guide="settings.site-articles"]').waitFor();
    await seen(page, `[data-guide="settings.hub-${tab}"]`).click();
    await closeSidebar(page);
    await page.mouse.move(1, 1);
    await page.waitForTimeout(800);
  } finally {
    await page.unroute('**/api/publishing', publishing);
    await page.unroute('**/api/publishing/github/site/read', read);
  }
}

/** Settings, Website, on the panel of `tab`, its card `card` in view. */
async function websitePanel(go, page, tab, card) {
  await go('settings');
  await page.locator('[data-guide="settings.nav"] button', { hasText: 'Website' }).first().click();
  await seen(page, `[data-guide="${tab}"]`).click();
  await seen(page, `[data-guide="${card}"]`).waitFor();
  await closeSidebar(page);
  await page.waitForTimeout(800);
}

/** A film's frames, each held, and a typing of `words` a few letters a frame. */
function articleFilm(page, frame) {
  const frames = [];
  const hold = async (count) => {
    const path = await drawn(page, frame);
    frames.push(...Array(count).fill(path));
  };
  const type = async (words, step = 6, each = 2) => {
    for (let at = 0; at < words.length; at += step) {
      await page.keyboard.type(words.slice(at, at + step));
      await hold(each);
    }
  };
  return { frames, hold, type };
}

/**
 * One sitting, taken after every other picture: the article written from Web article in
 * the demo case, each picture taken before the press it explains, every word in it typed
 * by the step that gives it. The table is the figure the article keeps; the chart and the
 * diagram come last, each from the article as it stood before its figure.
 */
const ARTICLE_STAGES = [
  {
    // Satellite on the channel, the rail the journey starts from
    shot: 'article-go-map',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ go, page }) {
      // Compose opens on Geo Proof, as it does for a reader who has not left it elsewhere
      await go('proof');
      await go(`satellite?ll=${CHANNEL.lat},${CHANNEL.lon}&z=16&p=usgs-imagery`);
      await stopHeld(page);
      const hide = page.locator('[data-guide="sat.panel"] [title="Hide the panel"]').filter({ visible: true });
      if (await hide.count()) await hide.first().click();
    },
  },
  {
    // Compose pressed: Geo Proof, the Notebook among its tabs
    shot: 'article-go-compose',
    from: 'article-go-map',
    after: false,
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="rail.compose"]').click();
      await seen(page, '[data-guide="tab.notebook"]').waitFor();
      await closeSidebar(page);
    },
  },
  {
    // the Notebook's home, Web article among the templates
    shot: 'article-home',
    from: 'article-go-compose',
    after: false,
    window: DESK,
    focus: ['[data-guide="notebook.ready"]'],
    async run({ page }) {
      await seen(page, '[data-guide="tab.notebook"]').click();
      const back = page.locator('[data-guide="notebook.home"]').filter({ visible: true });
      if (await back.count()) await back.first().click();
      const tile = seen(page, '[data-guide="notebook.start-article"]');
      await tile.waitFor();
      await tile.scrollIntoViewIfNeeded();
      // each template is shown by its first page, drawn once it comes into view
      await tile.locator('img').waitFor({ timeout: 30_000 }).catch(() => {});
      await page.locator('[data-guide="notebook.ready"] .thumb img').nth(4).waitFor({ timeout: 30_000 }).catch(() => {});
      await closeSidebar(page);
    },
  },
  {
    // Web article pressed: the note, its name selected, its parts in grey
    shot: 'article-new',
    from: 'article-home',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="notebook.start-article"]').click();
      await seen(page, '[data-guide="notebook.guidance"]').waitFor();
      await page.waitForTimeout(800);
      // the note's name stays selected through the press that puts the case panel away
      await closeSidebar(page);
      await seen(page, '[data-guide="notebook.name"]').focus();
      await seen(page, '[data-guide="notebook.name"]').selectText();
    },
  },
  {
    // the headline typed: the first grey line next
    shot: 'article-titled',
    from: 'article-new',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      const name = seen(page, '[data-guide="notebook.name"]');
      await name.fill(ARTICLE);
      await name.press('Enter');
      await page.waitForTimeout(1200);
    },
  },
  {
    // Page pressed: the article as its reader gets it, drawn beside the note
    shot: 'article-paged',
    from: 'article-titled',
    after: false,
    window: DESK,
    crop: 'full',
    settle: 4000,
    async run({ page }) {
      await seen(page, '[data-guide="notebook.view-page"]').click();
      await page.waitForFunction(() => document.querySelector('[data-guide="notebook.page"] canvas, [data-guide="notebook.page"] img'), null, { timeout: 60_000 }).catch(() => {});
    },
  },
  {
    // the lead typed; the film types the first fact and cites the post with @
    shot: 'article-lead',
    from: 'article-paged',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="notebook.guidance"]').click();
      await page.keyboard.type(ARTICLE_LEAD);
      await page.waitForTimeout(600);
    },
    film: {
      rate: '700k',
      async play({ page, frame }) {
        const { frames, hold, type } = articleFilm(page, frame);
        await hold(25);
        await seen(page, '[data-guide="notebook.guidance"]').click();
        await hold(8);
        await type(ARTICLE_FACT);
        await type('@harb', 1, 4);
        await page.waitForTimeout(600);
        await hold(25);
        const option = mentionOption(page, 'harbor_watch post');
        await option.hover();
        await hold(10);
        await option.click();
        await page.waitForTimeout(500);
        await hold(45);
        return frames;
      },
    },
  },
  {
    // the post cited, the cursor after its chip: the next fact next
    shot: 'article-fact',
    from: 'article-lead',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await page.waitForTimeout(400);
    },
  },
  {
    // the photo cited too; the cursor back beside the post's chip: its card
    shot: 'article-cited',
    from: 'article-fact',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      // the chip ends the line, so it came with no space after it
      await page.keyboard.type(ARTICLE_STERN);
      await page.keyboard.type('@bridge');
      await page.waitForTimeout(600);
      await mentionOption(page, 'bridge_channel').click();
      await page.waitForTimeout(400);
      await page.keyboard.type('.');
      // back over the full stop, the photo's chip and the words, to just after the post's chip
      for (let step = 0; step < ARTICLE_STERN.length + 2; step += 1) await page.keyboard.press('ArrowLeft');
      await seen(page, '[data-guide="notebook.cite-card"]').waitFor();
      await page.waitForTimeout(600);
    },
  },
  {
    // the grey line under What the evidence shows: where each figure's sentence goes
    shot: 'article-evidence-grey',
    from: 'article-cited',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await page.keyboard.press('Escape');
      await seen(page, '[data-guide="notebook.guidance"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    },
  },
  {
    // the table's sentence typed, then /tab: Table in the menu
    shot: 'article-insert-table',
    from: 'article-evidence-grey',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await page.locator('[data-guide="notebook.guidance"]').first().click();
      await page.keyboard.type(ARTICLE_EVIDENCE.table);
      await page.keyboard.press('Enter');
      await page.keyboard.type('/tab');
      await insertEntry(page, 'table').waitFor();
      await page.waitForTimeout(500);
    },
  },
  {
    // Table pressed: its size, a square a cell
    shot: 'article-table-size',
    from: 'article-insert-table',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await insertEntry(page, 'table').click();
      await seen(page, '[data-guide="notebook.table-size"]').waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    // two columns by three rows: the empty table, the cursor in its first cell
    shot: 'article-table-empty',
    from: 'article-table-size',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="notebook.table-size"] span[data-row="3"][data-col="2"]').click();
      await seen(page, '[data-guide="notebook.table"]').waitFor();
      await page.waitForTimeout(600);
    },
  },
  {
    // the cells typed, the table left, the cursor on the empty line under it: a map?
    shot: 'article-after-figure',
    from: 'article-table-empty',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page, demo }) {
      const cells = ARTICLE_TABLE.flat();
      for (const [at, words] of cells.entries()) {
        await page.keyboard.type(words);
        if (at < cells.length - 1) await page.keyboard.press('Tab');
      }
      await page.keyboard.press('Escape');
      await articleHolds(page, demo, /Vincent Thomas Bridge[\s\S]*Miami/);
      await lineOverUnverified(page);
    },
  },
  {
    // /map typed on that line: Interactive map in the menu
    shot: 'article-insert-map',
    from: 'article-after-figure',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await page.keyboard.type('/map');
      await insertEntry(page, 'map').waitFor();
      await page.waitForTimeout(500);
    },
  },
  {
    // Interactive map pressed: its title first
    shot: 'article-map-picker',
    from: 'article-insert-map',
    after: false,
    window: DESK,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await insertEntry(page, 'map').click();
      await seen(page, '[data-guide="notebook.map-layer"]').waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    // the title typed: the layers next
    shot: 'article-map-titled',
    from: 'article-map-picker',
    after: false,
    window: DESK,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="notebook.map-title"]').fill(ARTICLE_MAP_TITLE);
      await page.waitForTimeout(300);
    },
  },
  {
    // Channel observations ticked: the ground next
    shot: 'article-map-ticked',
    from: 'article-map-titled',
    after: false,
    window: DESK,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="notebook.map-layer"]:has-text("Channel observations") input').check();
      await page.waitForTimeout(300);
    },
  },
  {
    // USGS Imagery picked for its ground: Put the map next
    shot: 'article-map-ground',
    from: 'article-map-ticked',
    after: false,
    window: DESK,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="notebook.map-ground"]').selectOption({ label: 'USGS Imagery' });
      await page.waitForTimeout(300);
    },
  },
  {
    // the map put; the cursor on the empty line under it, the line near the top
    shot: 'article-proof-line',
    from: 'article-map-ground',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ go, page, demo }) {
      await seen(page, '[data-guide="notebook.map-put"]').click();
      await page.getByRole('dialog', { name: 'Interactive map' }).waitFor({ state: 'detached', timeout: 60_000 });
      await articleHolds(page, demo, /::: map/);
      await articleProof(page, demo);
      // read again, so the picture menu lists the proof
      await openArticle(go, page);
      await pageBeside(page);
      await lineOverUnverified(page);
      // the map just put stays in sight above the line
      await toTop(page, '[data-guide="notebook.write"] .cm-map-block', 16);
    },
  },
  {
    // what the proof shows typed: the picture icon next
    shot: 'article-proof-icon',
    from: 'article-proof-line',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await page.keyboard.type(ARTICLE_PROOF_LINE);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
      await toTop(page, '[data-guide="notebook.write"] .cm-map-block', 16);
    },
  },
  {
    // the picture icon pressed, proof typed: the case's proofs
    shot: 'article-picture-menu',
    from: 'article-proof-icon',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="notebook.picture"]').click();
      await seen(page, '.picture-menu input').fill('proof');
      await seen(page, '[data-guide="notebook.picture-proof"]').waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    // the proof in the article, under its sentence
    shot: 'article-proof',
    from: 'article-picture-menu',
    after: false,
    window: DESK,
    crop: 'full',
    settle: 2500,
    async run({ page }) {
      await seen(page, '[data-guide="notebook.picture-proof"]').click();
      await page.waitForTimeout(1500);
      await toTop(page, '[data-guide="notebook.write"] .cm-line', 40, 'From high on the west bank');
    },
  },
  {
    // the UNVERIFIED box, its words still the template's
    shot: 'article-limits',
    from: 'article-proof',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await toTop(page, '[data-guide="notebook.unverified"]', 60);
    },
  },
  {
    // the day typed in it: the grey line under Method and limits next
    shot: 'article-limits-method',
    from: 'article-limits',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page, demo }) {
      await selectUnverified(page, 'What is not settled yet.');
      await page.keyboard.type(ARTICLE_DAY_FIRST);
      await articleHolds(page, demo, /\[!unverified\] The photo was taken on 3 February 2009/);
      await toTop(page, '[data-guide="notebook.unverified"]', 60);
    },
  },
  {
    // the method typed, The National Map selected: the bar over it
    shot: 'article-link-select',
    from: 'article-limits-method',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await page.locator('[data-guide="notebook.guidance"]').first().click();
      await page.keyboard.type(ARTICLE_METHOD);
      await page.waitForTimeout(500);
      await selectWords(page, ARTICLE_LINK_WORDS);
      await seen(page, '[data-guide="notebook.bubble-link"]').waitFor();
    },
  },
  {
    // Link pressed, the address pasted: not in the case, so Link
    shot: 'article-link-field',
    from: 'article-link-select',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="notebook.bubble-link"]').click();
      await page.waitForTimeout(400);
      await page.keyboard.type(ARTICLE_LINK);
      await seen(page, '[data-guide="notebook.link-go"]').waitFor();
      await page.waitForTimeout(600);
    },
  },
  {
    // the link written; the cursor on an empty line at the end: the line for the team next
    shot: 'article-team-line',
    from: 'article-link-field',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page, demo }) {
      await seen(page, '[data-guide="notebook.link-go"]').click();
      await articleHolds(page, demo, /\[The National Map\]\(https:/);
      await endOf(page, 'other port photos');
      // a paragraph of its own: a blank line between
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
    },
  },
  {
    // that line typed and selected: Internal in the bar over it
    shot: 'article-internal',
    from: 'article-team-line',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page, demo }) {
      await page.keyboard.type(ARTICLE_TEAM);
      await articleHolds(page, demo, /other port photos are not checked yet\.\n\n+Ask the Port/);
      await page.keyboard.press('End');
      await page.keyboard.press('Shift+Home');
      await seen(page, '[data-guide="notebook.bubble-internal"]').waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    // Internal pressed: the line in its colour; Look next
    shot: 'article-look',
    from: 'article-internal',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="notebook.bubble-internal"]').click();
      await page.keyboard.press('End');
      await page.waitForTimeout(800);
    },
  },
  {
    // Look pressed: its Style tab, Web article picked
    shot: 'article-look-style',
    from: 'article-look',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="notebook.look"]').click();
      await seen(page, '[data-guide="notebook.look-cover"]').waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    shot: 'article-look-cover',
    from: 'article-look-style',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="notebook.look-cover"]').click();
      await seen(page, '[data-guide="notebook.cover-style"]').waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    // The style's pressed: the subtitle first
    shot: 'article-look-styled',
    from: 'article-look-cover',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="notebook.cover-style"]').click();
      await seen(page, '[data-guide="notebook.cover-subtitle"]').waitFor();
      await page.waitForTimeout(600);
    },
  },
  {
    // the credit typed as the subtitle: Choose a picture next
    shot: 'article-look-subtitled',
    from: 'article-look-styled',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      const subtitle = seen(page, '[data-guide="notebook.cover-subtitle"]');
      await subtitle.fill(ARTICLE_SUBTITLE);
      await subtitle.press('Enter');
      await page.waitForTimeout(600);
    },
  },
  {
    shot: 'article-look-pictures',
    from: 'article-look-subtitled',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="notebook.cover-picture"]').click();
      await page.getByPlaceholder('Find a picture…').filter({ visible: true }).first().fill('bridge');
      await seen(page, '[data-guide="notebook.cover-pick"]').waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    // the photo on the cover, Look closed: Page next
    shot: 'article-look-done',
    from: 'article-look-pictures',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="notebook.cover-pick"]').click();
      await page.waitForTimeout(600);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
    },
  },
  {
    // HTML pressed: the web page, its edition Internal still
    shot: 'article-page-html',
    from: 'article-look-done',
    after: false,
    window: DESK,
    crop: 'full',
    settle: 6000,
    async run({ page }) {
      await seen(page, '[data-guide="notebook.page-html"]').click();
      await seen(page, '[data-guide="notebook.page"] iframe.shown').waitFor({ timeout: 60_000 });
    },
  },
  {
    // Public pressed: the web page as readers outside the team get it, the header's count to check
    shot: 'article-page-public',
    from: 'article-page-html',
    after: false,
    window: DESK,
    crop: 'full',
    settle: 6000,
    async run({ page }) {
      await seen(page, '[data-guide="notebook.page-public"]').click();
      await page.waitForTimeout(1500);
      await seen(page, '[data-guide="notebook.page"] iframe.shown').waitFor({ timeout: 60_000 });
      await seen(page, '[data-guide="notebook.ready-badge"]').waitFor({ timeout: 30_000 });
    },
  },
  {
    // the count pressed: Ready to publish?, each line with its fix
    shot: 'article-ready',
    from: 'article-page-public',
    after: false,
    window: DESK,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="notebook.ready-badge"]').click();
      await seen(page, '[data-guide="notebook.ready-archive"]').waitFor({ timeout: 30_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    // Archive every link… pressed: what it would send, before anything goes. Nothing is sent here.
    shot: 'article-archive',
    from: 'article-ready',
    window: DESK,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="notebook.ready-archive"]').click();
      await page.waitForFunction(() => document.querySelector('[data-guide="notebook.archive-go"]:not([disabled])'), null, { timeout: 30_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    // Export pressed: it opens on PDF, the edition asked since the article holds an internal passage
    shot: 'article-export',
    from: 'article-archive',
    after: false,
    window: DESK,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ page }) {
      // the archive dialog was left without sending anything
      if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      await exportOpen(page);
      if ((await seen(page, '[data-guide="notebook.format-pdf"]').getAttribute('aria-pressed')) !== 'true') await exportAs(page, 'pdf');
    },
  },
  {
    // Public pressed: Export PDF next
    shot: 'article-export-public',
    from: 'article-export',
    after: false,
    window: DESK,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="notebook.edition-public"]').click();
      await page.waitForTimeout(800);
    },
  },
  {
    // Export PDF pressed, the article's first public edition written; then Web folder, GitHub not connected
    shot: 'article-export-web',
    from: 'article-export-public',
    after: false,
    window: DESK,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="notebook.export-go"]').click();
      await page.getByRole('dialog').filter({ hasText: 'Format' }).first().waitFor({ state: 'detached', timeout: 120_000 });
      await page.waitForTimeout(800);
      await exportOpen(page);
      await exportAs(page, 'web');
      await seen(page, '[data-guide="notebook.publish"]').waitFor();
    },
  },
  {
    // Publish pressed with nothing connected: the way to Settings
    shot: 'article-export-setup',
    from: 'article-export-web',
    after: false,
    window: DESK,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="notebook.publish"]').click();
      await seen(page, '[data-guide="notebook.website-open"]').waitFor();
      await seen(page, '[data-guide="notebook.website-open"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    },
  },
  {
    // Settings, Website: its panels in tabs
    shot: 'article-website',
    from: 'article-export-setup',
    after: false,
    window: LARGE,
    focus: ['[data-guide="settings.website"]'],
    async run({ page }) {
      await seen(page, '[data-guide="notebook.website-open"]').click();
      await seen(page, '[data-guide="settings.hub-hosting"]').waitFor();
      await closeSidebar(page);
      await page.waitForTimeout(800);
    },
  },
  {
    // Hosting pressed: the GitHub Pages card whole, its fields, its how-to and Test connection
    shot: 'article-hosting',
    from: 'article-website',
    after: false,
    window: DESK_TALL,
    focus: ['[data-guide="settings.github"]'],
    async run({ page }) {
      await seen(page, '[data-guide="settings.hub-hosting"]').click();
      await seen(page, '[data-guide="settings.github"]').waitFor();
      await seen(page, '[data-guide="settings.github"]').evaluate((card) => card.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(600);
    },
  },
  {
    // Hosting once GitHub is filled in, with stand-ins that open nothing: the rail back to the article
    shot: 'article-hosting-set',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    async run({ go, page }) {
      await route(page, 'PUT', '/api/publishing/github', GITHUB_STAND_IN);
      await websitePanel(go, page, 'settings.hub-hosting', 'settings.github');
    },
  },
  {
    // GitHub connected, with stand-ins that open nothing: On the site, and Publish to GitHub Pages
    shot: 'article-export-github',
    // the dialog grows with the site's choices: tall enough for its foot
    window: { width: 1400, height: 1020 },
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ go, page }) {
      await route(page, 'PUT', '/api/publishing/github', GITHUB_STAND_IN);
      // what the address holds on GitHub is read as the dialog opens: answered here, never asked
      await page.route('**/github/check', (asked) => asked.fulfill({ json: { checked: false, exists: false, edited: false, warning: '' } }));
      await openArticle(go, page);
      await exportOpen(page);
      if ((await seen(page, '[data-guide="notebook.format-web"]').getAttribute('aria-pressed')) !== 'true') await exportAs(page, 'web');
      await page.waitForFunction(() => document.querySelector('[data-guide="notebook.publish"].btn-primary'), null, { timeout: 20_000 });
      await page.waitForTimeout(1500);
    },
  },
  {
    // WordPress draft pressed, no site connected: the way to Settings
    shot: 'article-export-wp',
    window: DESK,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ go, page }) {
      await forgetStandIns(page);
      await openArticle(go, page);
      await exportOpen(page);
      await exportAs(page, 'wordpress');
      await seen(page, '[data-guide="notebook.website-open"]').waitFor();
    },
  },
  {
    // Settings, Website, WordPress: the card whole, its fields, its how-to and Test connection
    shot: 'article-wordpress',
    from: 'article-export-wp',
    after: false,
    window: DESK_TALL,
    focus: ['[data-guide="settings.wordpress"]'],
    async run({ page }) {
      await seen(page, '[data-guide="notebook.website-open"]').click();
      await closeSidebar(page);
      await seen(page, '[data-guide="settings.hub-wordpress"]').click();
      await seen(page, '[data-guide="settings.wordpress"]').waitFor();
      await seen(page, '[data-guide="settings.wordpress"]').evaluate((card) => card.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(600);
    },
  },
  {
    // WordPress once filled in, with stand-ins: the rail back to the article
    shot: 'article-wordpress-set',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    async run({ go, page }) {
      await route(page, 'PUT', '/api/publishing/wordpress', WORDPRESS_STAND_IN);
      await websitePanel(go, page, 'settings.hub-wordpress', 'settings.wordpress');
    },
  },
  {
    // a site connected, with stand-ins: what the draft takes, and Send as a draft. Its check reaches nothing.
    shot: 'article-export-wp-set',
    window: DESK,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ go, page }) {
      await route(page, 'PUT', '/api/publishing/wordpress', WORDPRESS_STAND_IN);
      await openArticle(go, page);
      await exportOpen(page);
      if ((await seen(page, '[data-guide="notebook.format-wordpress"]').getAttribute('aria-pressed')) !== 'true') await exportAs(page, 'wordpress');
      await page.waitForFunction(() => document.querySelector('[data-guide="notebook.send-draft"]:not([disabled])'), null, { timeout: 30_000 });
      await page.waitForTimeout(800);
    },
  },
  {
    // after its first public edition: the day in the UNVERIFIED box, as first stated
    shot: 'article-correct',
    from: 'article-export-wp-set',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ go, page, demo }) {
      await forgetStandIns(page);
      const note = await articleNote(page, demo);
      const { editions } = await route(page, 'GET', `/api/cases/${demo.caseId}/notes/${note.id}/editions`);
      // taken alone, without the PDF branch's own press: that edition made here the same way
      if (!editions.some((one) => one.edition === 'public')) {
        const at = `/api/cases/${demo.caseId}/notes`;
        await route(page, 'POST', `${at}/pdf/diagrams`, { notes: [note.id], edition: 'public' });
        await route(page, 'POST', `${at}/pdf`, { notes: [note.id], diagrams: {}, edition: 'public' });
      }
      await openArticle(go, page);
      await pageBeside(page);
      await toTop(page, '[data-guide="notebook.unverified"]', 60);
    },
  },
  {
    // the day corrected in the note: More next
    shot: 'article-corrected',
    from: 'article-correct',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page, demo }) {
      await selectUnverified(page, ARTICLE_DAY_FIRST);
      await page.keyboard.type(ARTICLE_DAY);
      await articleHolds(page, demo, /\[!unverified\] The post gives 3 February 2009[^\n]*Nothing in the photo confirms it/);
      await page.keyboard.press('End');
      await toTop(page, '[data-guide="notebook.unverified"]', 60);
    },
  },
  {
    shot: 'article-more',
    from: 'article-corrected',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="notebook.more"]').click();
      await seen(page, '[data-guide="notebook.editions"]').waitFor();
    },
  },
  {
    // Editions pressed: the PDF, What changed over it
    shot: 'article-editions',
    from: 'article-more',
    after: false,
    window: DESK,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="notebook.editions"]').click();
      await page.waitForFunction(() => document.querySelector('[data-guide="notebook.compare"]:not([disabled])'), null, { timeout: 20_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    // Compare pressed: the day, struck and written again
    shot: 'article-compare',
    from: 'article-editions',
    after: false,
    window: DESK,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="notebook.compare"]').click();
      await seen(page, '[data-guide="notebook.correction"]').waitFor({ timeout: 20_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    // the line drafted from the comparison, to type over
    shot: 'article-correction',
    from: 'article-compare',
    after: false,
    window: DESK,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="notebook.correction"]').click();
      await seen(page, '[data-guide="notebook.correction-line"]').waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    // the line a reader needs, typed: Export with this line… next
    shot: 'article-correction-typed',
    from: 'article-correction',
    after: false,
    window: DESK,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="notebook.correction-line"]').fill(ARTICLE_CORRECTION);
      await page.waitForTimeout(400);
    },
  },
  {
    // the export on an HTML page, the line in What changed: Export HTML next
    shot: 'article-export-corrected',
    from: 'article-correction-typed',
    after: false,
    window: DESK,
    clip: '.shell',
    focus: ['[role="dialog"]'],
    async run({ page }) {
      await seen(page, '[data-guide="notebook.correction-export"]').click();
      await page.getByRole('dialog').filter({ hasText: 'Format' }).first().waitFor();
      await page.waitForFunction(() => !document.querySelector('[role="dialog"] .checking'), null, { timeout: 30_000 }).catch(() => {});
      await seen(page, '[data-guide="notebook.export-go"]').waitFor();
      await page.waitForTimeout(800);
    },
  },
  {
    // Export HTML pressed; the page it wrote, opened as its reader opens it, at its end
    shot: 'article-result',
    from: 'article-export-corrected',
    after: false,
    window: { width: 1500, height: 1000 },
    clip: '#guide-result',
    crop: 'full',
    settle: 4000,
    async run({ page, demo }) {
      await seen(page, '[data-guide="notebook.export-go"]').click();
      await page.getByRole('dialog').filter({ hasText: 'Format' }).first().waitFor({ state: 'detached', timeout: 120_000 });
      const note = await articleNote(page, demo);
      const { editions } = await route(page, 'GET', `/api/cases/${demo.caseId}/notes/${note.id}/editions`);
      const written = editions.filter((one) => one.format === 'html').sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
      if (!written) throw new Error('no HTML page was written');
      const folder = written.folder && written.folder !== 'exports' ? null : 'exports';
      if (!folder) throw new Error(`the HTML page was written outside the case: ${written.folder}`);
      // the page where it was written, so its map and its pictures load from beside it
      await page.goto(new URL(`/files/${encodeURIComponent(demo.caseId)}/exports/${encodeURIComponent(written.file)}`, page.url()).href, { waitUntil: 'load' });
      await page.locator('.maplibregl-map canvas').first().waitFor({ timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2500);
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        const frame = document.createElement('div');
        frame.id = 'guide-result';
        Object.assign(frame.style, { position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh', pointerEvents: 'none' });
        document.body.append(frame);
      });
    },
    // the page scrolled from its headline to its corrections, held on its map, which is dragged a little: it is live
    film: {
      rate: '900k',
      async play({ page, frame }) {
        const { frames, take } = filmFrames(frame);
        await take(30);
        const { end, map } = await page.evaluate(() => {
          const found = document.querySelector('.maplibregl-map');
          return {
            end: document.documentElement.scrollHeight - innerHeight,
            map: found ? Math.max(0, found.getBoundingClientRect().top + scrollY - 120) : null,
          };
        });
        const scrollTo = async (to) => {
          let at = await page.evaluate(() => scrollY);
          while (Math.abs(to - at) > 1) {
            at += Math.sign(to - at) * Math.min(48, Math.abs(to - at));
            await page.evaluate((y) => window.scrollTo(0, y), at);
            await take();
          }
        };
        if (map !== null && map < end) {
          await scrollTo(map);
          await take(20);
          const box = await page.locator('.maplibregl-map').first().boundingBox();
          if (box) {
            const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
            await page.mouse.move(x, y);
            await page.mouse.down();
            for (let step = 1; step <= 16; step += 1) {
              await page.mouse.move(x - step * 9, y - step * 3);
              await take();
            }
            await page.mouse.up();
            await page.mouse.move(1, 1);
          }
          await take(24);
        }
        await scrollTo(end);
        await take(36);
        return frames;
      },
    },
    // back in the app: the page written is a file of its own, which asks the app nothing
    async after({ page }) {
      await page.goBack({ waitUntil: 'load' });
      await page.waitForTimeout(1500);
    },
  },
  {
    // the chart's way, from the article before its figure: its sentence typed; the film inserts a chart with /
    shot: 'article-chart-evidence',
    from: 'article-result',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ go, page, demo }) {
      await beforeFigure(go, page, demo, 'chart');
    },
    film: {
      rate: '700k',
      async play({ page, frame }) {
        const { frames, hold, type } = articleFilm(page, frame);
        await hold(25);
        await page.keyboard.type('/');
        await page.waitForTimeout(400);
        await hold(20);
        await type('chart', 1, 4);
        await page.waitForTimeout(400);
        await hold(20);
        const chart = insertEntry(page, 'chart');
        await chart.hover();
        await hold(8);
        await chart.click();
        await seen(page, '[data-guide="notebook.chart-timeline"]').waitFor();
        await page.waitForTimeout(800);
        await hold(45);
        return frames;
      },
    },
  },
  {
    // Chart pressed: the kinds, from scratch since the article has no table
    shot: 'article-chart-kinds',
    from: 'article-chart-evidence',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="notebook.chart-timeline"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    },
  },
  {
    // Timeline pressed: its form, empty, on the chart
    shot: 'article-chart-form',
    from: 'article-chart-kinds',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="notebook.chart-timeline"]').click();
      await seen(page, '[data-guide="notebook.chart-fill"]').waitFor();
      await page.waitForTimeout(600);
    },
  },
  {
    // Fill from the case pressed: what the case dates, ticked
    shot: 'article-chart-fill',
    from: 'article-chart-form',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="notebook.chart-fill"]').click();
      await page.waitForFunction(() => document.querySelector('[data-guide="notebook.fill-add"]:not([disabled])'), null, { timeout: 20_000 });
      await seen(page, '[data-guide="notebook.fill-add"]').scrollIntoViewIfNeeded();
      await page.locator('.cf-fill-list input').first().blur().catch(() => {});
      await page.waitForTimeout(600);
    },
  },
  {
    // the photo dated twice left out, three events added: the timeline drawn, its Source still empty
    shot: 'article-chart-added',
    from: 'article-chart-fill',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ page }) {
      await page.locator('.cf-fill-item', { hasText: ARTICLE_CHART_UNTICK }).locator('input').uncheck();
      await seen(page, '[data-guide="notebook.fill-add"]').click();
      await seen(page, '[data-guide="notebook.chart-source"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(1500);
    },
  },
  {
    // the diagram's way, from the article before its figure: its sentence typed, then /diag
    shot: 'article-insert-diagram',
    from: 'article-chart-added',
    after: false,
    window: DESK,
    crop: 'full',
    async run({ go, page, demo }) {
      // the chart's events saved before the article goes back to before its figure
      await articleHolds(page, demo, /::: chart[\s\S]*A ship leaves/);
      await beforeFigure(go, page, demo, 'diagram');
      await page.keyboard.type('/diag');
      await insertEntry(page, 'diagram').waitFor();
      await page.waitForTimeout(500);
    },
  },
  {
    // Diagram pressed: its kinds, each drawn small
    shot: 'article-diagram-kinds',
    from: 'article-insert-diagram',
    after: false,
    window: DESK,
    crop: 'full',
    settle: 2500,
    async run({ page }) {
      await insertEntry(page, 'diagram').click();
      await seen(page, '[data-guide="notebook.diagram-flow"]').waitFor();
      await page.waitForTimeout(1500);
    },
  },
  {
    // Flow pressed: its example drawn, its form open on it
    shot: 'article-diagram-form',
    from: 'article-diagram-kinds',
    window: DESK,
    crop: 'full',
    settle: 2500,
    async run({ page }) {
      await seen(page, '[data-guide="notebook.diagram-flow"]').click();
      await seen(page, '[data-guide="notebook.diagram-form"]').waitFor();
      await page.waitForTimeout(1500);
    },
  },
];

// The article's pictures come after the plate's: the case they are taken in holds all the rest.
STAGES.push(...ARTICLE_STAGES);

// -- Search with Find, the journey: one sitting from the rail to the place confirmed ----
// The 1901 photo of Half Dome traced, marked and searched for as the walk says, each
// picture taken before the press it explains, the films over the photo or the map only.
// The setup is the one docs/FIND.md reports, and the search it runs files the example.

/** Find's three columns side by side, the photo column enlarged wider than tall. */
const FIND_WIN = { width: 1480, height: 900 };
/** The photo column, which the tracing pictures are cut to. */
const FIND_PHOTO = '[data-guide="find.photo"]';
/** The area round the valley and its rims, as the example search asked it (src/lib/findExample.json). */
const FIND_CORNERS = [
  { lat: 37.766, lon: -119.6236 },
  { lat: 37.7701, lon: -119.5185 },
  { lat: 37.6873, lon: -119.5144 },
  { lat: 37.6832, lon: -119.6195 },
];
/** The map's zoom the area is drawn at: a place answers at 15, and the walk scrolls out to the valley. */
const FIND_ZOOM = 12;
/** Where the map's search answered Half Dome, read off the answer as it came. */
let findAnswer = null;

/** A frame once the page has drawn what the last move changed, held `hold` frames of the film. */
async function shown(page, take, hold = 1) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await take(hold);
}

/** A tool of the photo's bar pressed, by the name it is read by. */
async function photoTool(page, name) {
  await seen(page, `${FIND_PHOTO} button[aria-label="${name}"]`).click();
}

/** Where a point of the 1901 photo's own pixels lies on the page, the photo whole in its column. */
async function photoPoint(page) {
  const box = await seen(page, `${FIND_PHOTO} .fp`).boundingBox();
  const [width, height] = HALF_DOME_1901.size;
  const w = Math.min(box.width, (box.height * width) / height);
  const h = (w * height) / width;
  return ([x, y]) => [box.x + (box.width - w) / 2 + (x / width) * w, box.y + (box.height - h) / 2 + (y / height) * h];
}

/**
 * Lines drawn along the photo as seen, a stretch at a time, a frame every few points so
 * the line is seen to grow; Alt keeps the magnet from moving a line onto another edge.
 */
async function drawAlong(page, take, lines, every = 2) {
  const at = await photoPoint(page);
  await page.keyboard.down('Alt');
  for (const line of lines) {
    const [first, ...rest] = line.map(at);
    await page.mouse.move(...first);
    await page.mouse.down();
    for (const [index, point] of rest.entries()) {
      await page.mouse.move(...point, { steps: 3 });
      if (index % every === every - 1 || index === rest.length - 1) await shown(page, take);
    }
    await page.mouse.up();
    await shown(page, take, 8);
  }
  await page.keyboard.up('Alt');
}

/** The distances ticked over the photo set to `wanted`, a frame after each chip pressed. */
async function bandsTo(page, take, wanted) {
  const chips = seen(page, FIND_PHOTO).locator('[aria-label="How far the line stands"] button');
  for (const chip of await chips.all()) {
    const on = (await chip.getAttribute('aria-pressed')) === 'true';
    if (on === wanted.includes((await chip.textContent()).trim())) continue;
    await chip.click();
    await shown(page, take, 5);
  }
}

/** A line of the photo clicked, at its middle unless told where, as a mark is laid on it. */
async function clickLine(page, take, line, { hold = 10, index = Math.floor(line.length / 2) } = {}) {
  const at = await photoPoint(page);
  await page.mouse.click(...at(line[index]));
  await shown(page, take, hold);
}

/** Where `point` is drawn on Find's map, which stands on the answer at `FIND_ZOOM`. */
async function onFindMap(page, point) {
  const box = await seen(page, '[data-guide="find.map"]').boundingBox();
  const size = 256 * 2 ** FIND_ZOOM;
  const [middle, there] = [mercator(findAnswer), mercator(point)];
  return { x: box.x + box.width / 2 + (there.x - middle.x) * size, y: box.y + box.height / 2 + (there.y - middle.y) * size };
}

/** The steps column scrolled so `anchor` stands in it whole. */
async function stepsTo(page, anchor) {
  await seen(page, `[data-guide="${anchor}"]`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
}

/** A suspect checked by eye before any search, and a wrong one: Olmsted Point, across the range from the Dome. */
const FIND_SUSPECT = '37.8104, -119.4851';
/** Where the map is taken for the area searched with no name: over the range, a few steps out. */
const FIND_RANGE = '37.73, -119.56';
/**
 * Where the Map stands as the walk begins, so Find's map opens there: over the Sierra
 * Nevada, the photo's own mountains, far enough out to name no answer. A coordinate
 * searched answers at zoom 15, so taking it back there is six steps out.
 */
const FIND_OPEN = { lat: 37.8, lon: -119.45, zoom: 9 };

/** The setup's photo column, its tool pressed by name and the page let draw it. */
async function pressPhotoTool(page, name) {
  await photoTool(page, name);
  await page.mouse.move(1, 1);
  await page.waitForTimeout(400);
}

/** A press in the steps column on a button of a framed row, by its words. */
async function pressIn(page, anchor, words) {
  await seen(page, `[data-guide="${anchor}"]`).getByRole('button', { name: words, exact: true }).click();
  await page.waitForTimeout(300);
}

/** A photo still: the setup's column at the size the tracing pictures share. */
const photoStill = (shot, from, run = async ({ page }) => page.waitForTimeout(300)) => ({
  shot,
  from,
  after: false,
  window: FIND_WIN,
  clip: FIND_PHOTO,
  crop: 'full',
  run,
});

/** Find whole, as the steps after the photo show it. */
const findStill = (shot, from, run, extra = {}) => ({ shot, from, after: false, window: FIND_WIN, crop: 'full', map: true, run, ...extra });

const FIND_STAGES = [
  {
    // Media, the rail on its left: where the reader stands before the walk. The Map left
    // on Satellite over the Sierra, so Horizon opens its map there as a reader's would.
    shot: 'find-go-home',
    window: FIND_WIN,
    clip: '.shell',
    crop: 'full',
    async run({ go, page, demo }) {
      await go(`satellite?ll=${FIND_OPEN.lat},${FIND_OPEN.lon}&z=${FIND_OPEN.zoom}&p=usgs-imagery`);
      await stopHeld(page);
      // no bench left by an earlier picture: Horizon opens on its map, nothing laid
      await route(page, 'DELETE', `/api/cases/${demo.caseId}/horizon/work`).catch(() => {});
      await page.evaluate(() => localStorage.removeItem('azimut.find.layout'));
      // left by the rail rather than a reload, so the Map comes back where it was
      await seen(page, '[data-guide="rail.collect"]').click();
      await closeSidebar(page);
    },
  },
  {
    // Map pressed: Satellite, the Map's tabs over it
    shot: 'find-go-map',
    from: 'find-go-home',
    after: false,
    window: FIND_WIN,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ page }) {
      await seen(page, '[data-guide="rail.map"]').click();
      await seen(page, '[data-guide="tab.horizon"]').waitFor();
      await closeSidebar(page);
    },
  },
  {
    // the Horizon tab pressed: no viewpoint yet, its modes at the top
    shot: 'find-go-horizon',
    from: 'find-go-map',
    after: false,
    window: FIND_WIN,
    clip: '.shell',
    crop: 'full',
    map: true,
    async run({ page }) {
      await seen(page, '[data-guide="tab.horizon"]').click();
      await seen(page, '[data-guide="horizon.find"]').waitFor();
      // the map's ground set to the relief, which may be shown, before any picture of it
      await seen(page, '[data-guide="horizon.map"] button[aria-label="Map layers"]').click();
      await page.locator('#hz-map-layers button', { hasText: 'Topographic' }).click();
      await seen(page, '[data-guide="horizon.map"] button[aria-label="Map layers"]').click();
    },
  },
  {
    // Find pressed with no photo laid: it asks for one first
    shot: 'find-go-pick',
    from: 'find-go-horizon',
    after: false,
    window: FIND_WIN,
    clip: 'body',
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="horizon.find"]').click();
      await seen(page, '[data-guide="picker.search"]').waitFor();
      await page.waitForTimeout(1200);
    },
  },
  {
    // a few letters of its name: the one photo left
    shot: 'find-go-typed',
    from: 'find-go-pick',
    after: false,
    window: FIND_WIN,
    clip: 'body',
    crop: 'full',
    async run({ page }) {
      await seen(page, '[data-guide="picker.search"] input').fill('half');
      await seen(page, '[data-guide="picker.first"]').waitFor();
      await page.waitForTimeout(800);
    },
  },
  findStill('find-photo', 'find-go-typed', async ({ page }) => {
    // the photo picked: Find, the photo, the map and the steps. The map's ground set to
    // the relief, which may be shown, before any picture of it
    await seen(page, '[data-guide="picker.first"]').click();
    await seen(page, '[data-guide="find.canvas"]').waitFor();
    await seen(page, '[data-guide="find.map"] button[aria-label="Map layers"]').click();
    await page.locator('#hz-find-layers button', { hasText: 'Topographic' }).click();
    await seen(page, '[data-guide="find.map"] button[aria-label="Map layers"]').click();
  }),
  // -- the way round Find for a skyline it cannot read: a suspect looked at by eye ------
  findStill('find-eye-pick', 'find-photo', async ({ page }) => {
    // Overlay pressed: it asks where to stand
    await seen(page, '[data-guide="find.overlay"]').click();
    await seen(page, '[data-guide="horizon.map"]').waitFor();
  }),
  {
    // a suspect's coordinates typed: the view from there, the photo over it, and nothing
    // meeting. Find pressed again after it, for the pictures that go on from Find
    shot: 'find-eye-view',
    from: 'find-eye-pick',
    window: FIND_WIN,
    crop: 'full',
    map: true,
    settle: 20_000,
    async run({ page }) {
      const search = seen(page, '[data-guide="horizon.map"] .map-search input');
      await search.fill(FIND_SUSPECT);
      await search.press('Enter');
      const slider = seen(page, '[data-guide="horizon.overlay"] input[type="range"]');
      await slider.waitFor({ timeout: 60_000 });
      await slider.evaluate((input) => {
        input.value = '50';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
    async after({ page }) {
      await seen(page, '[data-guide="horizon.find"]').click();
      await seen(page, '[data-guide="find.canvas"]').waitFor();
    },
  },
  // -- the trace, on the photo enlarged: each press photographed with the tool before it lit --
  photoStill('find-big', 'find-eye-view', async ({ page }) => {
    await seen(page, '[data-guide="find.enlarge"]').click();
    await page.waitForTimeout(600);
  }),
  {
    // Trace pressed; the film draws the skyline in four lines, lifted where they break
    ...photoStill('find-tracing', 'find-big', ({ page }) => pressPhotoTool(page, 'Trace skyline')),
    film: {
      rate: '450k',
      async play({ page, frame }) {
        const { frames, take } = filmFrames(frame);
        await take(16);
        await drawAlong(page, take, Object.values(HALF_DOME_1901.skyline));
        await take(36);
        return frames;
      },
    },
  },
  photoStill('find-sky', 'find-tracing'),
  {
    // the ridge pen pressed; the film draws the three ridges
    ...photoStill('find-ridging', 'find-sky', ({ page }) => pressPhotoTool(page, 'Trace a ridge')),
    film: {
      rate: '400k',
      async play({ page, frame }) {
        const { frames, take } = filmFrames(frame);
        await take(16);
        await drawAlong(page, take, Object.values(HALF_DOME_1901.ridges));
        await take(36);
        return frames;
      },
    },
  },
  photoStill('find-ridged', 'find-ridging'),
  {
    // Mark a key line pressed; the film clicks the Dome's skyline
    ...photoStill('find-keying', 'find-ridged', ({ page }) => pressPhotoTool(page, 'Mark a key line')),
    film: {
      rate: '350k',
      async play({ page, frame }) {
        const { frames, take } = filmFrames(frame);
        await take(20);
        const at = await photoPoint(page);
        await page.mouse.click(...at(HALF_DOME_1901.skyline.dome[8]));
        await page.mouse.move(1, 1);
        await shown(page, take, 50);
        return frames;
      },
    },
  },
  photoStill('find-keyed', 'find-keying'),
  {
    // the ruler pressed: the How far bar, 1–3 km ticked as it opens. The film widens it to
    // under 10 km and marks the Dome (on its slope: its top lies under the bar) and Liberty Cap
    ...photoStill('find-ruler', 'find-keyed', ({ page }) => pressPhotoTool(page, 'Say how far a line stands')),
    film: {
      rate: '400k',
      async play({ page, frame }) {
        const { frames, take } = filmFrames(frame);
        await take(16);
        await bandsTo(page, take, ['< 1 km', '1–3 km', '3–10 km']);
        await clickLine(page, take, HALF_DOME_1901.skyline.dome, { index: 16 });
        await clickLine(page, take, HALF_DOME_1901.ridges.libertyCap, { hold: 40 });
        return frames;
      },
    },
  },
  {
    // the near lines marked; the film takes the bands past 10 km and marks the far range
    ...photoStill('find-far-one', 'find-ruler', async ({ page }) => {
      await page.mouse.move(1, 1);
      await page.waitForTimeout(300);
    }),
    film: {
      rate: '400k',
      async play({ page, frame }) {
        const { frames, take } = filmFrames(frame);
        await take(16);
        await bandsTo(page, take, ['10–30 km', '> 30 km']);
        await clickLine(page, take, HALF_DOME_1901.skyline.farRange, { hold: 40 });
        return frames;
      },
    },
  },
  // every line marked, the ruler still out: what the question about haze is asked over
  photoStill('find-marked', 'find-far-one', async ({ page }) => {
    await page.mouse.move(1, 1);
    await page.waitForTimeout(300);
  }),
  {
    // the haze brush pressed; the film brushes the far range and puts the brush away
    ...photoStill('find-hazing', 'find-marked', ({ page }) => pressPhotoTool(page, 'Brush where far land may be hidden')),
    film: {
      rate: '400k',
      async play({ page, frame }) {
        const { frames, take } = filmFrames(frame);
        await take(16);
        const at = await photoPoint(page);
        const [first, ...rest] = HALF_DOME_1901.skyline.farRange.map(at);
        await page.mouse.move(...first);
        await page.mouse.down();
        for (const [index, point] of rest.entries()) {
          await page.mouse.move(...point, { steps: 3 });
          if (index % 2) await shown(page, take);
        }
        await page.mouse.up();
        await shown(page, take, 20);
        await photoTool(page, 'Brush where far land may be hidden');
        await page.mouse.move(1, 1);
        await shown(page, take, 34);
        return frames;
      },
    },
  },
  // the photo marked, still enlarged: what the question about a name is asked over
  photoStill('find-hazed', 'find-hazing', async ({ page }) => {
    await page.mouse.move(1, 1);
    await page.waitForTimeout(300);
  }),
  // -- the area with no name, taken on the photo's own state: no area, nothing known yet.
  // The trunk's state is given back after it: no area, Normal, the map over the Sierra, the photo large
  {
    // a wide area drawn over the range, as Area draws one with no name: Quick, under the mesh's grid
    ...findStill('find-wide-drawn', 'find-hazed', async ({ page }) => {
      await seen(page, '[data-guide="find.enlarge"]').click();
      const search = seen(page, '[data-guide="find.place"] input');
      await search.fill(FIND_RANGE);
      await search.press('Enter');
      await page.waitForTimeout(1200);
      for (let step = 0; step < 3; step += 1) {
        await seen(page, '[data-guide="find.map"] .maplibregl-ctrl-zoom-out').click();
        await page.waitForTimeout(900);
      }
      await search.fill('');
      await page.evaluate(() => document.activeElement?.blur?.());
      await stepsTo(page, 'find.draw');
      await seen(page, '[data-guide="find.draw"]').click();
      const box = await seen(page, '[data-guide="find.map"]').boundingBox();
      for (const [x, y] of [[0.24, 0.3], [0.76, 0.28], [0.78, 0.74], [0.22, 0.72]]) {
        await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
        await page.waitForTimeout(300);
      }
      await page.keyboard.press('Enter');
      await seen(page, '[data-guide="find.quick"]').waitFor({ timeout: 90_000 });
      await page.mouse.move(1, 1);
      await page.waitForTimeout(1500);
      await stepsTo(page, 'find.quick');
    }),
    after: async ({ page }) => {
      await seen(page, '[data-guide="find.steps"]').getByRole('button', { name: /^Normal/ }).click();
      const area = page.locator('[data-guide="find.steps"] .fs-step').filter({ has: page.locator('h3', { hasText: 'Area' }) }).filter({ visible: true }).first();
      await area.getByRole('button', { name: 'Clear', exact: true }).click();
      const search = seen(page, '[data-guide="find.place"] input');
      await search.fill(`${FIND_OPEN.lat}, ${FIND_OPEN.lon}`);
      await search.press('Enter');
      await page.waitForTimeout(1200);
      for (let step = 0; step < 15 - FIND_OPEN.zoom; step += 1) {
        await seen(page, '[data-guide="find.map"] .maplibregl-ctrl-zoom-out').click();
        await page.waitForTimeout(700);
      }
      await search.fill('');
      await seen(page, '[data-guide="find.enlarge"]').click();
      await page.waitForTimeout(600);
    },
  },
  // -- the area, the photo naming a place ---------------------------------------------
  findStill('find-columns', 'find-hazed', async ({ page }) => {
    await seen(page, '[data-guide="find.enlarge"]').click();
    await seen(page, '[data-guide="find.place"]').waitFor();
  }),
  findStill(
    'find-place-typed',
    'find-columns',
    async ({ page }) => {
      const answered = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/geo/places', { timeout: 30_000 });
      await seen(page, '[data-guide="find.place"] input').pressSequentially('Half Dome', { delay: 60 });
      const { places } = await (await answered).json();
      if (!places?.length) throw new Error('the geocoder gave no place for Half Dome');
      findAnswer = { lat: places[0].lat, lon: places[0].lon };
      await seen(page, '[data-guide="sat.answer"]').waitFor();
    },
    { settle: 2000 }
  ),
  findStill(
    'find-place',
    'find-place-typed',
    async ({ page }) => {
      // the answer pressed, landing close in, and the map taken out to the valley and its rims
      await seen(page, '[data-guide="sat.answer"]').click();
      await page.waitForTimeout(800);
      // a place answers at zoom 15: three steps out, each let settle, stand at FIND_ZOOM
      for (let step = 0; step < 3; step += 1) {
        await seen(page, '[data-guide="find.map"] .maplibregl-ctrl-zoom-out').click();
        await page.waitForTimeout(900);
      }
      await page.evaluate(() => document.activeElement?.blur?.());
    },
    { settle: 8000 }
  ),
  {
    // Draw the area pressed: the map waits for corners; the film clicks them round the valley
    ...findStill('find-drawing', 'find-place', async ({ page }) => {
      await seen(page, '[data-guide="find.draw"]').click();
      await page.mouse.move(1, 1);
      await page.waitForTimeout(400);
    }),
    film: {
      rate: '500k',
      async play({ page, frame }) {
        const { frames, take } = filmFrames(frame);
        await take(16);
        let from = null;
        for (const corner of FIND_CORNERS) {
          const to = await onFindMap(page, corner);
          if (from) {
            for (const step of [1, 2]) {
              await page.mouse.move(from.x + ((to.x - from.x) * step) / 3, from.y + ((to.y - from.y) * step) / 3);
              await shown(page, take, 2);
            }
          }
          await page.mouse.click(to.x, to.y);
          await shown(page, take, 10);
          from = to;
        }
        await page.keyboard.press('Enter');
        await shown(page, take, 10);
        // the grid it would search, read off the terrain a moment after
        await seen(page, '[data-guide="find.steps"]').getByText(/points, one every|points searched, one every/).waitFor({ timeout: 90_000 });
        await page.mouse.move(1, 1);
        await page.waitForTimeout(1500);
        await shown(page, take, 50);
        return frames;
      },
    },
  },
  // the area drawn, its grid in it; More settings at the foot
  findStill('find-area', 'find-drawing', ({ page }) => stepsTo(page, 'find.more')),
  findStill('find-more', 'find-area', async ({ page }) => {
    await seen(page, '[data-guide="find.more"]').click();
    await stepsTo(page, 'find.grid');
  }),
  // a point every 50 m: what the question about clues is asked over, What you know above
  findStill('find-grid-set', 'find-more', async ({ page }) => {
    await seen(page, '[data-guide="find.grid"]').locator('button[role="radio"]', { hasText: /^50 m$/ }).click();
    await stepsTo(page, 'find.know');
  }),
  // -- what is known, each press photographed with the one before it done ---------------
  findStill('find-know-open', 'find-grid-set', async ({ page }) => {
    await seen(page, '[data-guide="find.know"]').click();
    await stepsTo(page, 'find.zoom');
    await stepsTo(page, 'find.stands');
  }),
  findStill('find-stands', 'find-know-open', async ({ page }) => {
    await pressIn(page, 'find.stands', 'Summit or ridge');
    await pressIn(page, 'find.stands', 'Slope');
  }),
  findStill('find-over', 'find-stands', async ({ page }) => {
    await pressIn(page, 'find.over', 'Above the land round');
  }),
  {
    // the zoom ticked and the points it rules out gone, back up to Search; the film presses
    // it and follows the search to its end, a frame each fiftieth of the way, then the places
    ...findStill('find-zoomed', 'find-over', async ({ page }) => {
      await pressIn(page, 'find.zoom', '×1');
      await pressIn(page, 'find.zoom', '×2–3');
      await page.waitForTimeout(2500);
      await stepsTo(page, 'find.search');
    }),
    film: {
      rate: '600k',
      async play({ page, frame }) {
        const { frames, take } = filmFrames(frame);
        await take(16);
        const asked = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/horizon/finds'));
        await seen(page, '[data-guide="find.search"]').click();
        // the photo's path is the case's: the example files its own copy and fills it in
        const ask = (await asked).postDataJSON();
        writeFileSync(FIND_EXAMPLE, `${JSON.stringify({ ...ask, title: 'Half Dome 1901', photo: { ...ask.photo, path: '' } })}\n`);
        await page.mouse.move(1, 1);
        // the column read from its top, where the search says how far it has gone
        await seen(page, '[data-guide="find.steps"]').evaluate((column) => column.scrollTo(0, 0));
        await shown(page, take, 6);
        const done = seen(page, '[data-guide="find.again"]');
        const bar = page.locator('[data-guide="find.steps"] .fs-bar span').filter({ visible: true });
        let step = 0;
        const end = Date.now() + 120 * 60_000;
        while (!(await done.isVisible())) {
          if (Date.now() > end) throw new Error('the search did not end in two hours');
          const width = await bar.first().evaluate((span) => parseFloat(span.style.width) || 0).catch(() => null);
          if (width != null && Math.floor(width / 2) > step) {
            step = Math.floor(width / 2);
            await shown(page, take, 2);
          }
          await page.waitForTimeout(500);
        }
        // the places, read in full at the end
        await page.waitForTimeout(1500);
        await shown(page, take, 60);
        return frames;
      },
    },
  },
  // the search ended: how far to trust it and the places, best first
  findStill(
    'horizon-find',
    'find-zoomed',
    async ({ page }) => {
      await seen(page, '[data-guide="find.again"]').waitFor({ timeout: 120 * 60_000 });
      await stepsTo(page, 'find.trust');
    },
    { settle: 8000 }
  ),
  // -- telling look-alikes apart: the setup again, a facing ticked ----------------------
  findStill('find-again', 'horizon-find', ({ page }) => stepsTo(page, 'find.again')),
  findStill('find-prepare', 'find-again', async ({ page }) => {
    await seen(page, '[data-guide="find.again"]').click();
    await stepsTo(page, 'find.search');
    await stepsTo(page, 'find.facing');
  }),
  {
    // east and its neighbours ticked; the result given back after the picture
    ...findStill('find-faced', 'find-prepare', async ({ page }) => {
      for (const way of ['NE', 'E', 'SE']) await pressIn(page, 'find.facing', way);
      await stepsTo(page, 'find.search');
    }),
    after: async ({ page }) => {
      await pressIn(page, 'find.facing', 'Any');
      await seen(page, '[data-guide="find.steps"]').getByRole('button', { name: 'Back to the result' }).click();
      await seen(page, '[data-guide="find.first"]').waitFor();
    },
  },
  {
    // the first place opened: the photo laid over the terrain from there, the view alone,
    // and the slider walked from one end to the other and back
    shot: 'find-look',
    from: 'find-faced',
    after: false,
    window: LOOK,
    clip: '.hz-main',
    map: true,
    settle: 20_000,
    crop: 'full',
    async run({ page }) {
      await stepsTo(page, 'find.first');
      await seen(page, '[data-guide="find.first"]').click();
      await seen(page, '[data-guide="horizon.overlay"]').waitFor({ timeout: 60_000 });
    },
    film: {
      rate: '900k',
      async play({ page, frame }) {
        const slider = seen(page, '[data-guide="horizon.overlay"] input[type="range"]');
        const sweep = [];
        for (let at = 0; at <= LOOK_SWEEP; at += 1) {
          const t = at / LOOK_SWEEP;
          const terrain = Math.round(100 * t * t * (3 - 2 * t));
          await slider.evaluate((input, value) => {
            input.value = String(value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }, terrain);
          await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
          sweep.push(await frame());
        }
        const hold = (path) => Array(LOOK_HOLD).fill(path);
        return [...hold(sweep[0]), ...sweep, ...hold(sweep.at(-1)), ...[...sweep].reverse()];
      },
    },
  },
  {
    // This is the place pressed: the view kept in the case, the search stopped there
    shot: 'find-confirmed',
    from: 'find-look',
    after: false,
    window: LOOK,
    clip: '.hz-main',
    map: true,
    settle: 8000,
    crop: 'full',
    async run({ page }) {
      // the photo half over the terrain again, as the film began
      await seen(page, '[data-guide="horizon.overlay"] input[type="range"]').evaluate((input) => {
        input.value = '40';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await seen(page, '[data-guide="find.confirm"]').click();
      await seen(page, '.hz-found.confirmed').waitFor({ timeout: 30_000 });
    },
  },
];

STAGES.push(...FIND_STAGES);
