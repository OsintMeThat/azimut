<script>
  import { uiState } from '../lib/state.svelte.js';
  import Icon from './Icon.svelte';
  import { portal } from '../lib/fullscreen.js';

  const icons = { info: 'compass', ok: 'check', danger: 'alert', warn: 'alert' };

  // A toast carries one action or a short list of them, each a button.
  const actionsOf = (t) => (Array.isArray(t.action) ? t.action : t.action ? [t.action] : []);

  function activate(t, action) {
    try {
      action?.onClick?.();
    } finally {
      const index = uiState.toasts.findIndex((item) => item.id === t.id);
      if (index !== -1) uiState.toasts.splice(index, 1);
    }
  }
</script>

<!-- Announced as they come: a failure interrupts a screen reader, anything else waits
     for it to finish. -->
<div class="toasts" use:portal role="status" aria-live="polite">
  {#each uiState.toasts as t (t.id)}
    <div class="toast {t.kind}" role={t.kind === 'danger' ? 'alert' : undefined}>
      <Icon name={icons[t.kind] ?? 'compass'} size={15} />
      <span>{t.message}</span>
      {#each actionsOf(t) as action, i (i)}
        <button class="toast-action" type="button" onclick={() => activate(t, action)}>
          {action.label}
        </button>
      {/each}
      <!-- how long it stays, as a thread running out -->
      {#if t.timeout > 0}<span class="toast-time" style:animation-duration={`${t.timeout}ms`}></span>{/if}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    z-index: 1000;
    pointer-events: none;
  }
  .toast {
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 9px 16px;
    border-radius: var(--r-md);
    background: var(--bg-2);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-2);
    font-size: var(--fs-sm);
    font-weight: 500;
    max-width: 480px;
    animation: motion-rise-in var(--motion-move) var(--ease-out) backwards;
  }
  .toast-time {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: currentColor;
    opacity: 0.4;
    transform-origin: left;
    animation: toast-time linear forwards;
  }
  @keyframes toast-time {
    to { transform: scaleX(0); }
  }
  .toast.ok {
    border-color: var(--ok);
    color: var(--ok);
  }
  .toast.danger {
    border-color: var(--danger);
    color: var(--danger);
  }
  .toast.warn {
    border-color: var(--warn);
    color: var(--warn);
  }
  .toast-action {
    /* a label on one line: the message wraps rather than the press */
    flex: none;
    white-space: nowrap;
    pointer-events: auto;
    margin-left: 4px;
    padding: 2px 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .toast-action:hover,
  .toast-action:focus-visible {
    color: var(--text);
  }
</style>
