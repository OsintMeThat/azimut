/**
 * A pinned Detect candidate as it goes into a note: the evidence picture the pin
 * filed, captioned with what the run measured and when, never with a verdict.
 *
 * Only a pinned candidate can go in. Pinning is the one act that puts Detect's
 * evidence in the case; a candidate still in the queue is a lead, not a finding.
 */
import { picturePut } from '../../lib/notes/syntax.js';
import { formatArea } from '../../lib/measure.js';
import { formatTemporalValue } from '../../lib/timeline.js';

/** A pass's day as a caption writes it, or ''. */
export function passDay(source) {
  const value = String(source?.date ?? '').slice(0, 10);
  return value ? formatTemporalValue(value).label : '';
}

/**
 * What the run measured on the candidate, as its caption: the reading and its
 * strength, its area, and the passes it was read between (or on, for a method
 * that reads one pass). `NBR 0.61 → −0.28 (strong) · 1.2 ha · between 2 Mar 2026 and 14 Mar 2026`.
 */
export function pinCaption({ reading = '', strength = '', area = 0, units = 'metric', a = null, b = null, single = false } = {}) {
  const measured = [String(reading ?? '').trim(), strength ? `(${String(strength).toLowerCase()})` : '']
    .filter(Boolean).join(' ');
  const size = Number(area) > 0 ? formatArea(Number(area), units) : '';
  const first = passDay(a);
  const second = passDay(b);
  const when = single || !first || first === second
    ? (second ? `seen ${second}` : '')
    : (second ? `between ${first} and ${second}` : '');
  return [measured, size, when].filter(Boolean).join(' · ');
}

/**
 * The pinned candidate offered to a pinned note. `evidence()` answers the pin's
 * picture and its name (`{ entity, label }`) and `caption()` the measured facts.
 */
export function pinOffer({ evidence, caption }) {
  return {
    id: 'pin',
    label: 'This pin',
    hint: 'Its evidence picture, captioned with what was measured',
    icon: 'pin',
    picture: true,
    put: async ({ signal } = {}) => {
      // The words first: the candidate on screen may change while the picture is found.
      const words = caption();
      const { entity, label } = await evidence({ signal });
      if (!entity?.id) throw new Error('The pin’s evidence picture is no longer in the case');
      return { text: picturePut(entity, { label, caption: words }), filed: [] };
    },
  };
}
