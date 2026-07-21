<script>
  import { uiState } from '../lib/state.svelte.js';
  import Icon from './Icon.svelte';
  import { portal } from '../lib/fullscreen.js';

  const icons = { info: 'compass', ok: 'check', danger: 'alert', warn: 'alert' };

  function activate(t) {
    try {
      t.action?.onClick?.();
    } finally {
      const index = uiState.toasts.findIndex((item) => item.id === t.id);
      if (index !== -1) uiState.toasts.splice(index, 1);
    }
  }
</script>

<div class="toasts" use:portal>
  {#each uiState.toasts as t (t.id)}
    <div class="toast {t.kind}">
      <Icon name={icons[t.kind] ?? 'compass'} size={15} />
      <span>{t.message}</span>
      {#if t.action}
        <button class="toast-action" type="button" onclick={() => activate(t)}>
          {t.action.label}
        </button>
      {/if}
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
