/**
 * Ready sequences for a played plate's video: the steps a short map film is usually cut
 * in, each framing the main map its own way, with the transitions on so the map flies
 * from one to the next. A card is a step whose page is covered by the paper and its
 * words: a title before the map, the sources after it.
 *
 * They only add steps, framings and a card's elements; the analyst moves, renames,
 * times or removes each one as any other step.
 */
import { addStep, framedAs, mapsFirst, newId, pageSize } from './page.js';
import { styled } from './design.js';

/** `[kind, label, icon, words]`, as the Add panel lists them, and each one's beats. */
export const SEQUENCES = {
  'seq-reveal': { label: 'Reveal in four beats', icon: 'stack', words: 'sequence story film intro zoom',
    beats: [{ name: 'The region', zoom: -3, seconds: 3 }, { name: 'The place', zoom: 0, seconds: 3 }, { name: 'Closer', zoom: 2, seconds: 3 },
      { name: 'The whole picture', zoom: -1, seconds: 4 }] },
  'seq-zoom': { label: 'Zoom in', icon: 'zoomInset', words: 'sequence closer approach film',
    beats: [{ name: 'Wide', zoom: -4, seconds: 2.5 }, { name: 'Nearer', zoom: -2, seconds: 2.5 }, { name: 'The place', zoom: 0, seconds: 4 }] },
  'seq-title': { label: 'Title card', icon: 'text', words: 'intro opening card film', beats: [{ name: 'Title', card: 'title', seconds: 3 }] },
  'seq-end': { label: 'End card', icon: 'info', words: 'outro closing sources credits card film', beats: [{ name: 'Sources', card: 'end', seconds: 4 }] },
};
export const SEQUENCE_ADDS = Object.entries(SEQUENCES).map(([kind, entry]) => [kind, entry.label, entry.icon, entry.words]);

/** What a video's transitions are once a sequence turns them on: a fade, the map flying, what is new fading in. */
const ON = { on: true, seconds: 0.8, fade: true, move: true, blur: true, appear: 'fade' };

/** Millimetres a line of words `size` points tall takes, its leading included, with room for the face's ascent and descent. */
const lineMm = (size, leading = 1.15) => size * 0.3528 * Math.max(leading, 1.3) + 1;

/**
 * A card's elements on step `step`: the paper over the page, a short rule in the
 * accent, and its words in the page's styles, sized to the page and stood in its
 * middle, so a title card reads on a phone's story as on a slide.
 */
function card(kind, step, spec) {
  const { width: W, height: H } = pageSize(spec.page);
  const unit = Math.min(W, H);
  const m = Math.max(12, unit * 0.1);
  const w = W - 2 * m;
  const t = spec.theme;
  const on = { step, carry: false };
  const round = (box) => box.map((value) => Math.round(value * 10) / 10);
  // the style first, then the size the page gives it
  const text = (role, box, words, more = {}) => ({ ...styled({ id: newId('text'), kind: 'text', box: round(box), text: words,
    align: 'left', valign: 'top', ...on }, role, t), ...more });
  const cover = { id: newId('shape'), kind: 'shape', shape: 'rect', name: kind === 'title' ? 'Title card' : 'End card', box: round([0, 0, W, H]),
    width: 1, border: false, fill: t.paper, ...on };
  const rule = (y) => ({ id: newId('shape'), kind: 'shape', shape: 'rect', name: 'Rule', box: round([m, y, Math.min(18, w * 0.12), 1.4]),
    width: 1, border: false, fill: t.accent, ...on });
  const kicker = Math.max(8, Math.min(16, unit * 0.052));
  if (kind === 'title') {
    const title = Math.max(22, Math.min(72, unit * 0.19));
    const dek = Math.max(10, Math.min(24, unit * 0.072));
    const heights = [1.4, 4, lineMm(kicker), 3, lineMm(title, 1.1) * 2, 4, lineMm(dek, 1.3) * 2];
    let y = (H - heights.reduce((sum, value) => sum + value, 0)) / 2;
    const at = (index) => { const top = y; y += heights[index] + (heights[index + 1] ?? 0); return top; };
    const ruleY = at(0);
    const kickerY = at(2);
    const titleY = at(4);
    return [cover, rule(ruleY),
      text('kicker', [m, kickerY, w, lineMm(kicker)], 'Investigation', { size: kicker }),
      // two lines' room, a short title standing in its middle so it keeps near its kicker and its standfirst
      text('title', [m, titleY, w, lineMm(title, 1.1) * 2], '{case}', { size: title, valign: 'middle' }),
      text('dek', [m, y, w, lineMm(dek, 1.3) * 2], 'As of {date}', { size: dek })];
  }
  const body = Math.max(10, Math.min(22, unit * 0.06));
  const top = H * 0.32;
  return [cover, rule(top),
    text('kicker', [m, top + 5.4, w, lineMm(kicker)], 'Sources', { size: kicker }),
    text('body', [m, top + 8 + lineMm(kicker), w, lineMm(body, 1.35) * 4], 'Geolocated footage and open imagery.', { size: body, leading: 1.35 }),
    text('source', [m, H - m - lineMm(9), w, lineMm(9)], '{handle} · {today}', { size: 9 })];
}

/**
 * The plate with sequence `kind` added on the day `at`, after the step `after` (null:
 * the first), the main map `map` framed by each beat from where it looks now, `view`:
 * `{ steps, framing, elements, transitions, step }`, `step` the last one added.
 */
export function withSequence(spec, at, kind, { map = null, view = null, after = null } = {}) {
  const sequence = SEQUENCES[kind];
  if (!sequence) return null;
  let working = { ...spec };
  let last = after;
  const added = [];
  for (const beat of sequence.beats) {
    const made = addStep(working, at, last, { id: newId('s'), name: beat.name, duration: beat.seconds });
    working = { ...working, steps: made.steps };
    last = made.step.id;
    if (beat.card) added.push(...card(beat.card, last, working));
    else if (map && view) working = { ...working, framing: framedAs(working, last, map.id, { ...view, zoom: Math.max(0, Math.min(20, view.zoom + beat.zoom)) }) };
  }
  return { steps: working.steps, framing: working.framing ?? {}, elements: mapsFirst([...spec.elements, ...added]),
    transitions: spec.transitions?.on ? spec.transitions : { ...ON, ...(spec.transitions ?? {}), on: true }, step: last };
}
