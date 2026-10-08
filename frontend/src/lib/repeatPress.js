/**
 * A press that acts at once and, held, again and again: the small arrows that
 * step a number, where a wheel notch overshoots. `start(event)` on
 * pointerdown, `stop()` on pointerup, leave and cancel. Shift held at the
 * press is handed to every act, for a larger step.
 */
export function repeatPress(act, { delay = 400, every = 70, later = setTimeout, cancel = clearTimeout } = {}) {
  let timer = null;

  function stop() {
    if (timer) cancel(timer);
    timer = null;
  }

  function start(event) {
    if (event?.button !== undefined && event.button !== 0) return;
    event?.preventDefault?.();
    stop();
    const shift = Boolean(event?.shiftKey);
    act(shift);
    const again = () => {
      act(shift);
      timer = later(again, every);
    };
    timer = later(again, delay);
  }

  return { start, stop };
}

/** A number stepped by `step` (ten times it with Shift), kept within bounds and to the step's own decimals. */
export function stepped(value, direction, step, { shift = false, min = -Infinity, max = Infinity } = {}) {
  const size = step * (shift ? 10 : 1);
  const decimals = Math.max(0, (String(step).split('.')[1] ?? '').length);
  const next = (Number(value) || 0) + direction * size;
  return Number(Math.min(max, Math.max(min, next)).toFixed(decimals));
}
