/**
 * The demo case the guide is photographed in: one small, coherent investigation.
 *
 * A photo of a container ship under a green suspension bridge, posted without a
 * caption, is placed on the west bank of the Main Channel of the Port of Los Angeles,
 * dated, argued in a proof and written up, while two other ports are ruled out. Every
 * tool then has something of the same story to show, so the journeys read as one job
 * from tab to tab.
 *
 * Built through the routes the app serves, as `tests/fullcase.py` builds its case. The
 * photos are in the public domain (photos.mjs), and so is the USGS imagery the maps
 * are drawn from. Where and when each photo was taken is true; the accounts that posted
 * them are made up, and nothing happens in the case that did not happen in the photos.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PHOTOS } from './photos.mjs';

/** Public domain imagery the guide's maps are drawn from, added as the user would add a provider. */
export const IMAGERY = {
  id: 'usgs-imagery',
  label: 'USGS Imagery',
  url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
  attribution: 'USGS The National Map: Orthoimagery (public domain)',
  max_zoom: 16,
  imagery: true,
};

/**
 * Where the story happens. The maps open on the channel between the bridge and the
 * terminal; the camera stood on the west bank, south of them, and looked north through
 * a long lens: the cruise gangway below it, the YM Success mid-channel, the Evergreen
 * cranes in front of the bridge's east tower, the west tower out of frame.
 */
export const CHANNEL = { lat: 33.7455, lon: -118.274 };
export const CAMERA = { lat: 33.7398, lon: -118.2782 };
export const TERMINAL = { lat: 33.7474, lon: -118.2706 };
export const BRIDGE = { lat: 33.7497, lon: -118.2716 };
export const GLACIER_POINT = { lat: 37.7307, lon: -119.5737 };
const ZONE = 'America/Los_Angeles';

/** The place the proof names: where the photo was taken from. */
export const CAMERA_PLACE = 'Main Channel, west bank';

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Channel observations</name>
<Folder><name>Line of sight</name>
<Placemark><name>Camera position</name><Point><coordinates>${CAMERA.lon},${CAMERA.lat},0</coordinates></Point></Placemark>
<Placemark><name>Evergreen berth</name><Point><coordinates>${TERMINAL.lon},${TERMINAL.lat},0</coordinates></Point></Placemark>
<Placemark><name>Line of sight</name><LineString><coordinates>${CAMERA.lon},${CAMERA.lat} ${TERMINAL.lon},${TERMINAL.lat}</coordinates></LineString></Placemark>
</Folder>
<Folder><name>Landmarks</name>
<Placemark><name>Vincent Thomas Bridge</name><Point><coordinates>${BRIDGE.lon},${BRIDGE.lat},0</coordinates></Point></Placemark>
</Folder></Document></kml>`;

const NOTES = `# Ship under a green bridge

A photo posted without a caption: a container ship passing under a green suspension
bridge, a terminal with green cranes beyond it. Where was it taken, and when?

- A suspension bridge over a working channel, mountains behind it.
- The ship is the YM Success, and the terminal's ship and cranes read EVERGREEN.
- A cruise gangway stands on the near bank, below the camera.

\`\`\`mermaid
flowchart LR
  A[harbor_watch posts] --> B[Photo]
  B --> C{Which port?}
  C -->|no bridge| D[Charleston, Miami ruled out]
  C -->|bridge and Evergreen cranes| E[Los Angeles, Main Channel]
  E --> F[Geolocated]
\`\`\`

Next: date the departure clip, and archive the post.
`;

/**
 * Fill a case through the app's own routes. `call(method, path, body)` reaches the
 * backend; `scratch` holds what ffmpeg writes.
 */
