/**
 * What the axis can print without two names on the same pixels.
 *
 * Ticks and bands are chosen by span, and their names are as wide as their words. At
 * the edge of a window, or where a day's name meets the hour beside it, two of them
 * landed on each other ("22 Jun20:00"), and a band cut by the window's edge showed half
 * a date ("21 Jun 20"). A name that does not fit is shortened or left out; the line it
 * labels stays.
 *
 * Widths are estimated from the monospace sizes the axis is drawn in, which is exact
 * enough to keep names apart without measuring text in the browser.
 */

const width = (label, char) => String(label ?? '').length * char;

/**
 * The ruler's ticks, each name kept only if it clears the one before it.
 *
 * `ticks` carry `left` in percent. A name is drawn to the right of its line, and to the
 * left of it past `endAt` percent, so the last one stays inside the ruler.
 */
export function fitTicks(ticks, rulerWidth, { char = 6.1, gap = 8, endAt = 94 } = {}) {
  let reach = -Infinity;
  return ticks.map((tick) => {
    if (!tick.label) return tick;
    const x = (tick.left / 100) * rulerWidth;
    const size = width(tick.label, char);
    const [start, end] = tick.left > endAt ? [x - 5 - size, x - 5] : [x + 5, x + 5 + size];
    if (start < reach + gap) return { ...tick, label: '' };
    reach = end;
    return tick;
  });
}

/**
 * The day, month or year bands over the ruler, each named only if the name fits.
 *
 * A band too narrow for `22 Jun 2023` says `22 Jun`, since the next band names the year,
 * and one too narrow for that says nothing.
 */
export function fitBands(bands, rulerWidth, { char = 5.5, padding = 14 } = {}) {
  return bands.map((band) => {
    const room = (band.width / 100) * rulerWidth - padding;
    if (width(band.label, char) <= room) return band;
    const short = String(band.label ?? '').replace(/\s\d{4}$/, '');
    return { ...band, label: short !== band.label && width(short, char) <= room ? short : '' };
  });
}

/**
 * The overview's period names, each kept only if it clears the one before it.
 *
 * `densityTicks` names one slot in every few and lets the name run over its
 * neighbours, centred under its own slot (the two outermost lean inward), so what can
 * collide is two names, not a name and its slot.
 */
export function fitSlots(slots, stripWidth, { char = 5, gap = 6 } = {}) {
  let reach = -Infinity;
  return slots.map((slot) => {
    if (!slot.label) return slot;
    const size = width(slot.label, char);
    const left = (slot.left / 100) * stripWidth;
    const right = left + (slot.width / 100) * stripWidth;
    const middle = (left + right) / 2;
    // A centred name wider than its box is not centred: the line overflows from the
    // box's start edge, so that is where it is measured from.
    const [start, end] = slot.anchor === 'end' ? [right - size, right]
      : slot.anchor === 'start' || size > right - left ? [left, left + size]
        : [middle - size / 2, middle + size / 2];
    if (start < reach + gap) return { ...slot, label: '' };
    reach = end;
    return slot;
  });
}

/**
 * Whether the whole-case strip has anything to show: only once the window leaves part
 * of the case out. A window that holds every dated entry is its own overview, and the
 * strip then drew the same dots a second time above them.
 */
export function overviewNeeded(extent, window) {
  if (!extent?.from || !window) return false;
  const first = Date.parse(extent.from);
  const last = Date.parse(extent.to ?? extent.from);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return false;
  return first < window.start || last > window.end;
}
