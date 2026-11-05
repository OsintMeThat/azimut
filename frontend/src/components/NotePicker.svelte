<script>
  /**
   * The case's notes in a floating list, to pick one.
   *
   * The note on the side picks what it shows from here, and Notes in the sidebar
   * pins a note there through it. One list for both: Case notes first, then the
   * notes last written, a field to find one once there are many. `current` marks
   * the note already showing (null for Case notes, undefined for none);
   * `onnotebook` adds a button on each row that opens it in the Notebook, and
   * `onhome` a last row to the Notebook's home. `onpick` hears the id, then the
   * row's title and folder.
   */
  import { api } from '../lib/api.js';
  import { foldText } from '../lib/textFold.js';
  import { isReport } from '../lib/notes/look.js';
  import FloatingMenu from './FloatingMenu.svelte';
  import Icon from './Icon.svelte';

  let { caseId, anchor, current = undefined, intro = '', onpick, onnotebook = null, onhome = null, onclose } = $props();

  /** Past this many notes, a field finds one. */
  const FIND_FROM = 6;

  let rows = $state(null);
  let failed = $state(false);
  let query = $state('');

  $effect(() => {
    const id = caseId;
    if (!id) return;
    let live = true;
    rows = null;
    failed = false;
    api.get(`/api/cases/${id}/notes/index`)
      .then((result) => { if (live) rows = result?.items ?? []; })
      .catch(() => { if (live) { rows = []; failed = true; } });
    return () => { live = false; };
  });

  const filed = $derived((rows ?? []).filter((row) => row.id !== 'case')
    .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''))));
  const matches = (words) => foldText(words).includes(foldText(query.trim()));
  const shown = $derived(filed.filter((row) => matches(`${row.title} ${row.folder ?? ''}`)));
  const caseShown = $derived(matches('Case notes'));
  const isOn = (id) => current !== undefined && (id ?? null) === (current ?? null);
</script>

<FloatingMenu {anchor} width={280} label="Notes" {onclose}>
  {#if intro}<p class="fm-note">{intro}</p>{/if}
  {#if filed.length > FIND_FROM || query}
    <!-- svelte-ignore a11y_autofocus -->
    <div class="find"><input class="input" bind:value={query} placeholder="Find a note…" aria-label="Find a note" autofocus /></div>
  {/if}
  {#if caseShown}{@render row(null, 'Case notes', '', 'note')}{/if}
  {#each shown as note (note.id)}{@render row(note.id, note.title, note.folder, isReport(note) ? 'layers' : 'note')}{/each}
  {#if rows === null}
    <p class="fm-note">Loading the notes…</p>
  {:else if failed}
    <p class="fm-note">The notes could not be listed. Case notes is still here.</p>
  {:else if !caseShown && !shown.length}
    <p class="fm-note">No note by that name.</p>
  {/if}
  {#if onhome}
    <div class="fm-sep"></div>
    <button type="button" class="fm-item" onclick={onhome}><Icon name="panelRight" size={14} /><span class="fm-grow">All notes in the Notebook</span></button>
  {/if}
</FloatingMenu>

{#snippet row(id, title, folder, icon)}
  <div class="pick-row">
    <button type="button" class="fm-item" class:on={isOn(id)} aria-current={isOn(id) ? 'true' : undefined} onclick={() => onpick(id, { title, folder })}>
      <Icon name={icon} size={14} /><span class="fm-grow">{title}</span>
      {#if folder}<small>{folder}</small>{/if}
    </button>
    {#if onnotebook}
      <button type="button" class="open" title="Open in the Notebook" aria-label={`Open ${title} in the Notebook`} onclick={() => onnotebook(id)}>
        <Icon name="maximize" size={13} /></button>
    {/if}
  </div>
{/snippet}

<style>
  .find { padding: 4px 6px 6px; }
  .pick-row { display: flex; align-items: center; gap: 2px; }
  .pick-row .fm-item { flex: 1; min-width: 0; }
  .fm-item.on { color: var(--accent); }
  small { flex: none; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-3); font-size: var(--fs-xs); }
  .open {
    flex: none; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px;
    border-radius: var(--r-sm); color: var(--text-3); cursor: pointer;
  }
  .open:hover, .open:focus-visible { background: var(--bg-3); color: var(--text-1); }
</style>
