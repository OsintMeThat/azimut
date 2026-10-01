<script>
  /**
   * What the Sheet tab opens on: the sheets being worked on, and the ones this case could
   * start now. The same two halves Inspect opens on, recent work and a way in, so a tab is
   * never a blank grid or a lecture on what a sheet is.
   *
   * The case's own proposals lead the "start" half, counted (`lib/sheetHome.js`): the files
   * imported and not yet placed are a worklist the analyst would otherwise build by hand.
   */
  import Icon from './Icon.svelte';
  import { api } from '../lib/api.js';
  import { timeAgo } from '../lib/analysisViews.js';
  import { caseProposals, progressWords, recentSheets } from '../lib/sheetHome.js';
  import { SHEET_TEMPLATES } from '../lib/sheetTemplates.js';
  import { caseState } from '../lib/state.svelte.js';

  let {
    caseId,
    sheets = [],
    last = null,
    busy = false,
    onopen,
    onbuild,
    ontemplate,
    onimport,
    onpaste,
    onfromcase,
  } = $props();

  let files = $state(null);
  let proofs = $state(0);
  let term = $state('');

  // Asked again whenever the case reloads, since an import or a proof elsewhere changes
  // both answers. Read only: offering a worklist must not build it.
  $effect(() => {
    const id = caseId;
    void caseState.rev;
    if (!id) return;
    let live = true;
    api
      .get(`/api/cases/${id}/sheets/from-case/files`)
      .then((answer) => live && (files = answer))
      .catch(() => live && (files = null));
    api
      .get(`/api/cases/${id}/catalog/summary`)
      .then((answer) => live && (proofs = answer.by_type?.proof ?? 0))
      .catch(() => live && (proofs = 0));
    return () => (live = false);
  });

  const ordered = $derived(recentSheets(sheets, last));
  const shown = $derived(
    term.trim()
      ? ordered.filter((sheet) =>
          String(sheet.title ?? '').toLowerCase().includes(term.trim().toLowerCase()),
        )
      : ordered,
  );
  const proposals = $derived(caseProposals({ files, proofs, sheets }));

  function startShape(proposal) {
    if (proposal.open) onopen(proposal.open);
    else onbuild({ title: proposal.title, shape: proposal.shape });
  }
</script>

<div class="home">
  <section class="col recent">
    <div class="head">
      <h3>Recent sheets</h3>
      <p>A sheet is a CSV in the case folder. Status, notes and colours are kept with it.</p>
    </div>
    {#if sheets.length > 8}
      <input class="input find" bind:value={term} placeholder="Find a sheet"
             aria-label="Find a sheet" />
    {/if}
    {#if sheets.length}
      <ul class="sheets">
        {#each shown as sheet (sheet.id)}
          <li>
            <button class="sheet" onclick={() => onopen(sheet.id)}>
              <Icon name={sheet.shape === 'files' ? 'video' : sheet.shape === 'proofs' ? 'proof' : 'table'}
                    size={15} />
              <span class="name">{sheet.title}</span>
              {#if sheet.id === last}<em class="tag">Last open</em>{/if}
              <small>
                {sheet.rows} {sheet.rows === 1 ? 'row' : 'rows'}{#if progressWords(sheet.progress)}
                  · {progressWords(sheet.progress)}{/if}{#if sheet.modified_at}
                  · {timeAgo(sheet.modified_at)}{/if}
              </small>
            </button>
          </li>
        {:else}
          <li class="note">No match.</li>
        {/each}
      </ul>
    {:else}
      <p class="note">No sheet in this case yet.</p>
    {/if}
  </section>

  <section class="col start">
    <div class="head">
      <h3>Start a sheet</h3>
      <p>A worklist that counts what is left, or a grid that compares candidates.</p>
    </div>

    {#if proposals.length}
      <p class="label">From this case</p>
      <div class="cards">
        {#each proposals as proposal (proposal.shape)}
          <button class="card proposal" disabled={busy} onclick={() => startShape(proposal)}>
            <span class="card-title">
              <Icon name={proposal.shape === 'files' ? 'video' : 'proof'} size={14} />
              {proposal.title}
            </span>
            <small>{proposal.detail}</small>
            <small class="hint">{proposal.hint}</small>
            <span class="go">{proposal.open ? 'Open' : 'Build'}</span>
          </button>
        {/each}
      </div>
    {/if}

    <p class="label">From a template</p>
    <div class="cards">
      {#each SHEET_TEMPLATES as entry (entry.id)}
        <button class="card" onclick={() => ontemplate(entry.id)}>
          <span class="card-title">{entry.label}</span>
          <small>{entry.hint}</small>
        </button>
      {/each}
    </div>

    <p class="label">From a table</p>
    <div class="row-actions">
      <label class="btn btn-sm">
        <Icon name="upload" size={13} /> Import a file
        <input type="file" accept=".csv,.tsv,.xlsx,text/csv,text/plain" hidden
               onchange={(event) => { onimport(event.currentTarget.files); event.currentTarget.value = ''; }} />
      </label>
      <button class="btn btn-sm" onclick={onpaste}>
        <Icon name="copy" size={13} /> Paste a table
      </button>
      <button class="btn btn-sm" onclick={onfromcase}>
        <Icon name="graph" size={13} /> From the case
      </button>
    </div>
  </section>
</div>

<style>
  .home {
    flex: 1; min-height: 0; overflow: auto;
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 28px; max-width: 1240px; width: 100%; margin: 0 auto; padding: 24px 20px;
    align-content: start;
  }
  @media (max-width: 900px) { .home { grid-template-columns: minmax(0, 1fr); } }
  .col { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .head h3 { font-size: var(--fs-md); font-weight: 700; margin: 0 0 4px; }
  .head p { margin: 0; color: var(--text-3); font-size: var(--fs-sm); line-height: 1.5; }
  .find { max-width: 320px; }
  .sheets { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .sheet {
    width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: 'icon name tag' 'icon meta meta';
    align-items: center; column-gap: 10px; row-gap: 2px; padding: 8px 10px; text-align: left;
    border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2);
    color: var(--text-1);
  }
  .sheet:hover { border-color: var(--border-strong); }
  .sheet :global(svg) { grid-area: icon; color: var(--text-3); }
  .sheet .name {
    grid-area: name; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: var(--fs-sm); font-weight: 600;
  }
  .sheet .tag {
    grid-area: tag; font-style: normal; font-size: var(--fs-xs); color: var(--accent);
  }
  .sheet small { grid-area: meta; color: var(--text-3); font-size: var(--fs-xs); }
  .label { color: var(--text-3); font-size: var(--fs-xs); margin: 8px 0 0; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 6px; }
  .card {
    display: flex; flex-direction: column; gap: 3px; padding: 9px 11px; text-align: left;
    border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2);
    position: relative;
  }
  .card:hover:not(:disabled) { border-color: var(--border-strong); }
  .card.proposal { border-color: var(--accent); background: var(--accent-soft); }
  .card-title {
    display: inline-flex; align-items: center; gap: 6px;
    color: var(--text-1); font-size: var(--fs-sm); font-weight: 600;
  }
  .proposal .card-title { color: var(--accent); }
  .card small { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.4; }
  .proposal small:first-of-type { color: var(--text-2); }
  .go {
    position: absolute; top: 8px; right: 10px; font-size: var(--fs-xs); color: var(--accent);
    font-weight: 600;
  }
  .row-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .note { color: var(--text-3); font-size: var(--fs-sm); }
</style>