export async function buildDemo({ call, scratch }) {
  const demo = await call('POST', '/api/cases', { name: 'Demo case' });
  const caseId = demo.id;
  const at = (path) => `/api/cases/${caseId}${path}`;
  const entity = async (type, label, attrs = {}) =>
    (await call('POST', at('/entities'), { type, label, attrs })).id;
  const link = (from, to, type) => call('POST', at('/links'), { from_id: from, to_id: to, type });

  // -- the files, from the photos ---------------------------------------------
  const files = {};
  for (const one of PHOTOS) {
    let bytes = readFileSync(one.path);
    if (one.video) {
      const clip = join(scratch, one.file);
      const made = spawnSync('ffmpeg', [
        '-y', '-loglevel', 'error', '-loop', '1', '-i', one.path,
        '-vf', "zoompan=z='1+on*0.0025':d=150:s=1280x852:fps=25,format=yuv420p",
        '-t', '6', '-c:v', 'libx264', clip,
      ]);
      if (made.status !== 0) throw new Error(`ffmpeg could not make the demo video: ${made.stderr}`);
      bytes = readFileSync(clip);
    }
    const form = new FormData();
    form.append('file', new Blob([bytes]), one.file);
    form.append('source_url', one.source);
    const filed = await call('POST', at('/media/upload'), form);
    files[one.file] = filed.item.path;
  }
  const photo = files['bridge_channel.jpg'];
  const video = files['channel_departure.mp4'];
  const lookup = async (path) =>
    (await call('GET', at(`/entities/lookup?attr=path&value=${encodeURIComponent(path)}`))).entity.id;
  const photoId = await lookup(photo);
  const videoId = await lookup(video);

  // -- places, and a capture of the channel from the public imagery ----------
  const camera = (await call('POST', at('/satellite/place'), { ...CAMERA, zoom: 16, title: CAMERA_PLACE })).id;
  const bridgePlace = (await call('POST', at('/satellite/place'), { ...BRIDGE, zoom: 15, title: 'Vincent Thomas Bridge' })).id;
  await call('POST', at('/satellite/capture'), {
    ...CHANNEL, zoom: 16, width: 1000, height: 700, provider: IMAGERY.id,
  });
  const captures = await call('GET', at('/satellite'));
  const capture = captures[0]?.path ?? null;

  // -- who and what ----------------------------------------------------------
  const account = await entity('account', '@harbor_watch');
  const vessel = await entity('vessel', 'YM Success', { condition: 'intact' });
  const bridge = await entity('structure', 'Vincent Thomas Bridge', { kind: 'suspension bridge', condition: 'intact' });
  const cranes = await entity('structure', 'Evergreen terminal cranes', { kind: 'crane', condition: 'intact' });
  const post = await entity('bookmark', 'harbor_watch post', {
    url: 'https://example.org/posts/0412',
    fetched_at: '2026-03-15T06:02:00+00:00',
    reliability: 'C',
  });
  for (const [from, to, verb] of [
    [account, photoId, 'posted'],
    [account, videoId, 'posted'],
    [vessel, photoId, 'appears-in'],
    [bridge, photoId, 'appears-in'],
    [cranes, photoId, 'appears-in'],
    [bridge, bridgePlace, 'sited-at'],
    [photoId, camera, 'located-at'],
  ]) {
    await link(from, to, verb);
  }

  // -- what the case says, dated in the port's own time -----------------------
  const claim = async (label, attrs, about, place, cites = []) => {
    const id = await entity('claim', label, { when_zone: ZONE, ...attrs });
    for (const target of about) await link(id, target, 'about');
    if (place) await link(id, place, 'at');
    for (const source of cites) await link(id, source, 'cites');
    return id;
  };
  await claim(
    'The YM Success passes under the Vincent Thomas Bridge',
    { when: '2009-02-03', time_role: 'observed', confidence: 'probable' },
    [photoId, vessel], bridgePlace, [post]
  );
  await claim(
    'The photo was taken from the west bank of the Main Channel',
    {
      when: '2009-02-03',
      time_role: 'occurred',
      confidence: 'probable',
      method: 'The bridge, the Evergreen cranes and the cruise gangway line up only from there, matched against USGS imagery.',
    },
    [photoId], camera, [post]
  );
  await claim(
    '@harbor_watch posts the photo without a caption',
    { when: '2026-03-15T06:02:00+00:00', time_role: 'occurred', confidence: 'certain' },
    [photoId, account], null, [post]
  );
  await claim(
    'A ship leaves the port by the Main Channel',
    { when: '2020-05-15', time_role: 'observed', confidence: 'possible' },
    [videoId], camera
  );

  // -- notes, a sheet, the running notes ------------------------------------
  await call('POST', at('/folders'), { name: 'Sources' });
  await call('POST', at('/notes'), {
    title: 'What the post says',
    folder: 'Sources',
    content: '# What the post says\n\nNo caption and no place. The account posts port photos from several countries.\n',
  });
  await call('PUT', at('/notes'), { text: NOTES });
  const sheet = await call('POST', at('/sheets'), { title: 'Files to geolocate' });
  await call('PUT', at(`/sheets/${sheet.id}`), {
    columns: ['id', 'File', 'Status', 'Coordinates', 'Notes'],
    rows: [
      ['r1', 'bridge_channel', 'done', `${CAMERA.lat}, ${CAMERA.lon}`, 'west bank of the Main Channel'],
      ['r2', 'channel_departure', 'to do', '', 'same channel, date the clip'],
      ['r3', 'container_yard', 'to do', '', 'same bridge, from Terminal Island'],
      ['r4', 'wando_terminal', 'ruled out', '', 'Charleston: no bridge over the berths'],
      ['r5', 'miami_port_aerial', 'ruled out', '', 'Miami: an island port, no bridge'],
    ],
    meta: {
      colours: { r1: 'green', r4: 'grey', r5: 'grey' },
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
          { id: 'clip', text: 'Date the departure clip', done: false },
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
      marks: [{ id: 'mk_1', time: 3.6, label: 'Tug ahead' }],
    },
  });
  await call('POST', at('/collages'), {
    title: 'The bridge from both banks',
    spec: {
      width: 1200,
      height: 420,
      nodes: [
        { id: 'nd_1', save: { path: photo, time: null, ops: [] }, w: 528, h: 350,
          quad: [[46, 35], [574, 35], [574, 385], [46, 385]] },
        { id: 'nd_2', save: { path: files['container_yard.jpg'], time: null, ops: [] }, w: 526, h: 350,
          quad: [[626, 35], [1152, 35], [1152, 385], [626, 385]] },
      ],
    },
  });

  // -- the map: a layer of observations, a comparison, a plate, a view ------
  const kml = new FormData();
  kml.append('file', new Blob([KML]), 'channel-observations.kml');
  kml.append('title', 'Channel observations');
  await call('POST', at('/map-layers/upload'), kml);
  await call('POST', at('/compare/sessions'), {
    title: 'Main Channel, imagery against the map',
    spec: {
      version: 2,
      camera: { ...CHANNEL, zoom: 16, bearing: 0 },
      mode: 'swipe',
      divider: 50,
      opacity: 50,
      a: { present: true, provider: IMAGERY.id, overlays: [] },
      b: { present: true, provider: 'opentopomap', overlays: [] },
    },
  });
  await call('POST', at('/map-plates'), {
    title: 'Main Channel, Port of Los Angeles',
    spec: {
      elements: [
        { id: 'map', kind: 'map', box: [10, 20, 200, 150], view: { ...CHANNEL, zoom: 15 } },
        { id: 'legend', kind: 'legend', box: [215, 20, 70, 60], of: 'map' },
        { id: 'title', kind: 'text', box: [10, 6, 200, 12], text: 'Main Channel, Port of Los Angeles', size: 18, weight: 700 },
      ],
    },
  });
  await call('PUT', at('/search-grids/channel-sweep'), {
    title: 'Channel sweep',
    spec: {
      azimut_grid: 1,
      cell_m: 250,
      anchor: { lat: 33.738, lon: -118.284 },
      lat_step: 0.00225,
      lon_step: 0.0027,
      aoi: { type: 'rect', bounds: { south: 33.738, west: -118.284, north: 33.752, east: -118.263 } },
      statuses: { '0:0': 'cleared', '0:1': 'cleared', '1:0': 'cleared', '2:3': 'flagged' },
    },
  });

  // Horizon wants relief, so its view stands on a mountain rather than on the quay:
  // the one the case's 1901 photo was taken from.
  await call('POST', at('/horizon/views'), {
    title: 'Half Dome from Glacier Point',
    spec: {
      eye: { ...GLACIER_POINT, mode: 'ground', height: 1.7 },
      look: { heading: 64, tilt: 1, fov: 62 },
      picture: { ground: 'imagery', imagery: IMAGERY.id, lines: true, names: true },
    },
  });

  // -- folders, as an analyst would have filed the case ----------------------
  await call('POST', at('/folders'), { name: 'Sources/harbor_watch' });
  const file = (id, folder) => call('PATCH', at(`/entities/${encodeURIComponent(id)}`), { attrs: { folder } });
  for (const id of [photoId, videoId, post, account]) await file(id, 'Sources/harbor_watch');

  // -- the Board as the analyst left it --------------------------------------
  await call('POST', at('/analysis-views'), {
    name: 'Everything on the Main Channel',
    mode: 'live',
    surface: 'board',
    spec: { query: { filter: {}, terms: { place: CAMERA_PLACE } } },
  });

  return { caseId, photo, video, capture, files, camera, bridge: bridgePlace, account, sheet: sheet.id };
}
