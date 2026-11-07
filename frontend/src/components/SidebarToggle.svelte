<script>
  /**
   * The top bar's switch for the case sidebar. While the sidebar is closed it wears the
   * accent's dot when the open case has scenes waiting to be geolocated, the abandoned
   * left out; once open, its To-do tab counts them. The number is kept the way the
   * sidebar keeps it (`holdSceneCount`): read once for the case, and again only when it
   * may have moved, so a closed sidebar costs what an open one does.
   */
  import { onDestroy, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { caseState, uiState } from '../lib/state.svelte.js';
  import { ensureSceneQueue, holdSceneCount, scenesWaiting } from '../lib/geolocating.svelte.js';

  let { button = $bindable(null), onclick } = $props();

  onDestroy(holdSceneCount());
  $effect(() => {
    const id = caseState.current?.id;
    if (id) untrack(() => ensureSceneQueue(id));
  });
  const waiting = $derived(uiState.sidebarOpen ? 0 : (scenesWaiting(caseState.current?.id) ?? 0));
  const words = $derived(waiting === 1 ? 'a scene to geolocate in the To-do' : 'scenes to geolocate in the To-do');
</script>

<button
  class="btn btn-ghost btn-sm dotted"
  title={waiting ? `Toggle case sidebar · ${words}` : 'Toggle case sidebar'}
  bind:this={button}
  {onclick}
>
  <Icon name="panelRight" size={16} />
  {#if waiting}
    <span class="waiting-dot" aria-label={words}></span>
  {/if}
</button>
