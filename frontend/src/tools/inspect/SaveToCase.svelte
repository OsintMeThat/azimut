<script>
  import { caseState, uiState } from '../../lib/state.svelte.js';
  import { saveNameOf } from '../../lib/inspect.js';
  import Icon from '../../components/Icon.svelte';
  import FolderSelect from '../../components/FolderSelect.svelte';

  // Files one output as case media: a frame, the adjusted video, an exported
  // collage. Everything else in Examine is kept with the work as it is made; this
  // is the one step that puts a file in the Media Library.
  //
  // `filedPath` is the media the last save produced, while the output still reads
  // as it did then. An edit since clears it, and the button offers the save again.
  let {
    defaultName,
    filedPath = null,
    busy = false,
    blocked = '',
    hint = '',
    folder = $bindable(''),
    onsave,
  } = $props();

  // The field holds real text from the start. It follows the default until the
  // analyst types in it, and is theirs from then on.
  let typed = $state(null);
  let note = $state('');
  let noting = $state(false);
  const name = $derived(typed ?? defaultName);
  const folders = $derived(caseState.current?.folders ?? []);

  async function save() {
    await onsave({ name: saveNameOf({ defaultName }, name), folder: folder || null, note: note.trim() || null });
    typed = null;
    note = '';
    noting = false;
  }

  function showInLibrary() {
    uiState.focusMedia = filedPath;
    uiState.tool = 'media';
  }
</script>

<div class="save">
  <div class="head">
    <span><Icon name="save" size={14} /> Save to case</span>
    {#if filedPath}
      <button class="btn btn-ghost btn-xs filed" onclick={showInLibrary} title="Show it in the Media Library">
        <Icon name="check" size={12} /> In the case
      </button>
    {/if}
  </div>
  <input
    class="input"
    value={name}
    oninput={(e) => (typed = e.currentTarget.value)}
    aria-label="Name"
    maxlength="200"
  />
  <FolderSelect bind:value={folder} {folders} emptyLabel="Unfiled" />
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
  {#if blocked}
    <p class="hint warn">{blocked}</p>
  {:else if hint}
    <p class="hint">{hint}</p>
  {/if}
</div>

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
</style>
