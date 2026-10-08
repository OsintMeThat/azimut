<script>
  /**
   * Which photo or video to lay over the view: one of the case's, picked
   * from the list Inspect opens files from, or a file on this computer. With
   * a case open that file is added to the case, so the work on it can be kept;
   * with none it stays in this browser.
   */
  import { onMount } from 'svelte';
  import { api } from '../../lib/api.js';
  import Modal from '../../components/Modal.svelte';
  import SourcePicker from '../../components/SourcePicker.svelte';
  import Icon from '../../components/Icon.svelte';

  let {
    /** The open case's id, or null in one-shot mode. */
    caseId = null,
    /** The case path already laid, marked in the list. */
    current = null,
    /** A case file picked: `{ path, kind, title, … }`. */
    onpick = () => {},
    /** A file from this computer picked. */
    onfile = () => {},
    onclose = () => {},
  } = $props();

  let media = $state([]);
  let loading = $state(false);
  let failed = $state('');
  let input = $state();

  onMount(async () => {
    if (!caseId) return;
    loading = true;
    try {
      const all = await api.get(`/api/cases/${caseId}/media`);
      media = all.filter((item) => item.kind === 'image' || item.kind === 'video');
    } catch (failure) {
      failed = failure.message;
    } finally {
      loading = false;
    }
  });

  function chosen(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) onfile(file);
  }
</script>

<Modal title="Add a photo or video" width="720px" {onclose}>
  <div class="photo-dialog">
    {#if caseId}
      {#if loading}
        <p class="quiet">Reading the case's files…</p>
      {:else if failed}
        <p class="quiet warn">{failed}</p>
      {:else if media.length}
        <SourcePicker {media} {caseId} {current} {onpick} />
      {:else}
        <p class="quiet">This case has no photo or video yet.</p>
      {/if}
    {:else}
      <p class="quiet">Open a case to use its photos and keep the work on them.</p>
    {/if}
    <div class="computer">
      <button type="button" class="btn btn-sm" onclick={() => input?.click()}>
        <Icon name="upload" size={14} />From this computer…
      </button>
      <span class="quiet">
        {caseId ? 'It is added to the case.' : 'It stays in this browser.'} You can also drop a file on the view.
      </span>
      <input bind:this={input} type="file" accept="image/*,video/*" hidden onchange={chosen} />
    </div>
  </div>
</Modal>

<style>
  .photo-dialog {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .computer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .computer .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .quiet {
    margin: 0;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
  .warn {
    color: var(--danger);
  }
</style>
