/**
 * The demo case the guide is photographed in: one small, coherent investigation.
 *
 * A photo and a dashcam video of a harbour at night, posted by one account, are
 * geolocated to a pier, dated, argued in a proof and written up. Every tool then has
 * something of the same story to show, so the journeys read as one job from tab to tab.
 *
 * Built through the routes the app serves, as `tests/fullcase.py` builds its case. The
 * ground is a real port so the maps have something to show, drawn from USGS imagery,
 * which is in the public domain. The people, accounts and events are made up.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SCENES, SCENE_SIZE } from './scenes.mjs';

/** Public domain imagery the guide's maps are drawn from, added as the user would add a provider. */
export const IMAGERY = {
  id: 'usgs-imagery',
  label: 'USGS Imagery',
  url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
  attribution: 'USGS The National Map: Orthoimagery (public domain)',
  max_zoom: 16,
  imagery: true,
};

/** Where the story happens. */
export const PIER = { lat: 33.7545, lon: -118.2368 };
export const HILL = { lat: 33.8047, lon: -118.1676 };
export const GLACIER_POINT = { lat: 37.7307, lon: -119.5737 };
const ZONE = 'America/Los_Angeles';

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Pier observations</name>
<Folder><name>Seen from the quay</name>
<Placemark><name>Camera position</name><Point><coordinates>-118.2386,33.7531,0</coordinates></Point></Placemark>
<Placemark><name>Smoke source</name><Point><coordinates>-118.2341,33.7562,0</coordinates></Point></Placemark>
<Placemark><name>Line of sight</name><LineString><coordinates>-118.2386,33.7531 -118.2341,33.7562</coordinates></LineString></Placemark>
</Folder>
<Folder><name>Ruled out</name>
<Placemark><name>Pier S quay</name><Point><coordinates>-118.2475,33.7618,0</coordinates></Point></Placemark>
</Folder></Document></kml>`;

const NOTES = `# Harbour at night

Two files from one account, both said to show smoke over the port.

- The photo shows a row of ship-to-shore cranes across water, from low on a quay.
- The dashcam clip pans past the same skyline nine minutes later.

\`\`\`mermaid
flowchart LR
  A[pier_watch posts] --> B[Photo]
  A --> C[Dashcam clip]
  B --> D{Pier T?}
  C --> D
  D -->|crane row matches| E[Geolocated]
\`\`\`

Next: date the clip from its shadows, and archive the post.
`;

/**
 * Fill a case through the app's own routes. `call(method, path, body)` reaches the
 * backend; `browser` renders the drawn pictures; `scratch` holds what ffmpeg writes.
 */
