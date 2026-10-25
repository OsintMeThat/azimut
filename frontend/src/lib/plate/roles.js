/**
 * What a layer stands for on a published map, and the look the genre gives it: the
 * ground held in a full tint of the accent, the ground claimed hatched in it, the
 * contested hatched amber and dotted round, the front as a strong line in the ink,
 * the events as marks a little larger, the context grey and quiet. One press sets a
 * layer's look on this plate; its colour, lines and marks stay the analyst's to change.
 */

/** Amber for what is contested: neither side's colour. */
const CONTESTED = '#e69f00';
const CONTEXT = '#8a8f96';

/** `[role, label]`, as the inspector lists them. */
export const ROLE_LIST = [
  ['held', 'Held'],
  ['claimed', 'Claimed'],
  ['contested', 'Contested'],
  ['line', 'Front line'],
  ['events', 'Events'],
  ['context', 'Context'],
];

/** The look each role gives a layer on the page `theme`. */
export function roleLook(role, theme = {}) {
  const accent = theme.accent ?? '#c8102e';
  switch (role) {
    case 'held': return { colour: accent, fill: 'solid', dash: '', stroke: 1, icons: 1 };
    case 'claimed': return { colour: accent, fill: 'hatch', dash: 'dashed', stroke: 1, icons: 1 };
    case 'contested': return { colour: CONTESTED, fill: 'hatch', dash: 'dotted', stroke: 1, icons: 1 };
    case 'line': return { colour: theme.ink ?? '#15181e', fill: 'none', dash: '', stroke: 2, icons: 1 };
    case 'events': return { colour: null, fill: '', dash: '', stroke: 1, icons: 1.25 };
    case 'context': return { colour: CONTEXT, fill: '', dash: '', stroke: 0.75, icons: 0.75 };
    default: return { colour: null, fill: '', dash: '', stroke: 1, icons: 1 };
  }
}

/** A map's layer entry given `role` on `theme`, or back to its own look with none. */
export function withRole(entry, role, theme) {
  return { ...entry, role: ROLE_LIST.some(([id]) => id === role) ? role : '', ...roleLook(role, theme) };
}

/** What the legend calls a layer's areas and lines when it stands for a role. */
export const roleLabel = (role) => ROLE_LIST.find(([id]) => id === role)?.[1] ?? '';

/**
 * The properties a feature takes from its layer's fill on this plate: a full tint, a
 * hatching over a light one, or none; nothing when the layer keeps its own.
 */
export function fillProperties(fill) {
  if (fill === 'solid') return { fill_opacity: 0.42, area_fill: '' };
  if (fill === 'hatch') return { area_fill: 'hatch' };
  if (fill === 'none') return { area_fill: 'none' };
  return null;
}
