<script>
  /**
   * A titled part of the plate inspector, folded away by its title and kept folded
   * from one element to the next and between visits: folding Layers on one map
   * folds it on every map. Folded, it says what it holds in a word, when it can.
   */
  import Icon from '../../components/Icon.svelte';
  import { layout, toggleFold } from '../../lib/plate/layout.svelte.js';

  let { title, summary = '', children } = $props();
  const open = $derived(!layout.folded.includes(title));
</script>

<section class="part" class:open>
  <h4><button type="button" aria-expanded={open} onclick={() => toggleFold(title)}>
    <span class="title">{title}</span>
    {#if !open && summary}<span class="summary">{summary}</span>{/if}
    <span class="turn"><Icon name="chevronDown" size={12} /></span>
  </button></h4>
  {#if open}<div class="body">{@render children?.()}</div>{/if}
</section>

<style>
  .part { margin-top: 10px; border-top: 1px solid var(--border); break-inside: avoid; }
  h4 { margin: 0; }
  h4 button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 30px; padding: 7px 0 5px; color: var(--text-3);
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; text-align: left; cursor: pointer; }
  h4 button:hover { color: var(--text-1); }
  .title { flex: 1; min-width: 0; }
  .summary { max-width: 60%; overflow: hidden; color: var(--text-3); font-size: 10.5px; font-weight: 500; letter-spacing: normal;
    text-overflow: ellipsis; text-transform: none; white-space: nowrap; }
  .turn { display: grid; place-items: center; transition: transform .15s; transform: rotate(-90deg); }
  .open .turn { transform: none; }
  .body { padding-bottom: 2px; }
</style>
