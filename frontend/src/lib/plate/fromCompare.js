/**
 * A comparison of the case put on a plate as two live maps side by side, each on its
 * side's ground and day, framed where the comparison looks, a badge on each saying its
 * day. The maps are ordinary plate maps, grouped so they move together: the plate keeps
 * no link to the comparison, so changing one later leaves the other as it is.
 *
 * A plate draws fewer grounds than Compare reads. A side on a ground a plate cannot
 * draw (radar, fires, night lights, a source that needs a key not set up) is laid on
 * Esri World Imagery instead, and `lost` says so, side by side, for the toast.
 */
import { WAYBACK_ID } from '../wayback.js';
import { fromMercator, turnedBox } from '../map/groundFrame.js';
import { styled } from './design.js';
import { PX_PER_MM } from './page.js';
import { SENTINEL_ID } from './sentinelPass.js';

/** The ground a side falls back to when a plate cannot draw its own. */
export const FALLBACK_GROUND = 'esri-world-imagery';
/** Web Mercator's world, in metres, and MapLibre's tile, in pixels: what a zoom is measured by. */
const WORLD = 40075016.686;
const TILE = 512;
const PRODUCT = /^[A-Z0-9_]{1,40}$/;

/** Compare's camera turns the Map's way; a plate's view turns the other, from -180 to 180. */
export function plateBearing(bearing = 0) {
  const turned = -(Number(bearing) || 0);
  const folded = (((turned + 180) % 360) + 360) % 360 - 180;
  return Math.round(folded * 10) / 10 || 0;
}

/**
 * Where the two maps look: the comparison's export frame filling a map `box`
 * millimetres wide when it drew one, else its camera a step further out, as New
 * plate frames the Map's view.
 */
export function compareView(spec, box) {
  const camera = spec?.camera ?? { lat: 0, lon: 0, zoom: 2, bearing: 0 };
  const frame = spec?.frame;
  if (frame?.points?.length === 2) {
    const turned = turnedBox(frame.points, frame.angle ?? camera.bearing ?? 0);
    const [lon, lat] = fromMercator(...turned.centre);
    const fit = (millimetres, metres) => Math.log2((millimetres * PX_PER_MM * WORLD) / (TILE * Math.max(1e-6, Math.abs(metres))));
    const zoom = Math.min(fit(box[2], turned.width), fit(box[3], turned.height)) - 0.05;
    return { lat, lon, zoom: Math.round(Math.max(0, Math.min(22, zoom)) * 100) / 100, bearing: plateBearing(frame.angle ?? camera.bearing) };
  }
  const zoom = Math.round(Math.max(0, Math.min(22, (camera.zoom ?? 2) - 1)) * 100) / 100;
  return { lat: camera.lat, lon: camera.lon, zoom, bearing: plateBearing(camera.bearing) };
}

/**
 * A side's ground as a plate map holds it, `{ ground, lost }`: `lost` names what a
 * plate could not draw and laid on World Imagery instead. `offered` lists the grounds
 * this plate offers, by id.
 */
export function sideGround(side, offered = []) {
  const provider = side?.provider || FALLBACK_GROUND;
  if (!offered.includes(provider)) return { ground: { basemap: offered.includes(FALLBACK_GROUND) ? FALLBACK_GROUND : 'plain' }, lost: provider };
  const ground = { basemap: provider };
  if (provider === WAYBACK_ID && side.wayback_release) ground.release = side.wayback_release;
  if (provider === SENTINEL_ID) {
    const layer = side.sentinel?.layer ?? '';
    Object.assign(ground, { acquired: side.sentinel?.date || null, product: layer === 'TRUE_COLOR' || !PRODUCT.test(layer) ? '' : layer,
      maxcc: Number.isFinite(side.sentinel?.maxcc) ? side.sentinel.maxcc : null });
  }
  return { ground, lost: '' };
}

/**
 * Two boxes for the pair on a page `width` by `height` millimetres: side by side on a
 * wide page, one over the other on an upright one, in the middle, four to three each.
 */
export function pairBoxes(width, height) {
  const gap = 3;
  const round = (box) => box.map((value) => Math.round(value * 10) / 10);
  if (width >= height) {
    const w = Math.min((width * 0.84 - gap) / 2, ((height * 0.72) * 4) / 3);
    const h = (w * 3) / 4;
    const x = (width - (2 * w + gap)) / 2;
    const y = (height - h) / 2;
    return [round([x, y, w, h]), round([x + w + gap, y, w, h])];
  }
  const h = Math.min((height * 0.8 - gap) / 2, ((width * 0.84) * 3) / 4);
  const w = (h * 4) / 3;
  const x = (width - w) / 2;
  const y = (height - (2 * h + gap)) / 2;
  return [round([x, y, w, h]), round([x, y + h + gap, w, h])];
}

/**
 * The elements a comparison puts on a plate: two maps, then a badge over each.
 * `dayOf(map)` gives the day a map's picture was taken, as the badge writes it ('' for
 * none, where the badge says Before or After), `layers` what both maps draw (the main
 * map's, so the pair reads the case as the page does), `group` the id they share.
 */
export function comparisonOnPlate(session, { width, height, offered = [], layers = [], dayOf = () => '', theme, newId, group }) {
  const spec = session?.spec ?? {};
  const boxes = pairBoxes(width, height);
  const view = compareView(spec, boxes[0]);
  const title = session?.title || 'Comparison';
  const lost = [];
  const maps = ['a', 'b'].map((key, index) => {
    const { ground, lost: missing } = sideGround(spec[key], offered);
    if (missing) lost.push(missing);
    return { id: newId('map'), kind: 'map', name: `${title}, ${index ? 'after' : 'before'}`, group, box: boxes[index], view: { ...view },
      overlays: [], layers: JSON.parse(JSON.stringify(layers)), grid: 'none', ...ground };
  });
  const badges = maps.map((map, index) => styled({ id: newId('text'), kind: 'text', name: `${title}, ${index ? 'after' : 'before'} day`, group,
    box: [map.box[0] + 3, map.box[1] + 3, 34, 6.5].map((value) => Math.round(value * 10) / 10),
    text: dayOf(map) || (index ? 'After' : 'Before') }, 'badge', theme));
  return { elements: [...maps, ...badges], lost };
}
