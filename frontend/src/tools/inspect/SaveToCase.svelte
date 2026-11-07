<script>
  import { untrack } from 'svelte';
  import { caseState, uiState } from '../../lib/state.svelte.js';
  import { saveNameOf } from '../../lib/inspect.js';
  import Icon from '../../components/Icon.svelte';
  import FolderSelect from '../../components/FolderSelect.svelte';
  import { workFolder } from '../../lib/folders.js';

  // Files one output as case media: a frame, the adjusted video, an exported
  // collage. Everything else in Examine is kept with the work as it is made; this
  // is the one step that puts a file in the Media Library.
  //
  // `filedPath` is the media the last save produced, while the output still reads
  // as it did then. An edit since clears it, and the button offers the save again.
  // `children` sits under the button: the row that puts the output in a pinned note.
  // `fold` is the one-press form (the Collage tool's): the press files under the name
  // and the last folder, and its arrow unfolds the name, folder and note beneath it.
  let {
    defaultName,
    filedPath = null,
    busy = false,
    blocked = '',
    hint = '',
    folder = $bindable(''),
    onsave,
    children = null,
    fold = false,
  } = $props();

  // The field holds real text from the start. It follows the default until the
  // analyst types in it, and is theirs from then on.
  let typed = $state(null);
  let note = $state('');
  let noting = $state(false);
  const name = $derived(typed ?? defaultName);
  const folders = $derived(caseState.current?.folders ?? []);
  let unfolded = $state(false);

  // Folded, the folder picker is not there to start on the work folder, so the
  // press starts there itself, as the picker would have.
  untrack(() => {
    if (fold && !folder && workFolder()) folder = workFolder();
  });

  async function save() {
    // With a work folder, filing has already put the output there, so Unfiled
    // has to be sent to mean it; without one, empty leaves a re-save where it was.
    const chosen = folder || (workFolder() ? '' : null);
    await onsave({ name: saveNameOf({ defaultName }, name), folder: chosen, note: note.trim() || null });
    typed = null;
    note = '';
    noting = false;
    unfolded = false;
  }

  function showInLibrary() {
    uiState.focusMedia = filedPath;
    uiState.tool = 'media';
  }
</script>

{#snippet fields()}
  <input
    class="input"
    value={name}
    oninput={(e) => (typed = e.currentTarget.value)}
    aria-label="Name"
    maxlength="200"
  />
  <FolderSelect bind:value={folder} {folders} emptyLabel="Unfiled" fresh />
{/snippet}

{#if fold}
  <div class="save folded">
    <div class="split" role="group" aria-label="Save to case">
      <button
        class="btn btn-primary btn-sm press"
        disabled={busy || !!blocked || !!filedPath}
        onclick={save}
        title={filedPath ? 'Its picture is in the case as it stands' : `Save as “${name}”${folder ? ` in ${folder}` : ''}`}
      >
        <Icon name={filedPath && !busy ? 'check' : 'save'} size={14} />
        {busy ? 'Saving…' : filedPath ? 'Saved' : 'Save to case'}
      </button>
      <button
        class="btn btn-primary btn-sm more"
        disabled={busy || !!blocked || !!filedPath}
        onclick={() => (unfolded = !unfolded)}
        aria-expanded={unfolded && !filedPath && !blocked}
        aria-label="Name, folder and note"
        title="Name, folder and note"
      >
        <Icon name={unfolded && !filedPath && !blocked ? 'chevronUp' : 'chevronDown'} size={13} />
      </button>
    </div>
    {#if unfolded && !filedPath && !blocked}
      <div class="fields">
        {@render fields()}
        <textarea class="input note" bind:value={note} rows="2" placeholder="Why it matters" maxlength="2000" aria-label="Note"></textarea>
      </div>
    {/if}
    <div class="foot">
      {#if blocked}
        <p class="hint warn">{blocked}</p>
      {:else if hint}
        <p class="hint">{hint}</p>
      {/if}
      {#if filedPath}
        <button class="btn btn-ghost btn-xs filed" onclick={showInLibrary} title="Show it in Media">
          <Icon name="check" size={12} /> In the case
        </button>
      {/if}
    </div>
    {#if !blocked}{@render children?.()}{/if}
  </div>
{:else}
<div class="save">
  <div class="head">
    <span><Icon name="save" size={14} /> Save to case</span>
    {#if filedPath}
      <button class="btn btn-ghost btn-xs filed" onclick={showInLibrary} title="Show it in Media">
        <Icon name="check" size={12} /> In the case
      </button>
    {/if}
  </div>
  {@render fields()}
  {#if noting}
    <textarea class="input note" bind:value={note} rows="2" placeholder="Why it matters" maxlength="2000" aria-label="Note"></textarea>
  {:else}
    <button class="btn btn-ghost btn-xs add-note" onclick={() => (noting = true)}>
      <Icon name="note" size={12} /> Add a note
    </button>
  {/if}
  <button class="btn btn-primary btn-sm w-full" disabled={busy || !!blocked || !!filedPath} onclick={save}>
    <Icon name="save" size={14} />
    {busy ? 'Saving…' : filedPath ? 'Saved' : 'Save to case'}
  </button>
  {#if !blocked}{@render children?.()}{/if}
  {#if blocked}
    <p class="hint warn">{blocked}</p>
  {:else if hint}
    <p class="hint">{hint}</p>
  {/if}
</div>
{/if}

<style>
  .save {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  .head span {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .filed {
    color: var(--ok);
  }
  .add-note {
    align-self: flex-start;
  }
  .note {
    resize: vertical;
  }
  .w-full {
    width: 100%;
    justify-content: center;
  }
  .hint {
    color: var(--text-3);
    font-size: var(--fs-xs);
    margin: 0;
  }
  .warn {
    color: var(--warn);
  }
  /* The note's row, drawn by PutInNote outside this component's scope, lines up
     with the save above it. */
  .save :global([data-put]) {
    width: 100%;
    justify-content: center;
  }
  /* The one-press form: the press and its arrow as one button. */
  .split {
    display: flex;
  }
  .press {
    flex: 1;
    min-width: 0;
    justify-content: center;
    gap: 6px;
    padding-top: 6px;
    padding-bottom: 6px;
    font-size: var(--fs-sm);
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .more {
    flex: 0 0 32px;
    justify-content: center;
    padding-left: 0;
    padding-right: 0;
    border-left: 1px solid color-mix(in srgb, var(--accent-text) 22%, transparent);
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 18px;
  }
  .foot .filed {
    flex-shrink: 0;
    margin-right: -7px;
  }
</style>