export async function buildDemo({ call, browser, scratch }) {
  const demo = await call('POST', '/api/cases', { name: 'Demo case' });
  const caseId = demo.id;
  const at = (path) => `/api/cases/${caseId}${path}`;
  const entity = async (type, label, attrs = {}) =>
    (await call('POST', at('/entities'), { type, label, attrs })).id;
  const link = (from, to, type) => call('POST', at('/links'), { from_id: from, to_id: to, type });

  // -- the files, drawn here ------------------------------------------------
  const page = await browser.newPage({ viewport: SCENE_SIZE });
  const files = {};
  for (const scene of SCENES) {
    await page.setContent(`<body style="margin:0">${scene.draw()}</body>`);
    let bytes = await page.screenshot({ type: 'jpeg', quality: 88 });
    if (scene.video) {
      const still = join(scratch, 'still.jpg');
      const clip = join(scratch, scene.file);
      writeFileSync(still, bytes);
      const made = spawnSync('ffmpeg', [
        '-y', '-loglevel', 'error', '-loop', '1', '-i', still,
        '-vf', "zoompan=z='1+on*0.0025':d=150:s=1280x800:fps=25,format=yuv420p",
        '-t', '6', '-c:v', 'libx264', clip,
      ]);
      if (made.status !== 0) throw new Error(`ffmpeg could not make the demo video: ${made.stderr}`);
      bytes = readFileSync(clip);
    }
    const form = new FormData();
    form.append('file', new Blob([bytes]), scene.file);
    form.append('source_url', scene.source);
    const filed = await call('POST', at('/media/upload'), form);
    files[scene.file] = filed.item.path;
  }
  await page.close();
  const photo = files['harbour_smoke_0412.jpg'];
  const video = files['convoy_dashcam.mp4'];
  const lookup = async (path) =>
    (await call('GET', at(`/entities/lookup?attr=path&value=${encodeURIComponent(path)}`))).entity.id;
  const photoId = await lookup(photo);
  const videoId = await lookup(video);

  // -- places, and a capture of the pier from the public imagery -------------
  const pier = (await call('POST', at('/satellite/place'), { ...PIER, zoom: 16, title: 'Pier T, berth 4' })).id;
  const hill = (await call('POST', at('/satellite/place'), { ...HILL, zoom: 15, title: 'Signal Hill' })).id;
  await call('POST', at('/satellite/capture'), {
    ...PIER, zoom: 16, width: 1000, height: 700, provider: IMAGERY.id,
  });
  const captures = await call('GET', at('/satellite'));
  const capture = captures[0]?.path ?? null;

  // -- who and what ----------------------------------------------------------
  const account = await entity('account', '@pier_watch');
  const witness = await entity('person', 'Night-shift witness');
  const operator = await entity('organization', 'Terminal operator');
  const vessel = await entity('vessel', 'MV Aurora', { condition: 'intact' });
  const cranes = await entity('structure', 'Crane row, berth 4', { kind: 'crane', condition: 'intact' });
  const post = await entity('bookmark', 'pier_watch post', {
    url: 'https://example.org/posts/0412',
    fetched_at: '2026-03-15T06:02:00+00:00',
    reliability: 'C',
  });
  for (const [from, to, verb] of [
    [account, photoId, 'posted'],
    [account, videoId, 'posted'],
    [witness, account, 'owns'],
    [operator, vessel, 'owns'],
    [vessel, photoId, 'appears-in'],
    [cranes, pier, 'sited-at'],
    [photoId, pier, 'located-at'],
  ]) {
    await link(from, to, verb);
  }

  // -- what the case says, dated in the pier's own time ----------------------
  const claim = async (label, attrs, about, place, cites = []) => {
    const id = await entity('claim', label, { when_zone: ZONE, ...attrs });
    for (const target of about) await link(id, target, 'about');
    if (place) await link(id, place, 'at');
    for (const source of cites) await link(id, source, 'cites');
    return id;
  };
  await claim(
    'Smoke rises over the crane row',
    { when: '2026-03-14T21:40:00-07:00', time_role: 'observed', confidence: 'probable' },
    [photoId], pier, [post]
  );
  await claim(
    'The dashcam clip passes the same skyline',
    { when: '2026-03-14T21:49:00-07:00', time_role: 'observed', confidence: 'possible' },
    [videoId], pier, [post]
  );
  await claim(
    'The photo was taken from the Pier T quay',
    {
      when: '2026-03-14T21:40:00-07:00',
      time_role: 'occurred',
      confidence: 'probable',
      method: 'Crane spacing and the lit gantry matched against USGS imagery of berth 4.',
    },
    [photoId], pier, [post]
  );
  await claim(
    'Fire crews reach the berth',
    { when: '2026-03-14T22:05:00-07:00', time_role: 'occurred', confidence: 'possible' },
    [cranes], pier
  );

  // -- notes, a sheet, the running notes ------------------------------------
  await call('POST', at('/folders'), { name: 'Sources' });
  await call('POST', at('/notes'), {
    title: 'Witness account',
    folder: 'Sources',
    content: '# Witness account\n\nThe witness says the smoke came from the second crane from the left.\n',
  });
  await call('PUT', at('/notes'), { text: NOTES });
  const sheet = await call('POST', at('/sheets'), { title: 'Files to geolocate' });
  await call('PUT', at(`/sheets/${sheet.id}`), {
    columns: ['id', 'File', 'Status', 'Coordinates', 'Notes'],
    rows: [
      ['r1', 'harbour_smoke_0412', 'done', `${PIER.lat}, ${PIER.lon}`, 'crane row, berth 4'],
      ['r2', 'convoy_dashcam', 'to do', '', 'desert road, not the port'],
      ['r3', 'night_glow', 'to do', '', 'glow on the horizon'],
      ['r4', 'coast_from_the_air', 'ruled out', '', 'no pier in frame'],
    ],
    meta: {
      colours: { r1: 'green', r4: 'grey' },
      widths: { File: 200, Notes: 240 },
      frozen: 'File',
      roles: {
        Status: { kind: 'state', values: ['to do', 'done', 'ruled out'] },
        Coordinates: { kind: 'latlon' },
      },
      progress: 'Coordinates',
      description: 'Every file of the case still to place on the map.',
    },
  });

  // -- checklists ------------------------------------------------------------
  await call('PUT', at('/todos'), {
    revision: 0,
    lists: [
      {
        id: 'checks',
        name: 'Checks',
        tasks: [
          { id: 'source', text: 'Archive the post', done: true },
          { id: 'place', text: 'Geolocate the photo', done: true },
          { id: 'clip', text: 'Date the dashcam clip', done: false },
        ],
      },
    ],
  });

  // -- Inspect work on the clip, and a collage of the two pictures ----------
  await call('PUT', at('/inspect/work'), {
    path: video,
    spec: {
      frames: [
        { id: 'fr_1', path: video, time: 1.2, adjust: {}, crop: null },
        { id: 'fr_2', path: video, time: 3.6, adjust: { brightness: 1.15, contrast: 1.1 }, crop: null },
      ],
      marks: [{ id: 'mk_1', time: 3.6, label: 'Gantry lights' }],
    },
  });
  await call('POST', at('/collages'), {
    title: 'Harbour strip',
    spec: {
      width: 1200,
      height: 420,
      nodes: [
        { id: 'nd_1', save: { path: photo, time: null, ops: [] }, w: 560, h: 350,
          quad: [[30, 35], [590, 35], [590, 385], [30, 385]] },
        { id: 'nd_2', save: { path: files['night_glow.jpg'], time: null, ops: [] }, w: 560, h: 350,
          quad: [[610, 35], [1170, 35], [1170, 385], [610, 385]] },
      ],
    },
  });

  // -- the map: a layer of observations, a comparison, a plate, a view ------
  const kml = new FormData();
  kml.append('file', new Blob([KML]), 'pier-observations.kml');
  kml.append('title', 'Pier observations');
  await call('POST', at('/map-layers/upload'), kml);
  await call('POST', at('/compare/sessions'), {
    title: 'Pier T, imagery against the map',
    spec: {
      version: 2,
      camera: { ...PIER, zoom: 16, bearing: 0 },
      mode: 'swipe',
      divider: 50,
      opacity: 50,
      a: { present: true, provider: IMAGERY.id, overlays: [] },
      b: { present: true, provider: 'opentopomap', overlays: [] },
    },
  });
  await call('POST', at('/map-plates'), {
    title: 'Pier T at night',
    spec: {
      elements: [
        { id: 'map', kind: 'map', box: [10, 20, 200, 150], view: { ...PIER, zoom: 15 } },
        { id: 'legend', kind: 'legend', box: [215, 20, 70, 60], of: 'map' },
        { id: 'title', kind: 'text', box: [10, 6, 200, 12], text: 'Pier T at night', size: 18, weight: 700 },
      ],
    },
  });
  await call('PUT', at('/search-grids/pier-sweep'), {
    title: 'Pier sweep',
    spec: {
      azimut_grid: 1,
      cell_m: 250,
      anchor: { lat: 33.748, lon: -118.247 },
      lat_step: 0.00225,
      lon_step: 0.0027,
      aoi: { type: 'rect', bounds: { south: 33.748, west: -118.247, north: 33.762, east: -118.226 } },
      statuses: { '0:0': 'cleared', '0:1': 'cleared', '1:0': 'cleared', '2:3': 'flagged' },
    },
  });

  // Horizon wants relief, so its view stands on a mountain rather than on the quay.
  await call('POST', at('/horizon/views'), {
    title: 'Half Dome from Glacier Point',
    spec: {
      eye: { ...GLACIER_POINT, mode: 'ground', height: 1.7 },
      look: { heading: 64, tilt: 1, fov: 62 },
      picture: { ground: 'imagery', imagery: IMAGERY.id, lines: true, names: true },
    },
  });

  // -- folders, as an analyst would have filed the case ----------------------
  await call('POST', at('/folders'), { name: 'Sources/pier_watch' });
  const file = (id, folder) => call('PATCH', at(`/entities/${encodeURIComponent(id)}`), { attrs: { folder } });
  for (const id of [photoId, videoId, post, account]) await file(id, 'Sources/pier_watch');

  // -- the Board as the analyst left it --------------------------------------
  await call('POST', at('/analysis-views'), {
    name: 'Everything at the pier',
    mode: 'live',
    surface: 'board',
    spec: { query: { filter: {}, terms: { place: 'Pier T, berth 4' } } },
  });

  return { caseId, photo, video, capture, files, pier, hill, account, sheet: sheet.id };
}
