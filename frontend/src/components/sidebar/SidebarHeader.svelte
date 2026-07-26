<script>
  // Zone 1: identity, search, type chips. Fixed — it never scrolls away.
  import Icon from '../Icon.svelte';
  import SearchInput from '../SearchInput.svelte';

  let {
    caseName,
    caseId,
    query = $bindable(''),
    type = null,
    chips = [],
    total = 0,
    resultCount = null,
    onnotes = () => {},
    onselecttype = () => {},
  } = $props();

  // A case with a dozen entity types would push its rarest chips off a single
  // line, so the row wraps and only the busiest few show until "+N" is pressed.
  // The active chip is always in view, even when it sits past the cut.
  const VISIBLE_CHIPS = 5;
  let chipsOpen = $state(false);
  const shownChips = $derived.by(() => {
    if (chipsOpen) return chips;
    const head = chips.slice(0, VISIBLE_CHIPS);
    const active = chips.find((c) => c.type === type);
    return active && !head.includes(active) ? [...head, active] : head;
  });
  const hiddenChips = $derived(chips.length - shownChips.length);
</script>

<div class="head">
  <div class="identity">
    <h3 title={caseId}>{caseName}</h3>
    <button class="btn btn-ghost btn-sm" title="Open case notes" onclick={onnotes}>
      <Icon name="note" size={13} />
      <span>Notes</span>
    </button>
  </div>

  <SearchInput
    bind:value={query}
    placeholder="Search this case…"
    width="100%"
    count={resultCount == null ? null : `${resultCount}`}
  />

  {#if chips.length > 1}
    <div class="chips">
      <button class="chip" class:active={type === null} onclick={() => onselecttype(null)}>
        All <span class="n">{total}</span>
      </button>
      {#each shownChips as chip (chip.type)}
        <button
          class="chip"
          class:active={type === chip.type}
          onclick={() => onselecttype(type === chip.type ? null : chip.type)}
        >
          {chip.type} <span class="n">{chip.count}</span>
        </button>
      {/each}
      {#if hiddenChips > 0}
        <button class="chip more" onclick={() => (chipsOpen = true)}>+{hiddenChips}</button>
      {:else if chipsOpen}
        <button class="chip more" onclick={() => (chipsOpen = false)}>Less</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .head {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 10px 10px;
    border-bottom: 1px solid var(--border);
  }
  .identity {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .identity h3 {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-md);
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .identity .btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .identity .btn:hover { color: var(--text-1); }
  /* wraps instead of scrolling: a chip that runs off the edge is a chip nobody
     finds, and at 240px that is most of them */
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-3);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .chip:hover { color: var(--text-1); border-color: var(--border-strong); }
  .chip.active {
    color: var(--text-1);
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .n { font-weight: 600; }
</style>
