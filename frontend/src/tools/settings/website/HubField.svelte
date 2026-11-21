<script>
  /**
   * A field of a hub card: its name, its control and a line saying what it takes. Side by side in a
   * card wide enough, the name over the control in a narrow one.
   */
  let { label, hint = '', id = undefined, problem = '', children } = $props();
</script>

<div class="hub-field">
  {#if id}<label class="name" for={id}>{label}</label>{:else}<span class="name">{label}</span>{/if}
  <div class="control">{@render children?.()}</div>
  {#if problem}
    <span class="hint bad" role="alert">{problem}</span>
  {:else if hint}
    <span class="hint">{hint}</span>
  {/if}
</div>

<style>
  .hub-field { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; padding: 11px 0; border-top: 1px solid var(--border); }
  .hub-field:first-child { border-top: 0; padding-top: 4px; }
  .hub-field:last-child { padding-bottom: 2px; }
  .name { color: var(--text-1); font-size: var(--fs-sm); line-height: 1.35; }
  .control { min-width: 0; display: flex; flex-direction: column; align-items: stretch; gap: 6px; }
  .hint { margin-top: -1px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; overflow-wrap: anywhere; }
  .hint.bad { color: var(--danger); }
  @container card (min-width: 420px) {
    .hub-field { grid-template-columns: 128px minmax(0, 1fr); column-gap: 14px; align-items: start; }
    .name { padding-top: 6px; }
    .hint { grid-column: 2; }
  }
</style>
