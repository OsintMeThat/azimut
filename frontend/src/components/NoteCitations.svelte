<script>
  /**
   * The notes that cite a record, each with the line it is cited in, so Details
   * says what was written about it and one press opens the note there.
   * Read when shown, from the notes themselves (`/notes/citations`).
   */
  import { api } from '../lib/api.js';
  import { openNotebook } from '../lib/navigate.js';
  import Icon from './Icon.svelte';

  let { caseId, entityId, onopened = () => {} } = $props();
  let items = $state([]);

  $effect(() => {
    const id = entityId;
    const cid = caseId;
    items = [];
    if (!id || !cid) return;
    let live = true;
    api.get(`/api/cases/${cid}/notes/citations/${encodeURIComponent(id)}`)
      .then((result) => { if (live) items = result.items ?? []; })
      .catch(() => {});
    return () => { live = false; };
  });

  function open(note, line) {
    openNotebook(note.id === 'case' ? null : note.id, { line });
    onopened();
  }
</script>

{#if items.length}
  <section class="cited" aria-label="Cited in notes">
    <h4>Cited in notes</h4>
    {#each items as note (note.id)}
      <div class="note">
        <span class="title"><Icon name="note" size={12} /> {note.title}{#if note.folder}<small>{note.folder}</small>{/if}</span>
        {#each note.lines as line (line.line)}
          <button type="button" class="line" title="Open the note at this line" onclick={() => open(note, line.line)}>{line.text}</button>
        {/each}
      </div>
    {/each}
  </section>
{/if}

<style>
  .cited { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
  h4 { margin: 0; color: var(--text-3); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .note { display: flex; flex-direction: column; gap: 3px; }
  .title { display: inline-flex; align-items: center; gap: 5px; font-size: var(--fs-sm); font-weight: 600; color: var(--text-1); }
  .title small { color: var(--text-3); font-weight: 400; font-size: var(--fs-xs); margin-left: 4px; }
  .line {
    text-align: left; border: none; border-left: 2px solid var(--border-strong); background: none; color: var(--text-2);
    font: inherit; font-size: var(--fs-sm); padding: 2px 0 2px 8px; cursor: pointer; line-height: 1.4;
  }
  .line:hover { border-left-color: var(--accent); color: var(--text-1); }
</style>
