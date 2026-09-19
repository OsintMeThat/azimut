/**
 * A Claim filed from the entity it is about — the pure half of `QuickClaim.svelte`.
 *
 * The shape being filled is the one ONTOLOGY §2 calls a filed observation: a count
 * and a condition on the statement, `about` the model or the object, `at` a place,
 * `cites` the material. Starting from any one of those, the entity already has a
 * seat on it, and the form only asks for the rest.
 */

/**
 * The connectors an entity can take a seat on, most specific first.
 *
 * A place can be what a statement is `about` as well as where it happened, and a
 * video can be its subject as well as its evidence. Filed from the place or the
 * video, the everyday reading is the second one — *seen here*, *seen in this* — so
 * `at` and `cites` are tried before `about`.
 */
export const SEAT_ORDER = ['at', 'cites', 'about'];

/**
 * Where an entity goes on a Claim filed from it, and which of the statement's own
 * fields are worth asking for. Null when the vocabulary gives it no seat at all,
 * as for a post or a saved session.
 *
 * `accepts(verb)` answers from the relation registry, so the seat follows the verb
 * table rather than a second copy of it. The fields follow the family: a count is
 * of a model (`class`) and never of one named object, which is one; a condition is
 * a state a model's instances or a named object can be in.
 */
export function quickClaimSeat(family, accepts) {
  const slot = SEAT_ORDER.find((verb) => accepts(verb)) ?? null;
  if (!slot) return null;
  return {
    slot,
    count: family === 'class',
    condition: family === 'class' || family === 'asset',
  };
}

/** What the press files, said from where it is pressed: a tooltip per seat. */
export function claimActionTitle(slot) {
  return (
    {
      about: 'File a claim about this',
      at: 'File a claim placed here',
      cites: 'File a claim that rests on this',
    }[slot] ?? ''
  );
}

const names = (list) => list.map((entry) => String(entry ?? '').trim()).filter(Boolean).join(', ');

/**
 * The sentence the fields add up to, offered until the analyst writes their own.
 *
 * `2 × T-72B3 destroyed at Crossroads`, `Bridge 4 damaged`, `Seen at Crossroads`.
 * The count takes a `×` rather than a bare number because model names carry digits
 * of their own. With neither a subject nor a place there is nothing to say, and the
 * field stays empty rather than holding a sentence about nothing.
 */
export function composeClaimStatement({ count = null, condition = '', subjects = [], places = [] }) {
  const subject = names(subjects);
  const place = names(places);
  const state = String(condition ?? '').trim().toLowerCase();
  if (!subject) return place ? `Seen at ${place}` : '';
  const counted = Number.isInteger(count) && count > 0 ? `${count} × ${subject}` : subject;
  return `${counted} ${state || 'seen'}${place ? ` at ${place}` : ''}`;
}

/**
 * The request body the Timeline's claim route takes, from the form's state.
 *
 * A date filed with a *seen* statement is when it was seen, so it carries the
 * `observed` role; without a date there is no role to state. A count or a condition
 * the form did not ask for is never sent, whatever is left in its field.
 */
export function quickClaimBody({ statement, when, confidence, count, condition, about, at, cites, seat }) {
  const whole = Number(count);
  return {
    statement: String(statement ?? '').trim(),
    when: when || null,
    time_role: when ? 'observed' : null,
    confidence: confidence || null,
    count: seat?.count && Number.isInteger(whole) && whole > 0 ? whole : null,
    condition: seat?.condition && condition ? condition : null,
    about: [...new Set(about)],
    at: [...new Set(at)],
    cites: [...new Set(cites)],
  };
}
