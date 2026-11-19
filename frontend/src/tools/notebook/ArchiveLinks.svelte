<script>
  /**
   * Archive every link of this note: the dialog that says what the press does, makes
   * it, and shows the run (`lib/notes/linkArchive.svelte.js`, `engine/linkarchive.py`).
   *
   * Before the press it reads the plan from the server alone: the note's outside links
   * in the public edition, how many have a copy already and how many the case lacks,
   * and says once what leaves the computer. Two ticks: *Include internal passages*
   * (off: the archive would learn what the team reads) and *Make fresh copies* (off: a
   * copy under 30 days old is reused). The press is the only thing that reaches the
   * Internet Archive. Then a row per link, the count and the time left; the dialog can
   * be closed while the run goes on, and Stop ends it after the link under way.
   */
  import { untrack } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import Modal from '../../components/Modal.svelte';
  import {
    SENDS, REUSE_DAYS, countWords, follow, followed, isActive, leftWords, planWords, readPlan, rowMark, rowWords,
    startArchive, stopArchive,
  } from '../../lib/notes/linkArchive.svelte.js';

  let {
    caseId,
    noteId,
    /** The note's name, which the toast at the end says. */
    title = '',
    onclose = () => {},
  } = $props();

  let plan = $state(null);
  let failed = $state('');
  let internal = $state(false);
  let fresh = $state(false);
  let busy = $state(false);
  // a run this dialog showed under way stays on screen once it ends, with what it did
  let watching = $state(false);

  const run = $derived(followed(caseId, noteId) ?? plan?.run ?? null);
  const going = $derived(isActive(run));
  const showRun = $derived(Boolean(run) && (going || watching));
  const counts = $derived(run?.counts ?? {});
  const rows = $derived(showRun ? run.links : planRows(plan));
  const done = $derived((counts.archived ?? 0) + (counts.failed ?? 0));
  const share = $derived(counts.total ? Math.round((done / counts.total) * 100) : 0);
  const again = $derived(showRun && !going ? run.links.filter((link) => ['failed', 'waiting', 'saving'].includes(link.state)).length : 0);
  const folder = $derived(run?.folder ?? plan?.folder ?? '');

  let list = $state(null);

  /** The plan's links, those to archive first, each with why it failed last time. */
  function planRows(said) {
    const failedBefore = new Map((said?.run?.links ?? []).filter((link) => link.state === 'failed').map((link) => [link.url, link.reason]));
    const links = (said?.links ?? []).map((link) => (link.state === 'todo' && failedBefore.get(link.url) ? { ...link, reason: failedBefore.get(link.url) } : link));
    return [...links.filter((link) => link.state === 'todo'), ...links.filter((link) => link.state !== 'todo')];
  }

  // while it runs, the link under way stays in sight
  $effect(() => {
    const index = going ? run.links.findIndex((link) => link.state === 'saving') : -1;
    if (index >= 0) list?.children[index]?.scrollIntoView?.({ block: 'nearest' });
  });

  async function load() {
    failed = '';
    try {
      const answer = await readPlan(caseId, noteId, { internal });
      plan = answer;
      if (isActive(answer?.run)) {
        watching = true;
        internal = Boolean(answer.run.internal);
        fresh = Boolean(answer.run.fresh);
        follow(caseId, noteId, answer.run, { title });
      }
    } catch (error) {
      failed = error.message;
    }
  }

  // read once on open; the tick reads again
  $effect(() => untrack(() => void load()));

  function tick(value) {
    internal = value;
    void load();
  }

  async function press() {
    if (busy) return;
    busy = true;
    failed = '';
    try {
      await startArchive(caseId, noteId, { internal, fresh, title });
      watching = true;
    } catch (error) {
      failed = error.message;
    } finally {
      busy = false;
    }
  }

  async function stop() {
    try {
      await stopArchive(caseId, noteId);
    } catch (error) {
      failed = error.message;
    }
  }

  /** Back to the plan, read again, for the links still without a copy. */
  async function tryAgain() {
    watching = false;
    await load();
    await press();
  }
</script>

