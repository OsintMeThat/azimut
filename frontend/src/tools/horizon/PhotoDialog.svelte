<script>
  /**
   * Which photo or video to lay over the view: a file on this computer,
   * dropped on the box at the top or chosen from it, or one of the case's,
   * picked from the list Inspect opens files from. With a case open a file
   * from the computer is added to the case, so the work on it can be kept;
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

  /** The case's kinds a photo can be matched from: captures and collages stay under All. */
  const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'image', label: 'Photos' },
    { id: 'video', label: 'Videos' },
    { id: 'frame', label: 'Frames' },
  ];

  let media = $state([]);
  let loading = $state(false);
  let failed = $state('');
  let input = $state();
  let over = $state(false);

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

  function onDrop(event) {
    event.preventDefault();
    over = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) onfile(file);
  }
</script>

<Modal title="Add a photo or video" width="720px" {onclose}>
  <div class="photo-dialog">
    <div
      class="drop"
      class:over
      role="region"
      aria-label="Drop a photo or a video here"
      ondragover={(event) => {
        event.preventDefault();
        over = true;
      }}
      ondragleave={() => (over = false)}
      ondrop={onDrop}
    >
      <Icon name="upload" size={20} />
      <p class="say">Drop a photo or a video here</p>
      <button type="button" class="btn btn-sm" onclick={() => input?.click()}>Choose on this computer…</button>
      <p class="quiet">{caseId ? 'It is added to the case.' : 'It stays in this browser.'}</p>
      <input bind:this={input} type="file" accept="image/*,video/*" hidden onchange={chosen} />
    </div>
    {#if caseId}
      <h4>From the case</h4>
      {#if loading}
        <p class="quiet">Reading the case's files…</p>
      {:else if failed}
        <p class="quiet warn">{failed}</p>
      {:else if media.length}
        <SourcePicker {media} {caseId} {current} {onpick} filters={FILTERS} dense />
      {:else}
        <p class="quiet">This case has no photo or video yet.</p>
      {/if}
    {:else}
      <p class="quiet">Open a case to use its photos and keep the work on them.</p>
    {/if}
  </div>
</Modal>

<style>
  .photo-dialog {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 18px 16px;
    border: 1.5px dashed var(--border-strong, var(--border));
    border-radius: var(--r-md);
    background: var(--bg-0);
    color: var(--text-2);
    text-align: center;
    transition:
      border-color 120ms ease,
      background 120ms ease;
  }
  .drop.over {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .say {
    margin: 0;
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  h4 {
    margin: 4px 0 0;
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .quiet {
    margin: 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .warn {
    color: var(--danger);
  }
</style>
