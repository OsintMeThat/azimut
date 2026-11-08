/**
 * The proof a template is shown on: Half Dome photographed from Glacier Point in
 * 1901, and the USGS orthoimagery of the same ground, with the marks and the legend a
 * geolocation carries. Both pictures are in the public domain
 * (`frontend/guide/photos/CREDITS.md`).
 *
 * The template is laid on it with `applyProofStyle`, the very function New proof
 * uses, so the sample takes a style exactly as a real proof would. Only the
 * pictures are fixed: their place on the page, the footer and the signature are
 * whatever the template makes of them.
 */
import { ANNO_COLORS, applyProofStyle, normalizeProofStyle } from './composer.js';

/** The 1901 photo as it ships (`findExample.js` files the same file), its plate border and number left out. */
const PHOTO = {
  natural: [1554, 1187],
  crop: { x: 30, y: 26, w: 1484, h: 1084 },
};
/** The orthoimagery, cut from the USGS tiles at zoom 15 around the two places. */
const OVERHEAD = { natural: [720, 480] };

/** Where the camera stood and what it looked at, as the overhead places them. */
export const SAMPLE_POINT = '37.7306, -119.5738';
const VIDEO = 'media/sample.mp4';

/**
 * The pictures, loaded once and only when a template is shown: the photo is the
 * file the app already ships for its Find example.
 */
export async function loadSamplePictures(load) {
  const [{ default: photo }, { default: overhead }] = await Promise.all([
    import('../../guide/photos/half_dome_1901.jpg?url'),
    import('../assets/proof-sample/half-dome-usgs.webp?url'),
  ]);
  const [photoImg, overheadImg] = await Promise.all([load(photo), load(overhead)]);
  return { photo: photoImg, overhead: overheadImg };
}

/**
 * The sample's marks, in each picture's own pixels: the dome and the fall in both,
 * and the line of sight on the overhead.
 */
function sampleShapes(palette) {
  const [first, second, third] = [...palette, ...ANNO_COLORS];
  return [
    { id: 's1', kind: 'ellipse', panel: 'photo', color: first, x: 40, y: 64, w: 360, h: 300 },
    { id: 's2', kind: 'ellipse', panel: 'photo', color: second, x: 1268, y: 540, w: 110, h: 150 },
    { id: 's3', kind: 'ellipse', panel: 'overhead', color: first, x: 492, y: 78, w: 136, h: 120 },
    { id: 's4', kind: 'ellipse', panel: 'overhead', color: second, x: 528, y: 402, w: 68, h: 60 },
    { id: 's5', kind: 'arrow', panel: 'overhead', color: third, points: [96, 350, 470, 168] },
  ];
}

/**
 * A proof on the sample pictures, the template's style laid on it.
 *
 * - `pictures`: `{ photo, overhead }` images, or null to lay the page out without them;
 * - `legend`: whether the marks carry their words, which are the proof's content
 *   rather than its look, so the preview lets either be seen.
 */
export function sampleProof(style, { pictures = null, legend = true } = {}) {
  const proof = {
    title: 'Sample',
    panels: [
      {
        id: 'photo', src: 'sample/photo', row: 0, scale: 1, x: null, y: null,
        natural: [PHOTO.crop.w, PHOTO.crop.h], sourceNatural: PHOTO.natural, crop: { ...PHOTO.crop },
        caption: 'Ground photo, 1901', meta: { kind: 'media' }, img: pictures?.photo ?? null,
      },
      {
        id: 'overhead', src: 'sample/overhead', row: 0, scale: 1, x: null, y: null,
        natural: [...OVERHEAD.natural], sourceNatural: OVERHEAD.natural,
        caption: 'Overhead, USGS orthoimagery',
        meta: { kind: 'satellite', attribution: 'USGS The National Map' },
        img: pictures?.overhead ?? null,
      },
    ],
    pastes: [],
    shapes: [],
    notes: {},
    legendOrder: [],
    points: [{ coords: SAMPLE_POINT, label: '', pov: true }],
    sceneBadge: false,
    footerCredits: false,
    azimutMark: null,
    palette: [...ANNO_COLORS],
  };
  // every key the style can hold, as one read off the server has them
  applyProofStyle(proof, normalizeProofStyle(style), {});
  // Captions are a proof's own words, and a template only says whether new panels get them.
  if (proof.captionsEnabled === false) for (const panel of proof.panels) panel.caption = '';
  // Stacked, the two pictures share a width; side by side, a height. The analyst would size them so.
  const stacked = (proof.panels[1].row ?? 0) !== (proof.panels[0].row ?? 0);
  const photoAspect = PHOTO.crop.w / PHOTO.crop.h;
  const overheadAspect = OVERHEAD.natural[0] / OVERHEAD.natural[1];
  proof.panels[0].scale = stacked ? overheadAspect / photoAspect : 1;
  proof.shapes = sampleShapes(proof.palette);
  if (legend) {
    const [first, second, third] = [...proof.palette, ...ANNO_COLORS];
    proof.notes = { [first]: 'Half Dome', [second]: 'Nevada Fall', [third]: 'Line of sight' };
  }
  return proof;
}

/** The frames a scene time is printed on, as `proofScene.sceneBadges` reads them. */
export const SAMPLE_SCENE = {
  frames: [{ panel: 'photo', video: VIDEO, time: 44 }],
  star: VIDEO,
  moments: [{ start: 42, end: 51 }],
};
