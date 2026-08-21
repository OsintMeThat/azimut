<script>
  /** Presentation photos for one hand-made entity.
   *
   * Computer imports stay private to the entity. Images chosen from the Media
   * Library remain references to their existing media.
   */
  import { api } from '../lib/api.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { caseState, reloadCase, toast } from '../lib/state.svelte.js';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import SearchInput from './SearchInput.svelte';

  let { entity } = $props();

  let images = $state([]);
  let selectedId = $state(null);
  let loading = $state(false);
  let loadError = $state(false);
  let busy = $state(false);
  let fileInput = $state();
  let pickerOpen = $state(false);
  let pickerLoading = $state(false);
  let media = $state([]);
  let picked = $state([]);
  let query = $state('');
  let dropping = $state(null);
  let loadSeq = 0;

  const selected = $derived(
    images.find((image) => image.id === selectedId)
      ?? images.find((image) => image.primary)
      ?? images[0]
      ?? null
  );
  const attached = $derived(
    new Set(images.map((image) => image.media_id).filter(Boolean))
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

  function adopt(next) {
    images = Array.isArray(next) ? next : [];
    if (!images.some((image) => image.id === selectedId)) {
      selectedId = images.find((image) => image.primary)?.id ?? images[0]?.id ?? null;
    }
  }

  $effect(() => {
    const caseId = caseState.current?.id;
    const entityId = entity?.id;
    caseState.rev;
    const seq = ++loadSeq;
    if (!caseId || !entityId) {
      adopt([]);
      return;
    }
    loading = true;
    loadError = false;
    api.get(`/api/cases/${caseId}/entities/${entityId}/images`)
      .then((result) => {
        if (seq === loadSeq) adopt(result.images);
      })
      .catch(() => {
        if (seq === loadSeq) loadError = true;
      })
      .finally(() => {
        if (seq === loadSeq) loading = false;
      });
  });

  async function changed(next, message) {
    adopt(next);
    await reloadCase();
    toast(message, 'ok');
  }

  function addedMessage(count) {
    if (!count) return 'No new photos added.';
    return count === 1 ? 'Photo added.' : `${count} photos added.`;
  }

  async function upload(files) {
    if (!files.length || busy) return;
    busy = true;
    let added = 0;
    let failed = 0;
    let next = images;
    try {
      for (const file of files) {
        if (file.type && !file.type.startsWith('image/')) {
          failed += 1;
          toast(`${file.name} is not an image.`, 'danger');
          continue;
        }
        const form = new FormData();
        form.append('file', file);
        try {
          const result = await api.post(
            `/api/cases/${caseState.current.id}/entities/${entity.id}/images/upload`,
            form
          );
          added += result.added;
          next = result.images;
        } catch (error) {
          failed += 1;
          toast(`${file.name}: ${error.message}`, 'danger');
        }
      }
      if (added) {
        await changed(next, addedMessage(added));
      } else if (!failed) {
        toast('No photos were selected.', 'info');
      }
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      busy = false;
    }
  }

  async function onfiles(event) {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = '';
    await upload(files);
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

  async function addPicked() {
    if (!picked.length || busy) return;
    busy = true;
    try {
      const result = await api.post(
        `/api/cases/${caseState.current.id}/entities/${entity.id}/images`,
        { media_ids: picked }
      );
      pickerOpen = false;
      await changed(result.images, addedMessage(result.added));
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      busy = false;
    }
  }

  async function makePrimary() {
    if (!selected || selected.primary || busy) return;
    busy = true;
    try {
      const result = await api.put(
        `/api/cases/${caseState.current.id}/entities/${entity.id}/images/${selected.id}/primary`
      );
      await changed(result.images, 'Primary photo updated.');
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      busy = false;
    }
  }

  /** One button, two acts, and only one of them is a delete.
   *
   *  A photo chosen from the Media Library is a reference: taking it off leaves the media
   *  in the case, so it goes on the click. A photo imported from the computer exists
   *  nowhere else — this gallery is the only copy the case ever had, and it is not an
   *  artifact, so there is no Trash behind it and no Undo on the toast. That one is asked
   *  for, and the two are not called the same thing: `Remove` said nothing about which of
   *  them the click was about. */
  function askRemove() {
    if (!selected || busy) return;
    if (selected.direct) dropping = selected;
    else drop(selected);
  }

  async function drop(image) {
    busy = true;
    try {
      const result = await api.del(
        `/api/cases/${caseState.current.id}/entities/${entity.id}/images/${image.id}`
      );
      dropping = null;
      await changed(
        result.images,
        image.direct ? 'Photo deleted.' : 'Photo removed from this entity.'
      );
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      busy = false;
    }
  }
</script>

<section class="gallery" aria-label="Photos">
  <div class="gallery-head">
    <span class="gallery-title">Photos</span>
    <div class="gallery-actions">
      <button class="btn btn-ghost btn-sm" onclick={() => fileInput?.click()} disabled={busy}>
        <Icon name="upload" size={13} /> Add from computer
      </button>
      <button class="btn btn-ghost btn-sm" onclick={openPicker} disabled={busy}>
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

  {#if loading}
    <div class="empty">Loading photos…</div>
  {:else if loadError}
    <div class="empty">Photos could not be loaded.</div>
  {:else if selected}
    <div class="main-photo">
      <img
        src={fileUrl(caseState.current.id, selected.thumbnail ?? selected.path)}
        alt={entity.label}
      />
    </div>
    <div class="photo-controls">
      {#if selected.primary}
        <span class="primary"><Icon name="check" size={12} /> Primary</span>
      {:else}
        <button class="btn btn-ghost btn-sm" onclick={makePrimary} disabled={busy}>
          Set as primary
        </button>
      {/if}
      <button
        class="btn btn-ghost btn-sm remove"
        title={selected.direct
          ? 'This copy exists nowhere else'
          : 'Take it off this entity; the media stays in the case'}
        onclick={askRemove}
        disabled={busy}
      >{selected.direct ? 'Delete this copy' : 'Remove'}</button>
    </div>
    {#if images.length > 1}
      <div class="thumbs" aria-label="Attached photos">
        {#each images as image (image.id)}
          <button
            class="thumb"
            class:selected={image.id === selected.id}
            aria-label={`Show ${image.title ?? image.filename ?? 'photo'}`}
            aria-pressed={image.id === selected.id}
            onclick={() => (selectedId = image.id)}
          >
            <img
              src={fileUrl(caseState.current.id, image.thumbnail ?? image.path)}
              alt=""
              loading="lazy"
            />
            {#if image.primary}<span class="primary-dot" title="Primary photo"></span>{/if}
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</section>

{#if dropping}
  <ConfirmDialog
    title="Delete this photo?"
    message="It was imported into this entity, so the case holds no other copy."
    detail="The Trash keeps deleted artifacts. A presentation photo is not one, so this cannot be brought back."
    confirmLabel="Delete"
    tone="danger"
    busy={busy}
    onconfirm={() => drop(dropping)}
    oncancel={() => (dropping = null)}
  />
{/if}

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
      <button class="btn btn-primary" onclick={addPicked} disabled={!picked.length || busy}>
        Add selected
      </button>
    </div>
  </Modal>
{/if}

<style>
  .gallery {
    margin-bottom: 14px;
  }
  .gallery-head,
  .photo-controls,
  .picker-head,
  .picker-actions {
    display: flex;
    align-items: center;
  }
  .gallery-head {
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  .gallery-title {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-2);
  }
  .gallery-actions {
    display: flex;
    gap: 2px;
  }
  .gallery-actions .btn {
    gap: 5px;
    white-space: nowrap;
  }
  .file-input {
    display: none;
  }
  .main-photo {
    height: 220px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--r);
    background: var(--bg-2);
  }
  .main-photo img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .empty {
    min-height: 74px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1px dashed var(--border);
    border-radius: var(--r);
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .photo-controls {
    min-height: 32px;
    justify-content: flex-end;
    gap: 4px;
  }
  .primary {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-right: auto;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .remove:hover {
    color: var(--danger);
  }
  .thumbs {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding: 2px 0;
  }
  .thumb {
    position: relative;
    flex: 0 0 52px;
    height: 42px;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .thumb.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .primary-dot {
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 7px;
    height: 7px;
    border: 1px solid var(--bg-1);
    border-radius: 50%;
    background: var(--accent);
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
    position: absolute;
    top: 9px;
    right: 9px;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--accent);
    color: white;
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
