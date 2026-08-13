<script>
  /**
   * What a Ctrl+V shows, on whichever surface caught it.
   *
   * One dialog for four tools, for the reason the entity dialog is one dialog: a
   * pasted screenshot is filed with the same words and the same field names in the
   * Media grid, the Files desktop, the drawing and the table. Four copies of this
   * form would be four vocabularies inside a week.
   *
   * It renders whatever `resolvePaste` decided (lib/clipboardPaste.js) — which
   * fields to ask for, or the sentence saying why this surface will not take what
   * was pasted. A refusal is a screen of its own rather than a toast, because it is
   * the answer to a deliberate act and it has something to teach: where the thing
   * does go.
   */
  import { pasteProblem } from '../lib/clipboardPaste.js';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import FolderSelect from './FolderSelect.svelte';

  let {
    /** What `resolvePaste` decided: which fields to ask for, or why not to. */
    resolved,
    folders = [],
    busy = false,
    onconfirm = () => {},
    onclose = () => {},
  } = $props();

  // The draft is the dialog's own, and handed back on confirm. Writing through to
  // the caller's object instead would make every surface responsible for wrapping
  // its resolution in state before the fields could be typed into at all.
  // svelte-ignore state_referenced_locally
  let values = $state({ ...resolved.values });

  const isImage = $derived(resolved.kind === 'image');
  const asks = (field) => (resolved.fields ?? []).includes(field);
  const problem = $derived(
    resolved.mode === 'form' ? pasteProblem({ kind: resolved.kind, values }) : ''
  );

  // A refusal is titled for what it is whatever was pasted: "Paste link" over a
  // sentence explaining that links do not go here reads as an invitation.
  const TITLES = { image: 'Paste image', url: 'Paste link' };
  const title = $derived(
    resolved.mode === 'refuse' ? 'Nothing to paste here' : (TITLES[resolved.kind] ?? 'Paste')
  );

  // Revoked when the dialog goes: an object URL held after that keeps the pasted
  // bytes alive for as long as the tab lives.
  let previewUrl = $state('');
  $effect(() => {
    if (resolved.mode !== 'form' || !isImage) return;
    const url = URL.createObjectURL(resolved.payload.file);
    previewUrl = url;
    return () => {
      URL.revokeObjectURL(url);
      previewUrl = '';
    };
  });

  const sizeLabel = $derived(
    isImage ? `${Math.max(1, Math.round(resolved.payload.file.size / 1024))} kB` : ''
  );
</script>

<Modal {title} {onclose} width="520px">
  {#if resolved.mode === 'refuse'}
    <p class="refusal">{resolved.reason}</p>
    <div class="modal-row">
      <div style="flex:1"></div>
      <button class="btn btn-primary" onclick={onclose}>Close</button>
    </div>
  {:else}
    {#if isImage}
      <figure class="preview">
        {#if previewUrl}
          <img src={previewUrl} alt="What the clipboard is holding" />
        {/if}
        <figcaption>{resolved.payload.file.type || 'image'} · {sizeLabel}</figcaption>
      </figure>
    {:else}
      <p class="target"><Icon name="link" size={14} /> <span>{resolved.payload.url}</span></p>
    {/if}

    {#if asks('title')}
      <label class="modal-label" for="paste-title">Title</label>
      <input
        id="paste-title"
        class="input"
        placeholder={isImage ? 'Name this image…' : 'Bookmark title…'}
        bind:value={values.title}
      />
      {#if isImage}
        <p class="field-help">Optional. Names the file in the case.</p>
      {/if}
    {/if}

    {#if asks('folder')}
      <span class="modal-label" style="margin-top:10px">Folder (in My work)</span>
      <FolderSelect bind:value={values.folder} {folders} emptyLabel="My work (root)" />
    {/if}

    {#if asks('source')}
      <label class="modal-label" for="paste-source" style="margin-top:10px">Source URL</label>
      <input
        id="paste-source"
        class="input"
        placeholder="https://…"
        bind:value={values.source}
      />
      <p class="field-help">A pasted image carries no origin of its own.</p>
    {/if}

    {#if asks('notes')}
      <label class="modal-label" for="paste-notes" style="margin-top:10px">Notes</label>
      <textarea
        id="paste-notes"
        class="textarea"
        rows="3"
        placeholder="Why this page matters…"
        bind:value={values.notes}
      ></textarea>
    {/if}

    <div class="modal-row">
      <div style="flex:1"></div>
      {#if problem}<span class="problem">{problem}</span>{/if}
      <button class="btn" onclick={onclose}>Cancel</button>
      <button
        class="btn btn-primary"
        onclick={() => onconfirm({ ...resolved, values })}
        disabled={busy || Boolean(problem)}
      >
        {busy ? 'Adding…' : 'Add to case'}
      </button>
    </div>
  {/if}
</Modal>

<style>
  .refusal {
    margin: 6px 0 0;
    color: var(--text-2);
    font-size: var(--fs-sm);
    line-height: 1.55;
  }
  .preview {
    margin: 6px 0 12px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--r);
    background: var(--bg-2);
    text-align: center;
  }
  .preview img {
    display: block;
    max-width: 100%;
    max-height: 240px;
    margin: 0 auto;
    border-radius: var(--r-sm);
    object-fit: contain;
  }
  .preview figcaption {
    margin-top: 7px;
    color: var(--text-3);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
  .target {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0 12px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .target span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .field-help {
    margin: 5px 0 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .problem {
    align-self: center;
    color: var(--warn);
    font-size: var(--fs-xs);
  }
  .textarea {
    width: 100%;
    resize: vertical;
  }
</style>
