<script>
  /**
   * A titled part of the plate inspector, folded away by its title and kept folded
   * from one element to the next and between visits: folding Grid on one map
   * folds it on every map. The sections few plates need start folded
   * (`layout.svelte.js`). Folded, it says what it holds in a word, when it can.
   */
  import Icon from '../../components/Icon.svelte';
  import { isOpen, toggleFold } from '../../lib/plate/layout.svelte.js';

  /** `help`: what the section is for, on its ⓘ rather than in a line under it. */
  let { title, summary = '', help = '', children } = $props();
  const open = $derived(isOpen(title));
</script>

<section class="part" class:open>
  <h4><button type="button" aria-expanded={open} onclick={() => toggleFold(title)}>
    <span class="title">{title}</span>
    {#if help}<span class="about" role="img" aria-label={`About ${title}`} title={help}><Icon name="info" size={11} /></span>{/if}
    <span class="grow"></span>
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
  .title { min-width: 0; }
  .about { display: grid; flex: none; place-items: center; color: var(--text-3); cursor: help; }
  .about:hover { color: var(--text-1); }
  .title + .about { margin-left: -3px; }
  .grow { flex: 1; }
  .summary { max-width: 60%; overflow: hidden; color: var(--text-3); font-size: 10.5px; font-weight: 500; letter-spacing: normal;
    text-overflow: ellipsis; text-transform: none; white-space: nowrap; }
  .turn { display: grid; place-items: center; transition: transform .15s; transform: rotate(-90deg); }
  .open .turn { transform: none; }
  .body { padding-bottom: 2px; }
</style>
