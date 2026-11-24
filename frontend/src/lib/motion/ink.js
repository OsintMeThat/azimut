/**
 * The accent mark beside the chosen rail stage or under the chosen tab, sliding
 * from one choice to the next instead of jumping.
 *
 * A Svelte action on the strip. It lays the strip's own `.ink` child along the
 * strip's `.active` child, by offsets so a strip that scrolls carries the mark
 * with it. The mark is one pixel scaled to the choice's length, so only
 * `transform` moves. The first placement lands without a slide; the slide's
 * length is the CSS's (`--motion-slide`, 0 under reduced motion). With nothing
 * chosen the mark fades out.
 */
export function ink(strip, axis = 'x') {
  let frame = 0;
  let placed = false;

  const place = () => {
    frame = 0;
    const mark = strip.querySelector(':scope > .ink');
    if (!mark) return;
    const active = strip.querySelector(':scope > .active');
    if (!active || !active.offsetWidth) {
      mark.style.opacity = '0';
      placed = false;
      return;
    }
    if (!placed) mark.classList.add('ink-instant');
    mark.style.transform = inkTransform(active, axis);
    mark.style.opacity = '1';
    if (!placed) {
      void mark.offsetWidth; // lands first, then slides from there on
      mark.classList.remove('ink-instant');
      placed = true;
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(place);
  };

  // a choice is a class moving between children, or children coming and going
  const changes = new MutationObserver(schedule);
  changes.observe(strip, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  sizes?.observe(strip);
  schedule();

  return {
    update(next) {
      axis = next;
      schedule();
    },
    destroy() {
      cancelAnimationFrame(frame);
      changes.disconnect();
      sizes?.disconnect();
    },
  };
}

/** The transform laying a one-pixel mark along `el`: across its width (`x`) or down its height (`y`). */
export function inkTransform(el, axis) {
  return axis === 'y'
    ? `translateY(${el.offsetTop}px) scaleY(${el.offsetHeight})`
    : `translateX(${el.offsetLeft}px) scaleX(${el.offsetWidth})`;
}
