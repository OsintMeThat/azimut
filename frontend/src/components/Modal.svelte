<script module>
  /**
   * The modals that are open, oldest first.
   *
   * Escape is heard on the window, so without this every open modal answers one press: a
   * dialog opened from inside another — dating a sync point without losing the declaration
   * that sent you there — would close both and take the work with it. Only the last one
   * opened acts, which is what Escape means to whoever pressed it.
   *
   * A plain array and not `$state`: it is read when a key is pressed, never while
   * rendering, and a reactive array that an effect both pushes to and depends on is an
   * effect that re-runs itself for good.
   */
  const stack = [];
</script>

<script>
  import Icon from './Icon.svelte';
  import { portal } from '../lib/fullscreen.js';

  let { title, onclose, width = '440px', children } = $props();

  const self = {};
  $effect(() => {
    stack.push(self);
    return () => {
      const at = stack.indexOf(self);
      if (at !== -1) stack.splice(at, 1);
    };
  });

  function onkeydown(e) {
    if (e.key === 'Escape' && stack.at(-1) === self) onclose?.();
  }
</script>

<svelte:window {onkeydown} />

<div
  class="overlay"
  use:portal
  onclick={(e) => e.target === e.currentTarget && onclose?.()}
  role="presentation"
>
  <div class="modal" style:width role="dialog" aria-label={title}>
    <header>
      <h3>{title}</h3>
      <button class="btn btn-ghost btn-sm" onclick={onclose} aria-label="Close">
        <Icon name="x" size={15} />
      </button>
    </header>
    <div class="content">
      {@render children?.()}
    </div>
  </div>
</div>

<style>
  /* One z-index for every modal: the second one opened is later in the portal, so it
     paints over the first without a ladder of numbers nobody can keep straight. */
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(4, 7, 12, 0.72);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 900;
  }
  .modal {
    background: var(--bg-1);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-2);
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 80px);
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px 10px;
  }
  h3 {
    font-size: var(--fs-lg);
    font-weight: 700;
  }
  .content {
    padding: 4px 18px 18px;
    overflow: auto;
  }
</style>
