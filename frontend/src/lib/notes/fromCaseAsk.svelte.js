/**
 * What *From the case* asks, and the count it answers (`lib/notes/fromCase.js`).
 *
 * Four things and nothing else: the days, on the case's clock; whether a day means
 * what the item shows or when it was geolocated; a figure each or a table; and the
 * count, said again as either of the first two changes. It opens on every day the
 * case's geolocations cover, so the count means something before anything is touched.
 * The note is written from the count on screen, so `ready` is true only once the count
 * answers the question as it stands and holds something.
 *
 * Called while a component starts, since it owns effects. `active` says whether the
 * questions are on screen: nothing is read from the case while they are not.
 */
import { untrack } from 'svelte';
import { axisZone, caseAxis, learnAxisZone } from '../caseAxis.svelte.js';
import { offsetLabel, zoneWords } from '../timeline.js';
import { countWords, fromCaseNote, periodTitle, readFromCase } from './fromCase.js';

/** How long the count waits for the question to stop changing. */
const SETTLE = 220;

export function fromCaseAsk({ caseId, active = () => true }) {
  let from = $state('');
  let to = $state('');
  let by = $state('shown');
  let layout = $state('figures');
  let picked = $state(false); // the analyst chose the days; until then they follow the reading
  let found = $state(null); // the answer for `answered`
  let answered = $state('');
  let reading = $state(false);
  let failed = $state('');

  $effect(() => {
    if (active()) void learnAxisZone(caseId());
  });
  const zone = $derived(caseAxis.caseId === caseId() ? axisZone(caseId()) : 'UTC');
  // the offset the zone keeps in the period, not today: a summer clock is an hour off in March
  const clockSaid = $derived(zone === 'UTC'
    ? 'Days on the case’s clock: UTC'
    : `Days on the case’s clock: ${zoneWords(zone).place} (${offsetLabel(zone, from ? Date.parse(`${from}T12:00:00Z`) : Date.now())})`);
  const asked = $derived(`${from}|${to}|${by}|${zone}`);
  const current = $derived(Boolean(found) && answered === asked);
  const ready = $derived(current && !reading && (found?.total ?? 0) > 0);
  const said = $derived(failed || (!current ? 'Counting…'
    : found?.first || found?.undated ? countWords(found, by) : 'This case holds no geolocation yet.'));

  // the count follows the question, a moment after it stops changing
  $effect(() => {
    if (!active()) {
      reading = false;
      return;
    }
    const id = caseId();
    const question = { from, to, by, zone, key: asked };
    const open = !untrack(() => picked);
    if (untrack(() => answered) === question.key) {
      reading = false;
      return;
    }
    const controller = new AbortController();
    reading = true;
    failed = '';
    const timer = setTimeout(() => {
      readFromCase(id, open ? { by: question.by, zone: question.zone } : question, { signal: controller.signal })
        .then((answer) => {
          if (controller.signal.aborted) return;
          reading = false;
          found = answer;
          if (open) {
            // every day the reading covers, which counts the same as no bound at all
            from = answer.first ?? '';
            to = answer.last ?? '';
            answered = `${from}|${to}|${question.by}|${question.zone}`;
          } else {
            answered = question.key;
          }
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          reading = false;
          failed = error.message || 'The case could not be read.';
        });
    }, SETTLE);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  function pickDay(side, day) {
    picked = true;
    if (side === 'from') {
      from = day;
      if (to && day > to) to = day;
    } else {
      to = day;
      if (from && day < from) from = day;
    }
  }

  return {
    get from() { return from; },
    get to() { return to; },
    get by() { return by; },
    set by(value) { by = value; },
    get layout() { return layout; },
    set layout(value) { layout = value; },
    get found() { return found; },
    get current() { return current; },
    get ready() { return ready; },
    get said() { return said; },
    get clockSaid() { return clockSaid; },
    /** The note's name when none is typed: the period in words. */
    get title() { return periodTitle(from, to, by); },
    pickDay,
    /** The note the count describes, `{ title, body }`, under the name given. */
    note(title) {
      return fromCaseNote(found, { from, to, by, zone, layout, title });
    },
  };
}
