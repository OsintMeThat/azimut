/**
 * What the style button of a personal layer edits, and how it reads.
 *
 * With features selected it edits them. With none it sets the style of the next
 * markers, and the group they go into. A group with one style for all its
 * features draws them in that style whatever each says, so a pick on them
 * restyles the group: changing a marker that would not visibly change is the
 * one thing the button must not do. A group with one colour does so for the
 * colour alone: each feature keeps its icon, a colour picked recolours the group.
 *
 * A style is `{ symbol, colour }`, with `icon` when it wears one of the
 * analyst's own icons, which wins over the symbol.
 */

const PLAIN = '#0072b2';
const isPoint = (feature) => feature?.geometry?.type === 'Point';
const same = (first, second) => String(first ?? '').toLowerCase() === String(second ?? '').toLowerCase();

/** How a feature is drawn: its group's style when the group has one style, its colour when it has one colour. */
export function drawnStyle(feature, group) {
  const icon = (group?.mode === 'uniform' ? group.icon : feature.properties.icon) || '';
  const style = group?.mode === 'uniform' ? { symbol: group.symbol || 'pin', colour: group.colour || PLAIN }
    : { symbol: feature.properties.symbol || 'pin',
      colour: (group?.mode === 'colour' ? group.colour : feature.properties.colour || group?.colour) || PLAIN };
  return icon ? { ...style, icon } : style;
}

/**
 * Split a pick between a group in one colour and its features: a colour alone
 * goes to the group, an icon to the features. A style of the layer's own brings
 * its icon only, as its colour would recolour the whole group. `{ group, own }`.
 */
export function splitPick(changes) {
  const { colour, ...own } = changes;
  if (Object.keys(own).length) return { group: {}, own };
  return { group: colour === undefined ? {} : { colour }, own };
}

/** The styles a layer already shows, at most `limit`, markers' or lines' and areas'. */
export function usedStyles(features, groups, { point = true, limit = 12 } = {}) {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const seen = new Map();
  for (const feature of features) {
    if (isPoint(feature) !== point) continue;
    const style = drawnStyle(feature, byId.get(feature.properties.group));
    const key = point ? `${style.icon || style.symbol}|${style.colour.toLowerCase()}` : style.colour.toLowerCase();
    if (!seen.has(key)) seen.set(key, point ? style : { colour: style.colour });
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

/** Every colour a layer is drawn in, its markers', lines' and areas', once each: what its key lists. */
export function wornColours(features, groups) {
  const byId = new Map(groups.map((group) => [group.id, group]));
  return [...new Set(features.map((feature) => drawnStyle(feature, byId.get(feature.properties.group)).colour.toLowerCase()))];
}

/**
 * The button's state for `chosen` features, or for the next markers (`draft`
 * into the group `into`) when none are chosen: the style it shows, whether the
 * chosen differ, the group they share, the group a pick restyles (`uniform`)
 * or recolours (`tinted`), and a note.
 */
export function styleTarget({ chosen = [], groups = [], into = '', draft = { symbol: 'pin', colour: PLAIN } }) {
  const byId = new Map(groups.map((group) => [group.id, group]));
  if (!chosen.length) {
    const group = byId.get(into) ?? groups[0] ?? null;
    const uniform = group?.mode === 'uniform' ? group : null;
    const tinted = group?.mode === 'colour' ? group : null;
    return {
      ...(uniform ? drawnStyle({ properties: {} }, uniform)
        : { symbol: draft.symbol || 'pin', colour: (tinted ? tinted.colour : draft.colour) || PLAIN, ...(draft.icon ? { icon: draft.icon } : {}) }),
      point: true, mixed: false, group: group?.id ?? '', uniform, tinted,
      note: uniform ? `New markers in ${uniform.name} take its one style. A pick here restyles the whole group.`
        : tinted ? `New markers in ${tinted.name} take its one colour. A colour picked here recolours the whole group.` : '',
    };
  }
  const ids = [...new Set(chosen.map((feature) => feature.properties.group))];
  const shared = ids.length === 1 ? byId.get(ids[0]) ?? null : null;
  const uniform = shared?.mode === 'uniform' ? shared : null;
  const tinted = shared?.mode === 'colour' ? shared : null;
  const styles = chosen.map((feature) => drawnStyle(feature, byId.get(feature.properties.group)));
  const point = chosen.some(isPoint);
  const first = styles[chosen.findIndex(isPoint)] ?? styles[0];
  const mixed = styles.some((style, index) => !same(style.colour, first.colour)
    || (isPoint(chosen[index]) && point && (style.symbol !== first.symbol || (style.icon ?? '') !== (first.icon ?? ''))));
  const some = (mode) => !shared && chosen.some((feature) => byId.get(feature.properties.group)?.mode === mode);
  return {
    ...first, point, mixed, group: shared?.id ?? '', uniform, tinted,
    note: uniform ? `${uniform.name} has one style for all its features. A pick here restyles the whole group.`
      : tinted ? `${tinted.name} has one colour for all its features. A colour picked here recolours the whole group.`
        : some('uniform') ? 'Features in a group with one style keep that style.'
          : some('colour') ? 'Features in a group with one colour keep that colour.' : '',
  };
}
