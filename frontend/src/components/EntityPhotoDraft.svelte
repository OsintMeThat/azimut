<script>
  /** Photos staged before their entity exists. */
  import { onDestroy } from 'svelte';
  import { api } from '../lib/api.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { caseState, toast } from '../lib/state.svelte.js';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import SearchInput from './SearchInput.svelte';

  let {
    photos = $bindable([]),
    primaryId = $bindable(null),
    disabled = false,
  } = $props();

  let fileInput = $state();
  let pickerOpen = $state(false);
  let pickerLoading = $state(false);
  let media = $state([]);
  let picked = $state([]);
  let query = $state('');
  let sequence = 0;
  const localUrls = new Set();

  const attached = $derived(
    new Set(photos.filter((photo) => photo.source === 'media').map((photo) => photo.mediaId))
  );
  const available = $derived(
    media.filter((item) => item.kind === 'image' && item.entity_id && !attached.has(item.entity_id))
  );
  const matching = $derived.by(() => {
    const term = query.trim().toLowerCase();
    if (!term) return available;
    return available.filter((item) =>
      `${item.title ?? ''} ${item.filename ?? ''}`.toLowerCase().includes(term)
    );
  });

  function addFiles(files) {
    const added = [];
    for (const file of files) {
      if (file.type && !file.type.startsWith('image/')) {
        toast(`${file.name} is not an image.`, 'danger');
        continue;
      }
      const preview = URL.createObjectURL(file);
      localUrls.add(preview);
      added.push({
        draftId: `computer-${++sequence}`,
        source: 'computer',
        file,
        preview,
        title: file.name.replace(/\.[^.]+$/, '') || 'Photo',
      });
    }
    if (!added.length) return;
    photos = [...photos, ...added];
    primaryId ??= added[0].draftId;
  }

  function onfiles(event) {
    addFiles([...(event.currentTarget.files ?? [])]);
    event.currentTarget.value = '';
  }

  async function openPicker() {
    pickerOpen = true;
    pickerLoading = true;
    picked = [];
    query = '';
    try {
      media = await api.get(`/api/cases/${caseState.current.id}/media`);
    } catch (error) {
      toast(error.message, 'danger');
      pickerOpen = false;
    } finally {
      pickerLoading = false;
    }
  }

  function toggle(mediaId) {
    picked = picked.includes(mediaId)
      ? picked.filter((id) => id !== mediaId)
      : [...picked, mediaId];
  }

  function addPicked() {
    const selected = media
      .filter((item) => picked.includes(item.entity_id) && !attached.has(item.entity_id))
      .map((item) => ({
        draftId: `media-${item.entity_id}`,
        source: 'media',
        mediaId: item.entity_id,
        preview: fileUrl(caseState.current.id, item.thumbnail ?? item.path),
        title: item.title ?? item.filename ?? 'Photo',
      }));
    if (selected.length) {
      photos = [...photos, ...selected];
      primaryId ??= selected[0].draftId;
    }
    pickerOpen = false;
  }

  function remove(photo) {
    if (photo.source === 'computer') {
      URL.revokeObjectURL(photo.preview);
      localUrls.delete(photo.preview);
    }
    photos = photos.filter((item) => item.draftId !== photo.draftId);
    if (primaryId === photo.draftId) primaryId = photos[0]?.draftId ?? null;
  }

  onDestroy(() => {
    for (const url of localUrls) URL.revokeObjectURL(url);
  });
</script>

