<script>
  /**
   * One panel of Settings › Website: its heading, the line under it and what it holds. Every panel
   * stays mounted and the others are hidden, so what was typed or opened is still there when the
   * analyst comes back to it.
   */
  let { id, active = false, title, sub = '', children } = $props();
</script>

<div class="panel" id="hub-panel-{id}" role="tabpanel" aria-labelledby="hub-tab-{id}" hidden={!active}>
  <h2>{title}</h2>
  {#if sub}<p class="lede">{sub}</p>{:else}<div class="gap"></div>{/if}
  {@render children?.()}
</div>

<style>
  .panel { padding-top: 22px; }
  .panel[hidden] { display: none; }
  h2 { margin: 0 0 4px; font-size: var(--fs-xl); font-weight: 600; color: var(--text-1); }
  .lede { margin: 0 0 18px; max-width: 72ch; color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; }
  .gap { height: 14px; }
</style>
