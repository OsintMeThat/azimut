<script>
  /**
   * The workspace's cases in a floating list, to pick one: the list the app's case
   * switcher reads (`refreshCaseList`), cases and scratch sessions only, the one
   * open marked. A field finds one once there are many. For the extension's panel,
   * which switches its note's case in place.
   */
  import { onMount } from 'svelte';
  import { caseState, refreshCaseList } from '../lib/state.svelte.js';
  import { foldTerms, foldText } from '../lib/textFold.js';
  import FloatingMenu from './FloatingMenu.svelte';
  import Icon from './Icon.svelte';

  let { anchor, current = '', onpick, onclose } = $props();

  /** Past this many cases, a field finds one. */
  const FIND_FROM = 6;

  let query = $state('');
  let failed = $state(false);

  onMount(() => {
    refreshCaseList().catch(() => { failed = true; });
  });

  const matches = (item) => foldTerms(query).every((term) => foldText(item.name ?? item.id ?? '').includes(term));
  const named = $derived(caseState.list.filter((item) => !item.scratch));
  const scratches = $derived(caseState.list.filter((item) => item.scratch));
  const shown = $derived([...named, ...scratches].filter(matches));
</script>

<FloatingMenu {anchor} width={260} label="Cases" {onclose}>
  {#if caseState.list.length > FIND_FROM || query}
    <!-- svelte-ignore a11y_autofocus -->
    <div class="find"><input class="input" bind:value={query} placeholder="Find a case…" aria-label="Find a case" autofocus /></div>
  {/if}
  {#each shown as item (item.id)}
    {@const on = item.id === current}
    <button type="button" class="fm-item" class:on role="menuitem" aria-current={on ? 'true' : undefined} onclick={() => onpick(item.id)}>
      <Icon name={item.scratch ? 'clock' : 'folder'} size={14} /><span class="fm-grow">{item.name ?? item.id}</span>
      {#if item.scratch}<small>scratch</small>{/if}
    </button>
  {/each}
  {#if failed && !caseState.list.length}
    <p class="fm-note">The cases could not be listed.</p>
  {:else if !shown.length}
    <p class="fm-note">{query ? 'No case by that name.' : 'No cases yet.'}</p>
  {/if}
</FloatingMenu>

<style>
  .find { padding: 4px 6px 6px; }
  .fm-item.on { color: var(--accent); }
  small { flex: none; color: var(--text-3); font-size: var(--fs-xs); }
</style>
