/**
 * The line a reverse search leaves in a note: when it was made, what was searched, on
 * which engines, and an empty "Result:" for the analyst to fill. A search that found
 * nothing is a result too, and the one a report most needs to say ("no earlier copy on
 * Lens, Yandex or TinEye as of 4 Nov"), so the line is written before the answer is known.
 *
 * Azimut never runs the search: the engines are the ones whose buttons were pressed for
 * this picture, so the line claims no more than was done.
 */
import { UPLOAD_PAGES } from '../reverseSearch.js';
import { entityReference } from '../markdown.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (value) => String(value).padStart(2, '0');

/** An engine as a sentence names it: Google's is Lens. */
const SHORT = { google: 'Lens' };
export const engineName = (engine) => SHORT[engine.id] ?? engine.label;

/** `4 Nov 2026 21:40 UTC`: the minute the search was logged, whatever the analyst's clock. */
export function utcStamp(now = new Date()) {
  return `${now.getUTCDate()} ${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())} UTC`;
}

/** A moment in a video as a log says it: `00:12`, `1:02:30` past the hour. */
export function frameTime(seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours ? `${hours}:${pad(minutes)}:${pad(whole % 60)}` : `${pad(minutes)}:${pad(whole % 60)}`;
}

/** The engines named, in the order the tool lists them: the ones `pressed`, else every engine it offers. */
export function enginesSaid(pressed = []) {
  const chosen = UPLOAD_PAGES.filter((engine) => pressed.includes(engine.id));
  return (chosen.length ? chosen : UPLOAD_PAGES).map(engineName);
}

/**
 * The line to write. `entity` is the case file searched (a chip), `label` its name when
 * it is none (a frame not filed in the case), `time` the moment of a video, `pressed`
 * the engines pressed for it. Ends on `Result:` for the analyst to continue.
 */
export function searchLine({ now = new Date(), entity = null, label = '', time = null, pressed = [] } = {}) {
  const named = entity?.id ? entityReference({ id: entity.id, label: entity.label || label || 'File' }) : String(label ?? '').trim() || 'a picture';
  const what = time !== null && time !== undefined ? `frame ${frameTime(time)} of ${named}` : named;
  return `Reverse search, ${utcStamp(now)}: ${what} on ${enginesSaid(pressed).join(', ')}. Result:`;
}

/**
 * The search offered to a pinned note, written with the cursor after it. `read()` answers
 * `{ entity, label, time, pressed }`, looking the file up in the case when it must.
 */
export function searchOffer({ read, now = () => new Date() }) {
  return {
    id: 'reverse-log',
    label: 'This search',
    hint: 'One line: when, what and which engines, ready for the result',
    icon: 'search',
    put: async () => {
      const searched = await read();
      if (!searched) throw new Error('Pick a picture to search first');
      return { text: searchLine({ now: now(), ...searched }), caret: true };
    },
  };
}
