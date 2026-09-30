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
export const noteHere = $state({ byTool: {}, datesByTool: {} });

/**
 * A tool says what is selected in it, or null for nothing, and the dates it can
 * offer beside the date field (a pair's "between A and B"), each one press, never
 * filled in by itself. Kept per tool, since every visited tool stays mounted and one
 * hidden tab must not overwrite another's.
 */
export function offerNote(tool, entity, { dates = [] } = {}) {
  noteHere.byTool[tool] = entity?.id
    ? { id: entity.id, label: entity.label ?? '', type: entity.type, attrs: entity.attrs ?? {} }
    : null;
  // A function is read when the bar opens: a map's pictures know their dates only
  // when asked, and a list copied at every pan would be work nobody reads.
  noteHere.datesByTool[tool] = typeof dates === 'function' ? dates : dates.filter((offer) => offer?.value);
}

/** A tool going away takes its selection back. */
export function withdrawNote(tool) {
  delete noteHere.byTool[tool];
  delete noteHere.datesByTool[tool];
}

/** The thing the bar seats for this tool, or null. */
export function noteEntityFor(tool) {
  return noteHere.byTool[tool] ?? null;
}

/** The dates this tool offers the bar. */
export function noteDatesFor(tool) {
  const held = noteHere.datesByTool[tool];
  const dates = typeof held === 'function' ? held() : held;
  return (dates ?? []).filter((offer) => offer?.value);
}

/**
 * The dates a pair of pictures offers: each one, and the span between them, which is
 * what a change seen between two pictures is known to within. `a` and `b` are
 * `{ value, exact }`, each picture's date as the case writes it and whether it is
 * the picture's own or a release's; the span is `lib/timeline`'s `changeInterval`,
 * handed in so this stays pure.
 */
export function pairOffers(a, b, { interval, label }) {
  // A picture known only to its release date is an estimate, and says so, in the
  // value it offers and in its words.
  const mark = (side) => (side?.value ? `${side.value}${side.exact === false ? '~' : ''}` : '');
  const say = (side) => (side?.value ? `${side.exact === false ? '~' : ''}${label(side.value)}` : '');
  const first = mark(a);
  const second = mark(b);
  const offers = [];
  const between = first && second ? interval(first, second) : '';
  if (between) {
    offers.push({ kind: 'between', value: between, words: `between ${say(a)} and ${say(b)}`, hint: 'The change happened between the two pictures' });
  }
  if (first) offers.push({ kind: 'picture A', value: first, words: `A ${say(a)}`, hint: 'Use the day picture A was taken' });
  if (second) offers.push({ kind: 'picture B', value: second, words: `B ${say(b)}`, hint: 'Use the day picture B was taken' });
  return offers;
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
