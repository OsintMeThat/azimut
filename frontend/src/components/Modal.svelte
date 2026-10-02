<script>
  import Icon from './Icon.svelte';
  import { portal } from '../lib/fullscreen.js';
  import { isTopOverlay, joinOverlays } from '../lib/overlayStack.js';

  let { title, onclose, width = '440px', children } = $props();

  const self = {};
  $effect(() => joinOverlays(self));

  let dialogEl = $state(null);

  // Keyboard focus moves in when the dialog opens and goes back where it was when it
  // closes; left behind the veil, Tab would walk a page nobody can see. A field the
  // dialog autofocuses keeps the focus: that runs first, in the same microtask queue.
  $effect(() => {
    const returnTo = document.activeElement;
    queueMicrotask(() => {
      if (dialogEl && !dialogEl.contains(document.activeElement)) dialogEl.focus();
    });
    return () => {
      if (returnTo?.isConnected) returnTo.focus?.();
    };
  });

  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /** Tab wraps inside the dialog rather than leaving it for the page behind. */
  function trap(e) {
    if (e.key !== 'Tab' || !dialogEl) return;
    const items = [...dialogEl.querySelectorAll(FOCUSABLE)];
    if (!items.length) return;
    const [first, last] = [items[0], items[items.length - 1]];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogEl)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onkeydown(e) {
    if (e.key === 'Escape' && isTopOverlay(self)) onclose?.();
  }
</script>

<svelte:window {onkeydown} />

<div
  class="overlay"
  use:portal
  onclick={(e) => e.target === e.currentTarget && onclose?.()}
  role="presentation"
>
  <div class="modal" style:width role="dialog" aria-modal="true" aria-label={title} tabindex="-1"
       bind:this={dialogEl} onkeydown={trap}>
    <header>
      <h3>{title}</h3>
      <button class="btn btn-ghost btn-sm" onclick={onclose} aria-label="Close" title="Close">
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
