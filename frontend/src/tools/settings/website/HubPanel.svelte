<script>
  /**
   * One panel of Settings › Website: its heading, the line under it and what it holds. Every panel
   * stays mounted and the others are hidden, so what was typed or opened is still there when the
   * analyst comes back to it.
   */
  let { id, active = false, title, sub = '', children } = $props();
</script>

<div class="panel" id="hub-panel-{id}" role="tabpanel" aria-labelledby="hub-tab-{id}" tabindex="0" hidden={!active}>
  <header class="lead">
    <h2>{title}</h2>
    {#if sub}<p>{sub}</p>{/if}
  </header>
  {@render children?.()}
</div>

<style>
  .panel { padding-top: 22px; outline: none; }
  .panel[hidden] { display: none; }
  .panel:focus-visible { box-shadow: 0 -2px 0 var(--accent-soft); }
  .lead { margin-bottom: 18px; }
  h2 { margin: 0 0 4px; color: var(--text-1); font-size: var(--fs-xl); font-weight: 600; line-height: 1.25; }
  .lead p { margin: 0; max-width: 72ch; color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; }
</style>
