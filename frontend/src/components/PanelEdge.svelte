<script>
  /**
   * The edge of a side panel, dragged to make the panel wider or narrower. A double
   * click puts the width back, the arrows move it by steps, and the width it lands
   * on is kept (`lib/panelWidth.js`). `side` is the edge of the panel it stands on:
   * a panel on the right is widened by dragging its left edge leftward.
   *
   * A <button> rather than a bare div, so the edge is reached and moved from the
   * keyboard. Its parent is positioned.
   */
  let {
    width = $bindable(),
    /** The panel's width helpers (`panelWidth()`). */
    helpers,
    side = 'left',
    label = 'Resize the panel',
  } = $props();

  const STEP = 16;
  let dragging = $state(false);
  const clamp = (value) => helpers.clampWidth(value, window.innerWidth);

  function start(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const from = event.clientX;
    const was = width;
    const sign = side === 'left' ? -1 : 1;
    let wanted = was;
    let frame = 0;
    dragging = true;
    // the page under it is fitted again once a frame, not once an event
    const move = (moved) => {
      wanted = was + sign * (moved.clientX - from);
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; width = clamp(wanted); });
    };
    const up = () => {
      if (frame) cancelAnimationFrame(frame);
      width = clamp(wanted);
      dragging = false;
      helpers.saveWidth(width);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function key(event) {
    const steps = side === 'left' ? { ArrowLeft: STEP, ArrowRight: -STEP } : { ArrowRight: STEP, ArrowLeft: -STEP };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    // the arrows move what is picked on the page otherwise
    event.stopPropagation();
    width = clamp(width + step);
    helpers.saveWidth(width);
  }

  function reset() {
    width = clamp(helpers.DEFAULT_W);
    helpers.saveWidth(width);
  }

  // A width chosen on a wide screen is brought in on a narrower window; what was chosen stays stored.
  $effect(() => {
    const fit = () => { width = clamp(width); };
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  });
</script>

<button type="button" class="edge {side}" class:dragging aria-label={label} title="Drag to resize, double-click to reset"
  onpointerdown={start} ondblclick={reset} onkeydown={key}></button>

<style>
  .edge { position: absolute; top: 0; bottom: 0; z-index: 8; width: 7px; padding: 0; border: 0; background: none; cursor: col-resize; }
  .edge.left { left: -4px; }
  .edge.right { right: -4px; }
  .edge::after { content: ''; position: absolute; top: 0; bottom: 0; left: 2px; width: 3px; border-radius: 2px; background: var(--accent);
    opacity: 0; transition: opacity .15s; }
  .edge:hover::after, .edge:focus-visible::after, .edge.dragging::after { opacity: 1; }
  .edge:focus-visible { outline: none; }
</style>
