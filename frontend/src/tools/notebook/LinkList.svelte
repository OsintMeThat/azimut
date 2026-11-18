<script>
  /**
   * The links behind one line of the check before export ("88 outside links have no
   * archived copy."), folded under it: the first few by their words, the rest counted,
   * and once opened each link with where it goes and Go to, which takes the note to it.
   */
  import Icon from '../../components/Icon.svelte';
  import { linkHost, linksSummary } from '../../lib/notes/warnings.js';

  /** @type {{ items: { text: string, url: string, line: number | null }[], label?: string, ongo?: (line: number) => void }} */
  let { items, label = 'Links', ongo } = $props();
</script>

<details class="links">
  <summary title="Show every link">
    <span class="said" dir="auto">{linksSummary(items)}</span>
    <Icon name="chevronDown" size={12} />
  </summary>
  <ul aria-label={label}>
    {#each items as item, index (index)}
      <li>
        <span class="words" dir="auto" title={item.url}>{item.text}</span>
        <span class="host">{linkHost(item.url)}</span>
        {#if Number.isInteger(item.line)}
          <button type="button" class="btn btn-ghost btn-xs" title="Open the note at this link" onclick={() => ongo?.(item.line)}>Go to</button>
        {/if}
      </li>
    {/each}
  </ul>
</details>

<style>
  /* under the line's words, past its dot */
  .links { flex: 1 0 100%; min-width: 0; margin: 0 0 3px; padding-left: 13px; }
  summary {
    display: flex; align-items: center; gap: 4px; width: fit-content; max-width: 100%;
    color: var(--text-3); font-size: var(--fs-xs); cursor: pointer; list-style: none;
  }
  summary::-webkit-details-marker { display: none; }
  summary:hover, summary:focus-visible { color: var(--text-1); }
  .said { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  summary :global(svg) { flex: none; transition: transform 0.12s ease; }
  .links[open] summary :global(svg) { transform: rotate(180deg); }
  ul {
    list-style: none; margin: 4px 0 0; padding: 2px 0; max-height: 168px; overflow: auto;
    border-left: 1px solid var(--border); font-size: var(--fs-xs);
  }
  li { display: flex; align-items: center; gap: 8px; min-height: 24px; padding: 0 0 0 8px; color: var(--text-1); }
  .words { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .host { flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-3); }
  li .btn { flex: none; }
</style>