<Modal title="Archive every link of this note" {onclose} width="580px">
  <p class="sends">{SENDS}</p>
  <div class="ticks">
    <div class="tick fixed">
      <Icon name="check" size={13} />
      <span>
        {internal ? 'Links of the note' : 'Links of the public edition'} ({showRun ? counts.total ?? 0 : plan?.total ?? 0})
        {#if !internal && plan?.more_internal}<small>Links in internal passages stay out unless you tick the next line.</small>{/if}
      </span>
    </div>
    {#if plan?.more_internal || internal}
      <label class="tick" title="They would tell the archive what the team reads">
        <input type="checkbox" checked={internal} disabled={showRun || busy} onchange={(event) => tick(event.currentTarget.checked)} />
        {`Include internal passages${plan?.more_internal ? ` (${plan.more_internal} more link${plan.more_internal === 1 ? '' : 's'})` : ''}`}
      </label>
    {/if}
    <label class="tick" title={`A copy the archive made in the last ${REUSE_DAYS} days is reused unless this is ticked`}>
      <input type="checkbox" bind:checked={fresh} disabled={showRun || busy} />
      Make fresh copies, even where one is under {REUSE_DAYS} days old
    </label>
  </div>

  {#if failed}<p class="problem" role="alert">{failed}</p>{/if}

  {#if !plan && !run && !failed}
    <p class="quiet" role="status">Reading the links…</p>
  {:else if plan || run}
    <div class="head" role="status">
      <strong>{showRun ? countWords(run) : planWords(plan)}</strong>
      {#if showRun && going}
        <span>{[run.state === 'stopping' ? 'stopping after this link' : leftWords(run.left), 'you can close this'].filter(Boolean).join(' · ')}</span>
      {:else if showRun && run.state === 'stopped'}
        <span class="stopped">{run.reason}</span>
      {/if}
    </div>
    {#if showRun}
      <div class="bar" role="progressbar" aria-label="Links archived" aria-valuemin="0" aria-valuemax="100" aria-valuenow={share}>
        <span style:width={`${share}%`}></span>
      </div>
    {:else if plan?.run && !isActive(plan.run) && plan.run.counts?.failed}
      <p class="quiet">Last time {countWords(plan.run)}; the press tries the rest again.</p>
    {/if}
    {#if rows.length}
      <ul class="links" aria-label="Links" bind:this={list}>
        {#each rows as link, index (index)}
          {@const mark = rowMark(link)}
          <li data-state={link.state}>
            <span class="mark" data-mark={mark}>
              <Icon name={{ done: 'check', warn: 'alert', failed: 'x', busy: 'reset', waiting: 'clock' }[mark]} size={13} />
            </span>
            <span class="words" dir="auto" title={link.url}>{link.text || link.url}</span>
            {#if link.copy}
              <a class="said" href={link.copy} target="_blank" rel="noopener noreferrer" title="Open the archived copy">{rowWords(link)}</a>
            {:else}
              <span class="said" class:again={link.state === 'todo' && Boolean(link.reason)}>{rowWords(link)}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="quiet">This note links to no outside page.</p>
    {/if}
  {/if}

  <div class="foot">
    <p class="filed">{folder ? `Links the case lacks are filed as bookmarks in the folder ${folder}.` : ''}</p>
    {#if showRun && going}
      <button type="button" class="btn" disabled={run.state === 'stopping'} onclick={stop}>Stop</button>
      <button type="button" class="btn btn-primary" onclick={onclose}>Keep going in the background</button>
    {:else if showRun}
      {#if again}<button type="button" class="btn" disabled={busy} onclick={tryAgain}>Try the {again} again</button>{/if}
      <button type="button" class="btn btn-primary" onclick={onclose}>Close</button>
    {:else}
      <button type="button" class="btn" onclick={onclose}>Cancel</button>
      <button type="button" class="btn btn-primary" disabled={busy || !plan?.todo} onclick={press}>
        {busy ? 'Starting…' : plan?.todo ? `Archive ${plan.todo} link${plan.todo === 1 ? '' : 's'}` : 'Every link is archived'}</button>
    {/if}
  </div>
</Modal>

<style>
  .sends { margin: 0 0 12px; color: var(--text-2); font-size: var(--fs-sm); line-height: 1.45; }
  .ticks { display: flex; flex-direction: column; border-top: 1px solid var(--border); }
  .tick {
    display: flex; align-items: flex-start; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border);
    color: var(--text-1); font-size: var(--fs-sm); cursor: pointer;
  }
  .tick input { margin: 2px 0 0; }
  .tick.fixed { cursor: default; }
  .tick.fixed :global(svg) { flex: none; margin-top: 2px; color: var(--accent); }
  .tick small { display: block; margin-top: 2px; color: var(--text-3); font-size: var(--fs-xs); }
  .problem { margin: 10px 0 0; color: var(--danger); font-size: var(--fs-sm); }
  .quiet { margin: 10px 0 0; color: var(--text-3); font-size: var(--fs-xs); }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 14px 0 6px; font-size: var(--fs-sm); }
  .head strong { color: var(--text-1); }
  .head span { color: var(--text-3); font-size: var(--fs-xs); text-align: right; }
  .head .stopped { color: var(--warn); }
  .bar { height: 5px; margin: 0 0 6px; border-radius: 3px; background: var(--bg-3); overflow: hidden; }
  .bar span { display: block; height: 100%; border-radius: 3px; background: var(--accent); transition: width 0.4s ease; }
  .links { list-style: none; margin: 0; padding: 0; max-height: 280px; overflow: auto; border-top: 1px solid var(--border); }
  .links li {
    display: flex; align-items: center; gap: 9px; min-height: 30px; padding: 0 2px;
    border-bottom: 1px solid var(--border); font-size: var(--fs-sm);
  }
  .mark { flex: none; display: inline-flex; color: var(--text-3); }
  .mark[data-mark='done'] { color: var(--ok); }
  .mark[data-mark='warn'] { color: var(--warn); }
  .mark[data-mark='failed'] { color: var(--danger); }
  .mark[data-mark='busy'] { color: var(--accent); }
  .mark[data-mark='busy'] :global(svg) { animation: turn 1.2s linear infinite; }
  @keyframes turn { to { transform: rotate(360deg); } }
  .words { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-1); }
  .said {
    flex: none; max-width: 52%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--text-3); font-size: var(--fs-xs);
  }
  a.said:hover, a.said:focus-visible { color: var(--text-1); text-decoration: underline; }
  li[data-state='failed'] .said, .said.again { color: var(--danger); }
  li[data-state='older'] .said { color: var(--warn); }
  .foot { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
  .filed { flex: 1; min-width: 0; margin: 0; color: var(--text-3); font-size: var(--fs-xs); }
</style>