<section class="photo-draft" aria-label="Photos">
  <div class="photo-head">
    <span class="modal-label">Photos</span>
    <div class="photo-actions">
      <button class="btn btn-ghost btn-sm" onclick={() => fileInput?.click()} {disabled}>
        <Icon name="upload" size={13} /> Add from computer
      </button>
      <button class="btn btn-ghost btn-sm" onclick={openPicker} {disabled}>
        <Icon name="image" size={13} /> Choose from media
      </button>
    </div>
    <input
      class="file-input"
      bind:this={fileInput}
      type="file"
      accept="image/*"
      multiple
      onchange={onfiles}
    />
  </div>

  {#if photos.length}
    <div class="photos" aria-label="Photos to add">
      {#each photos as photo (photo.draftId)}
        <div class="photo">
          <button
            class="preview"
            class:primary={photo.draftId === primaryId}
            aria-label={`Use ${photo.title} as primary photo`}
            aria-pressed={photo.draftId === primaryId}
            onclick={() => (primaryId = photo.draftId)}
            disabled={disabled}
          >
            <img src={photo.preview} alt="" />
            {#if photo.draftId === primaryId}
              <span class="primary-mark" title="Primary photo"><Icon name="check" size={11} /></span>
            {/if}
          </button>
          <button
            class="remove"
            aria-label={`Remove ${photo.title}`}
            title="Remove photo"
            onclick={() => remove(photo)}
            disabled={disabled}
          ><Icon name="x" size={11} /></button>
        </div>
      {/each}
    </div>
  {/if}
</section>

{#if pickerOpen}
  <Modal title="Choose photos" width="620px" onclose={() => (pickerOpen = false)}>
    <div class="picker-head">
      <SearchInput bind:value={query} placeholder="Search photos…" count={matching.length} width="220px" />
    </div>
    {#if pickerLoading}
      <div class="picker-empty">Loading photos…</div>
    {:else if !matching.length}
      <div class="picker-empty">{query ? 'No matching images.' : 'No images available.'}</div>
    {:else}
      <div class="picker-grid">
        {#each matching as item (item.entity_id)}
          <button
            class="picker-item"
            class:picked={picked.includes(item.entity_id)}
            aria-pressed={picked.includes(item.entity_id)}
            onclick={() => toggle(item.entity_id)}
          >
            <img src={fileUrl(caseState.current.id, item.thumbnail ?? item.path)} alt="" loading="lazy" />
            <span>{item.title ?? item.filename}</span>
            {#if picked.includes(item.entity_id)}
              <span class="picked-mark"><Icon name="check" size={12} /></span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
    <div class="picker-actions">
      <button class="btn btn-ghost" onclick={() => (pickerOpen = false)}>Cancel</button>
      <button class="btn btn-primary" onclick={addPicked} disabled={!picked.length}>Add selected</button>
    </div>
  </Modal>
{/if}

<style>
  .photo-draft {
    margin-top: 12px;
  }
  .photo-head,
  .photo-actions,
  .picker-head,
  .picker-actions {
    display: flex;
    align-items: center;
  }
  .photo-head {
    justify-content: space-between;
    gap: 8px;
  }
  .photo-head .modal-label {
    margin: 0;
  }
  .photo-actions {
    gap: 2px;
  }
  .photo-actions .btn {
    gap: 5px;
    white-space: nowrap;
  }
  .file-input {
    display: none;
  }
  .photos {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 8px 2px 2px;
  }
  .photo {
    position: relative;
    flex: 0 0 74px;
  }
  .preview {
    position: relative;
    width: 74px;
    height: 56px;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-1);
  }
  .preview.primary {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .primary-mark,
  .picked-mark {
    position: absolute;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--accent);
    color: white;
  }
  .primary-mark {
    left: 4px;
    bottom: 4px;
    width: 18px;
    height: 18px;
  }
  .remove {
    position: absolute;
    top: -5px;
    right: -5px;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 50%;
    background: var(--bg-1);
    color: var(--text-2);
  }
  .remove:hover {
    color: var(--danger);
  }
  .picker-head {
    justify-content: flex-end;
    margin-bottom: 10px;
  }
  .picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px;
    max-height: 360px;
    overflow: auto;
  }
  .picker-item {
    position: relative;
    min-width: 0;
    padding: 5px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
    text-align: left;
  }
  .picker-item.picked {
    border-color: var(--accent);
  }
  .picker-item img {
    width: 100%;
    height: 82px;
    display: block;
    margin-bottom: 5px;
    border-radius: 3px;
    object-fit: cover;
  }
  .picker-item > span:not(.picked-mark) {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-xs);
  }
  .picked-mark {
    top: 9px;
    right: 9px;
    width: 20px;
    height: 20px;
  }
  .picker-empty {
    min-height: 150px;
    display: grid;
    place-items: center;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
  .picker-actions {
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
  }
</style>
