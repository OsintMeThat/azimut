/**
 * Make the proof, asked from the extension's map panel for the scene being geolocated
 * over another site's map (`extension/background.js`, `scene-proof`). The extension
 * brings this tab to the front and hands the scene over (`lib/extBridge.js`,
 * `onSceneProof`); this tab opens Inspect's Make the proof chooser on it, as the
 * pill's own button does (`components/GeolocatingPill.svelte`). The panel's pill links
 * hand the scene over the same way with somewhere else to go (`to`): Inspect on the
 * scene, or Satellite or Horizon at the spot that map showed (`view`).
 *
 * Nothing is written from the map page. A scene of another case opens that case
 * first, through `openCase` and the guards that ask about unsaved work; kept where
 * it was, the tab says so and stays. A detached map window refuses: the extension
 * hands the scene to a main tab only.
 */
import { geolocating, goWithScene, openHeldProof, readGeolocating } from './geolocating.svelte.js';
import { caseState, openCase, refreshCaseList, sessionStarted, toast, uiState } from './state.svelte.js';

// The hand-offs taken: the extension asks again while a tab is still loading, and a
// late answer to the first ask must not open the chooser twice.
const taken = new Set();

/** Take a scene handed over, or refuse it in a map window. Answers at once. */
export function takeSceneProof(scene, { solo = false } = {}) {
  if (solo) return { ok: false, refused: true, error: 'a map window of Azimut makes no proof' };
  if (scene.id) {
    if (taken.has(scene.id)) return { ok: true };
    taken.add(scene.id);
  }
  proveScene(scene);
  return { ok: true };
}

/** The scene's case open, then Inspect's chooser on the scene, or where its link goes.
 *  Says its own trouble. */
export async function proveScene({ caseId, video, draft, to = 'proof', view = null }) {
  await sessionStarted();
  if (caseState.current?.id !== caseId) {
    const named = () => caseState.list.find((one) => one.id === caseId);
    if (!named()) await refreshCaseList().catch(() => {});
    const known = named();
    if (!known) {
      toast('The scene’s case is not in this Azimut', 'warn');
      return false;
    }
    let opened = false;
    try {
      opened = await openCase(caseId);
    } catch (e) {
      toast(e.message, 'danger');
      return false;
    }
    if (!opened) {
      toast(`Stayed in this case. The scene is in “${known.name}”`, 'info');
      return false;
    }
  }
  if (to === 'satellite' || to === 'horizon') {
    goWithScene(to, view);
    return true;
  }
  // Make the proof of a scene a proof already took up opens that proof, as the pill does
  if (to === 'proof') {
    const held = geolocating.caseId === caseId ? geolocating.scene : await readGeolocating(caseId);
    if (held?.video === video && held.id === draft && openHeldProof(held)) return true;
  }
  uiState.inspectScene = { video, draft, ...(to === 'proof' ? { proof: true } : {}) };
  uiState.tool = 'inspect';
  return true;
}
