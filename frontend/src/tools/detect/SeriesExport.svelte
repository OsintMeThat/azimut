<script>
  /**
   * Where a routine's dashboard goes out: into the note pinned to the side as
   * blocks the Notebook keeps editable, down as CSV, or into a SAT layer. One
   * menu, opened from the routine's page and from its dashboard window alike.
   */
  import { pinned } from '../../lib/notes/putInNote.svelte.js';
  import { setDockOpen } from '../../lib/notes/noteDock.svelte.js';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import Icon from '../../components/Icon.svelte';
  import PutInNote from '../../components/PutInNote.svelte';
  import { candidatesCsv, downloadCsv, fileName, spotsCsv } from './seriesNote.js';

  let {
    series = null,
    title = '',
    /** The routine's areas, named and coloured, for the files and the note. */
    areas = [],
    /** What the note offers (`seriesOffers`). */
    offers = [],
    busy = false,
    /** `label` draws a button with words; without it, an icon. */
    label = '',
    onlayer = () => {},
  } = $props();

  let anchor = $state(null);
  let open = $state(false);

  function download(kind) {
    open = false;
    const options = { areas };
    downloadCsv(kind === 'spots' ? spotsCsv(series, options) : candidatesCsv(series, options), fileName(title, kind));
  }
</script>

<button class={label ? 'btn btn-sm export-words' : 'cmp-icon'} class:on={open} bind:this={anchor} aria-haspopup="menu"
  aria-expanded={open} title="Put it in a note or download it" aria-label="Export" disabled={busy}
  onclick={() => (open = !open)}><Icon name="upload" size={label ? 13 : 14} />{#if label}<span>{label}</span>{/if}</button>

{#if open}
  <FloatingMenu {anchor} width={264} align="end" label="Export" onclose={() => (open = false)}>
    <div class="fm-head">Into a note</div>
    {#if !series?.passes.length}
      <p class="fm-note">Nothing to put in a note before a finished pass.</p>
    {:else if pinned.current}
      {#each offers as offer (offer.id)}
        <PutInNote {offer} named onput={() => (open = false)} />
      {/each}
    {:else}
      <button class="fm-item" role="menuitem" onclick={() => { open = false; setDockOpen(true); }}>
        <Icon name="note" size={13} /><span class="fm-grow">Open the note panel</span>
      </button>
      <p class="fm-note">Then each part of this dashboard goes in it as a chart or a table you can edit.</p>
    {/if}
    <div class="fm-sep"></div>
    <div class="fm-head">Download</div>
    <button class="fm-item" role="menuitem" disabled={!series?.passes.length} onclick={() => download('candidates')}>
      <Icon name="download" size={13} /><span class="fm-grow">Every candidate (CSV)</span>
    </button>
    <button class="fm-item" role="menuitem" disabled={!series?.spots.length} onclick={() => download('spots')}>
      <Icon name="download" size={13} /><span class="fm-grow">The spots (CSV)</span>
    </button>
    <div class="fm-sep"></div>
    <button class="fm-item" role="menuitem" onclick={() => { open = false; onlayer(); }}>
      <Icon name="layers" size={13} /><span class="fm-grow">Snapshot as a SAT layer</span>
    </button>
  </FloatingMenu>
{/if}

<style>
  .export-words { display: inline-flex; align-items: center; gap: 6px; }
</style>
