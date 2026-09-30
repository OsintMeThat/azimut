/**
 * What the tool on screen is looking at, for the Add event bar.
 *
 * The bar opens over whichever tool the analyst is in, and an event noted from a
 * video should already cite that video. So each tool that has a current thing says
 * so here; the bar reads it for the tool it is opened over and nothing else, so a
 * selection left in a hidden tab never seats itself on a line typed somewhere else.
 *
 * Only what the tool knows for certain: the thing selected. A date is never offered
 * (D3), a place only when the file has exactly one confirmed (`placeOf`), and no
 * subject is guessed from anything.
 */
export const noteHere = $state({ byTool: {} });

/** A tool says what is selected in it, or null for nothing. Kept per tool, since
 *  every visited tool stays mounted and one hidden tab must not overwrite another's. */
export function offerNote(tool, entity) {
  noteHere.byTool[tool] = entity?.id
    ? { id: entity.id, label: entity.label ?? '', type: entity.type, attrs: entity.attrs ?? {} }
    : null;
}

/** A tool going away takes its selection back. */
export function withdrawNote(tool) {
  delete noteHere.byTool[tool];
}

/** The thing the bar seats for this tool, or null. */
export function noteEntityFor(tool) {
  return noteHere.byTool[tool] ?? null;
}

/** The verbs that put a file at a place. */
const PLACING = new Set(['located-at', 'depicts', 'sited-at']);

/**
 * The one place a file is confirmed at, read off its chain, or null.
 *
 * Only a single confirmed place is seated: two places are a choice for the analyst,
 * and seating a suggested one would confirm it through the one-hop rule without the
 * analyst having decided it.
 */
export function placeOf(chain) {
  const places = new Map();
  for (const relation of chain?.relations ?? []) {
    const { entity, link, direction } = relation ?? {};
    if (direction !== 'out' || !PLACING.has(link?.type) || entity?.type !== 'place') continue;
    if ((link.provenance?.status ?? 'confirmed') !== 'confirmed') return null;
    if ((entity.provenance?.status ?? 'confirmed') !== 'confirmed') return null;
    places.set(entity.id, entity);
  }
  if (places.size !== 1) return null;
  const [place] = places.values();
  return { id: place.id, label: place.label, type: place.type, attrs: place.attrs ?? {}, slot: 'at' };
}

/** Whether a keypress is the Add event shortcut, Alt+N, outside any field. */
export function isNoteKey(event) {
  if (!event?.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  if (event.code !== 'KeyN') return false;
  const editable = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
  return !event.target?.closest?.(editable);
}
