<script>
  /**
   * The tasks still open in the case's notes, under the case's own lists: `- [ ]`
   * written in a note is a to-do like any other. Ticking one writes the note
   * (`/notes/{id}/task`); its text opens the note on that line.
   */
  import { api } from '../../lib/api.js';
  import { caseState, toast } from '../../lib/state.svelte.js';
  import { openNotebook } from '../../lib/navigate.js';
  import { adoptSaved, flush, openCopy } from '../../lib/notes/noteDoc.svelte.js';
  import Icon from '../../components/Icon.svelte';

  /** `ready`: the case's own lists are read, so this read comes after theirs. */
  let { caseId, compact = false, ready = true } = $props();
  let items = $state([]);

  async function load(id = caseId) {
    try {
      const result = await api.get(`/api/cases/${id}/notes/tasks`);
      if (id === caseId) items = result.items ?? [];
    } catch {
      /* the case's own lists still show */
    }
  }

  // a moment later rather than at once: the lists' own read starts in the same turn, and goes first
  $effect(() => {
    const id = caseId;
    caseState.rev;
    if (!id || !ready) return;
    let live = true;
    queueMicrotask(() => { if (live) load(id); });
    return () => { live = false; };
  });

  async function tick(note, task) {
    // a copy open in this tab is written first, so the tick lands on the text as typed
    const copy = openCopy(caseId, note.id === 'case' ? null : note.id);
    try {
      if (copy) await flush(copy);
      const result = await api.post(`/api/cases/${caseId}/notes/${note.id}/task`, { line: task.line, text: task.text, done: true });
      if (copy) adoptSaved(copy, result.text);
    } catch (error) {
      toast(error.status === 409 ? 'That note changed since; it is read again' : error.message, 'warn');
    }
    await load();
  }
</script>

{#if items.length}
  <section class="from-notes" class:compact aria-label="To do in the notes">
    <h4>In the notes</h4>
    {#each items as note (note.id)}
      <div class="note">
        <span class="title"><Icon name="note" size={12} /> {note.title}</span>
        {#each note.tasks as task (task.line)}
          <div class="task">
            <input type="checkbox" aria-label={`Done: ${task.text}`} onchange={() => tick(note, task)} />
            <button type="button" class="text" title="Open the note at this task"
              onclick={() => openNotebook(note.id === 'case' ? null : note.id, { line: task.line })}>{task.text}</button>
          </div>
        {/each}
      </div>
    {/each}
  </section>
{/if}

<style>
  .from-notes { margin-top: 14px; display: flex; flex-direction: column; gap: 8px; }
  h4 { margin: 0; color: var(--text-3); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .note { display: flex; flex-direction: column; gap: 2px; }
  .title { display: inline-flex; align-items: center; gap: 5px; color: var(--text-2); font-size: var(--fs-xs); font-weight: 600; }
  .task { display: flex; align-items: flex-start; gap: 7px; padding: 2px 0; }
  .task input { margin-top: 3px; accent-color: var(--accent); }
  .text {
    flex: 1; text-align: left; border: none; background: none; padding: 0; color: var(--text-1); font: inherit;
    font-size: var(--fs-sm); cursor: pointer; line-height: 1.4;
  }
  .text:hover { color: var(--accent); }
</style>
