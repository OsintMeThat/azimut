/**
 * Geo Proof's side column, in tabs: the proof's facts, its scene, its layout and its
 * style. One column ran from the house style down to the signature, and the panels
 * and the elements, where composing happens, sat under the fields filled once.
 *
 * Which tab a proof opens on is the composer's (`ProofComposer`): a new one on Layout,
 * since it starts by adding panels; one made from a scene of Inspect on Proof, its
 * facts still to fill; any other keeps the tab in use, for the session only.
 */
import { parseLooseDate } from '../../lib/looseDate.js';

/** The tabs in order. Scene is there only for a proof that rests on a video. */
export const SIDE_TABS = [
  { id: 'proof', label: 'Proof', title: 'Coordinates, source, description and date' },
  { id: 'scene', label: 'Scene', title: 'The video the proof is about, and when in it' },
  { id: 'layout', label: 'Layout', title: 'Panels, overlays, annotations and elements' },
  { id: 'style', label: 'Style', title: 'House style, text, footer and signature' },
];

/** The tabs a proof shows. */
export const sideTabs = (hasScene) => SIDE_TABS.filter((one) => one.id !== 'scene' || hasScene);

/** The tab shown for the one asked: Scene falls back to Layout, where its video's panels went. */
export const shownTab = (wanted, hasScene) => (wanted === 'scene' && !hasScene ? 'layout' : wanted);

/**
 * What the Proof tab still needs, the fields that carry a `!`, in the order they
 * stand: no point, no source, and a date the save would refuse.
 */
export function proofNeeds({ coords, source, when }) {
  const needs = [];
  if (!coords) needs.push('coordinates');
  if (!source) needs.push('a source');
  if (when && parseLooseDate(when).error) needs.push('a date it can read');
  return needs;
}

/** Those needs as the tab says them on hover, or '' when it needs nothing. */
export function needsWords(needs) {
  if (!needs.length) return '';
  const list = needs.length === 1 ? needs[0] : `${needs.slice(0, -1).join(', ')} and ${needs.at(-1)}`;
  return `Still needs ${list}`;
}
