<script>
  /**
   * What can be added to the page, in a panel opened from Add or the A key. Its
   * field finds an element by a word and Enter adds the first one found; the arrows
   * walk the tiles. A tool placed by pressing the map stays lit while it is armed,
   * and a second press on it puts it down. A template plays nothing and keeps no
   * case's work, so it offers no step, no video, and nothing from the case.
   *
   * **Recent**, first, offers back the tiles picked lately, the newest first
   * (`recentAdds.svelte.js`); it waits while a word is searched, and holds only what
   * the plate offers.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import { ADDS, findAdds } from '../../lib/plate/adds.js';
  import { keepRecentAdd, recentAdds } from '../../lib/plate/recentAdds.svelte.js';

  let { anchor, placing = null, template = false, onadd, onclose } = $props();

  /** The tiles the pictured guide frames on their own (lib/guide.js). */
  const ADD_GUIDES = { label: 'plate.add-label', number: 'plate.add-number', arrow: 'plate.add-arrow' };

  let query = $state('');
  let field = $state(null);
  let grid = $state(null);
  /** A template keeps no case's work and plays nothing. */
  const offered = (group) => !template || (!group.plays && !group.cased);
  const groups = $derived(findAdds(query).filter(offered));
  const first = $derived(groups[0]?.items[0]?.[0] ?? null);
  /** The tiles picked lately this plate offers, each `{ group, item }`; none while a word is searched. */
  const recent = $derived(query.trim() ? [] : recentAdds.list.flatMap((kind) => {
    const group = ADDS.filter(offered).find((entry) => entry.items.some(([id]) => id === kind));
    return group ? [{ group, item: group.items.find(([id]) => id === kind) }] : [];
  }));

  $effect(() => { field?.focus(); });

  function pick(kind) {
    keepRecentAdd(kind);
    onclose?.();
    onadd?.(kind);
  }

  function fieldKey(event) {
    if (event.key === 'Enter' && first) { event.preventDefault(); pick(first); }
    if (event.key === 'ArrowDown') { event.preventDefault(); grid?.querySelector('.tile')?.focus(); }
  }

  /** The tile beside, or the nearest one above or below, as the panel shows them. */
  function tileKey(event) {
    const tiles = [...(grid?.querySelectorAll('.tile') ?? [])];
    const index = tiles.indexOf(event.currentTarget);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      tiles[index + (event.key === 'ArrowRight' ? 1 : -1)]?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const down = event.key === 'ArrowDown';
    const from = event.currentTarget.getBoundingClientRect();
    const middle = (rect) => rect.left + rect.width / 2;
    let best = null;
    let score = Infinity;
    for (const tile of tiles) {
      const rect = tile.getBoundingClientRect();
      const gap = down ? rect.top - from.bottom : from.top - rect.bottom;
      if (gap < -2) continue;
      const value = gap * 4 + Math.abs(middle(rect) - middle(from));
      if (value < score) { score = value; best = tile; }
    }
    if (best) best.focus();
    else if (!down) field?.focus();
  }
</script>

<FloatingMenu {anchor} width={540} label="Add to the page" role="dialog" {onclose}>
  <div class="find">
    <Icon name="search" size={14} />
    <input bind:this={field} bind:value={query} placeholder="Find an element" aria-label="Find an element" onkeydown={fieldKey} />
  </div>
  <div class="groups" class:found={!!query.trim()} bind:this={grid} data-guide="plate.add-groups">
    {#if recent.length}
      <section class="group recent" aria-label="Recent">
      <div class="group-head"><span>Recent</span></div>
      <div class="tiles">
        {#each recent as { group, item } (item[0])}{@render tile(group, item)}{/each}
      </div>
      </section>
    {/if}
    {#each groups as group (group.title)}
      <section class="group">
      <div class="group-head"><span>{group.title}</span>{#if group.note}<span class="hint">{group.note}</span>{/if}</div>
      <div class="tiles">
        {#each group.items as item (item[0])}{@render tile(group, item)}{/each}
      </div>
      </section>
    {:else}
      <p class="none">Nothing by that name.</p>
    {/each}
  </div>
</FloatingMenu>

{#snippet tile(group, [kind, label, icon])}
  <button type="button" class="tile" class:on={placing?.kind === kind || placing?.preset === kind} class:first={!!query && kind === first}
    title={group.note ? `${label}: ${group.note.toLowerCase()}` : `Add ${label.toLowerCase()}`} data-guide={ADD_GUIDES[kind]}
    onclick={() => pick(kind)} onkeydown={tileKey}>
    <Icon name={icon} size={17} /><span>{label}</span></button>
{/snippet}

<style>
  /* the field stays at the top when a short window makes the panel scroll */
  .find { position: sticky; top: -5px; z-index: 1; display: flex; align-items: center; gap: 7px; margin: 2px 2px 4px; padding: 0 9px;
    border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); color: var(--text-3); box-shadow: 0 -6px 0 var(--bg-1); }
  .find:focus-within { border-color: var(--accent); }
  .find input { flex: 1; min-width: 0; height: 32px; padding: 0; border: 0; outline: none; background: none; color: var(--text-1); font-size: var(--fs-sm); }
  .groups { padding: 0 2px 2px; columns: 2; column-gap: 14px; }
  .group { padding-top: 1px; break-inside: avoid; }
  /* the tiles picked lately run across both columns, in one row */
  .recent { column-span: all; }
  .recent .tiles { grid-template-columns: repeat(6, 1fr); }
  .group-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 8px 2px 5px; color: var(--text-3);
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .hint { font-weight: 500; letter-spacing: normal; text-transform: none; font-size: 10.5px; }
  /* what a word found reads as one list, its groups one under the other */
  .groups.found { columns: 1; }
  .found .tiles { grid-template-columns: repeat(6, 1fr); }
  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
  .tile { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; min-height: 54px; padding: 6px 3px;
    border: 1px solid transparent; border-radius: var(--r-sm); background: var(--bg-2); color: var(--text-2); font-size: 10.5px; line-height: 1.2;
    text-align: center; cursor: pointer; transition: background .12s, border-color .12s, color .12s; }
  .tile:hover, .tile:focus-visible { border-color: var(--accent); background: var(--accent-soft); color: var(--text-1); outline: none; }
  .tile.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text-1); }
  .tile.first { border-color: var(--accent); }
  .none { margin: 14px 4px; color: var(--text-3); font-size: var(--fs-xs); text-align: center; }
</style>
