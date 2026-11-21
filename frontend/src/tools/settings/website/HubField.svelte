<script>
  /** A label, its control and a line saying what it takes, in the hub's two columns. */
  let { label, hint = '', id = undefined, children } = $props();
</script>

<div class="hub-field">
  {#if id}<label for={id}>{label}</label>{:else}<span class="name">{label}</span>{/if}
  <div class="control">{@render children?.()}</div>
  {#if hint}<span class="hint">{hint}</span>{/if}
</div>

<style>
  .hub-field { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 6px 14px; padding: 11px 0; border-top: 1px solid var(--border); align-items: start; }
  .hub-field:first-child { border-top: 0; padding-top: 2px; }
  label, .name { font-size: var(--fs-sm); color: var(--text-1); padding-top: 5px; }
  .control { min-width: 0; display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
  .hint { grid-column: 2; margin-top: -2px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.45; overflow-wrap: anywhere; }
  @media (max-width: 720px) {
    .hub-field { grid-template-columns: 1fr; }
    .hint { grid-column: 1; }
  }
</style>
