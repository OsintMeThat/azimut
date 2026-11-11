/**
 * A video thread's recap pictures, drawn in the browser and filed in the case's Media so
 * the thread's first post carries them like any picture: copied, downloaded, or attached
 * by the extension. The contact sheet is drawn from its places' saved pictures
 * (`lib/proofSheet.js`, `POST /scenes/sheet`); the recap map is drawn whole when the
 * thread needs its picture (`lib/recapMap.js`, `POST /scenes/map`). The same picture
 * filed again is the file already there.
 */
import { api } from '../../lib/api.js';
import { loadImage } from '../../lib/composer.js';
import { myLogoUrl } from '../../lib/myLogo.js';
import { buildProofSheet } from '../../lib/proofSheet.js';
import { defaultProofTemplate } from '../../lib/proofTemplates.js';
import { buildRecapMap, loadAppTile, recapFit, recapPlaces } from '../../lib/recapMap.js';
import { prefs, templatesState } from '../../lib/state.svelte.js';

/** Draw and file the sheet of `slides`, made from `video`. Answers its case path. */
export async function fileThreadSheet(caseId, { video, slides = [] }, { build = buildProofSheet, post = api.post } = {}) {
  const blob = await build(slides, { caseId });
  const form = new FormData();
  form.append('video', video);
  form.append('image', blob, 'contact-sheet.jpg');
  const answer = await post(`/api/cases/${encodeURIComponent(caseId)}/scenes/sheet`, form);
  if (typeof answer?.path !== 'string' || !answer.path) throw new Error('the sheet was not filed');
  return answer.path;
}

/** File the recap map drawn of `video`'s places. Answers its case path. */
export async function fileRecapMap(caseId, { video, blob }, { post = api.post } = {}) {
  const form = new FormData();
  form.append('video', video);
  form.append('image', blob, 'recap-map.jpg');
  const answer = await post(`/api/cases/${encodeURIComponent(caseId)}/scenes/map`, form);
  if (typeof answer?.path !== 'string' || !answer.path) throw new Error('the map was not filed');
  return answer.path;
}

/**
 * What signs a recap map as it stands now: the analyst's default proof style, their logo
 * and their handle, and the imagery catalogue for its credit. The type is loaded first.
 */
export async function recapSigning({ get = api.get, logo = () => loadImage(myLogoUrl()) } = {}) {
  const fonts = globalThis.document?.fonts;
  await Promise.all([fonts?.load?.('600 16px Inter'), fonts?.load?.('700 16px Inter')]);
  const [providers, picture] = await Promise.all([get('/api/satellite/providers').catch(() => []), logo().catch(() => null)]);
  return {
    providers: Array.isArray(providers) ? providers : [],
    logo: picture,
    style: defaultProofTemplate(templatesState.proof, prefs.proofTemplate)?.data ?? null,
    handle: prefs.signatureHandle ?? '',
  };
}

/**
 * Draw the recap map of `slides` whole with these `options` (`recapMap.mapOptions`), its
 * ground's tiles asked of the app, and file it as made from `video`. Answers its case
 * path. Throws when it cannot be drawn whole: no map for these places, or a tile that did
 * not come, which would leave a hole in the picture.
 */
export async function makeRecapMap(caseId, { video, slides, options }, {
  build = buildRecapMap, post = api.post, loadTile = loadAppTile, signing = recapSigning,
} = {}) {
  const places = recapPlaces(slides);
  const fit = recapFit(places);
  if (!fit.ok) throw new Error('these places have no map');
  const signed = await signing();
  const { blob, missing, asked } = await build(places, fit, options, { ...signed, loadTile });
  if (missing) throw new Error(`${missing} of its ${asked} tiles did not load`);
  return fileRecapMap(caseId, { video, blob }, { post });
}
