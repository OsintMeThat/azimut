<script>
  /**
   * One button on the Geo Proof rail and the small panel it opens beside it.
   *
   * The panel is fixed-positioned so the rail can scroll without clipping it,
   * opens upward when the button sits in the lower half of the window, and
   * closes on a press outside it or on Escape. `button` draws the button's face;
   * the panel's content gets a `close` to call once a choice is made.
   */
  let { title, active = false, button, children } = $props();

  let open = $state(false);
  let wrap = $state();
  let btn = $state();
  let pos = $state({});
  const close = () => (open = false);

  $effect(() => {
    if (!open || !btn) return;
    const r = btn.getBoundingClientRect();
    const left = `${r.right + 6}px`;
    pos = r.top > window.innerHeight / 2
      ? { left, bottom: `${window.innerHeight - r.bottom}px` }
      : { left, top: `${r.top}px` };
  });

  $effect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrap && !wrap.contains(e.target)) open = false; };
    const onKey = (e) => { if (e.key === 'Escape') open = false; };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="tb-group" bind:this={wrap}>
  <button class="tb-btn" class:active={open || active} {title} aria-label={title} onclick={() => (open = !open)} bind:this={btn}>
    {@render button()}
  </button>
  <div class="flyout" class:open style:left={pos.left} style:top={pos.top} style:bottom={pos.bottom}>
    {@render children(close)}
  </div>
</div>

<style>
  .tb-group { display: contents; }
  .tb-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-sm);
    color: var(--text-3);
    flex-shrink: 0;
  }
  .tb-btn:hover { color: var(--text-1); background: var(--bg-2); }
  .tb-btn.active { color: var(--accent); background: var(--accent-soft); }
  .flyout {
    position: fixed;
    z-index: 60;
    display: none;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-1);
    box-shadow: var(--shadow-2, 0 6px 24px rgba(0, 0, 0, 0.3));
  }
  .flyout.open { display: flex; }
</style>
