<script>
  /**
   * A geolocation index into proofs, a row at a time.
   *
   * The one road out of a sheet that goes and fetches files, which is why it is a button
   * of its own and not a mode of *To the case*: that press is one transaction because
   * nothing in it touches the network, and this one is a hundred downloads.
   *
   * Three columns and a note say what a row is — the footage, the published picture, the
   * point, and what to call the result — and how much of that a row holds decides what it
   * becomes: a place on its own, the footage posed on that place, or the whole
   * constellation a hand-made import writes.
   *
   * **The plan downloads nothing.** The refusals come out of the cells and the "already
   * there" answers out of the case, so an analyst reads what a hundred downloads would do
   * before one of them starts. And a build is safe to press twice without this screen
   * remembering anything: a proof is found by the name it was saved under.
   */
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { proposal } from '../lib/sheetBuild.js';
  import { ID_COLUMN } from '../lib/sheet.js';

  let {
    table, meta, count, scope = 'ticked', busy = false, progress = null, report = null,
    onpreview, onbuild, oncancel, onclose,
  } = $props();

  /** What each column is. Named for what the row becomes rather than for what the cell
   *  looks like: two columns of addresses are not interchangeable here, and which is the
   *  footage is the whole difference between a proof and a picture. */
  const PARTS = [
    { id: 'title', label: 'Name of the proof' },
    { id: 'source', label: 'Address of the footage' },
    { id: 'proof', label: 'Address of the published picture' },
    { id: 'point', label: 'Coordinates' },
    { id: 'note', label: 'Note carried onto the proof' },
    { id: 'status', label: 'Status' },
  ];

  const WORDS = {
    make: 'Build',
    join: 'Already there',
    update: 'Refresh',
    skip: 'Left out',
    error: 'Cannot build',
  };
  /** What a row turned out to be. The plan's word is an intention, and a row that has
   *  been built for ten seconds should not still be saying it is about to be. */
  const DONE = { built: 'Built', restated: 'Refreshed', failed: 'Failed' };

  const columns = $derived(
    (table?.columns ?? []).filter((name) => String(name).toLowerCase() !== ID_COLUMN),
  );

  // Read once, on purpose: this is a proposal the analyst then edits, and a derived one
  // would undo their choice every time a cell changed under them.
  let picked = $state(untrack(() => proposal(table, meta)));
  /** Whether the camera was at the point. One answer for the whole press: a column of its
   *  own waits for a binder that actually holds one. */
  let pov = $state(false);
  /** Ruled-out rows are dropped by default and handed back with one click, because a
   *  filter nobody can see is the app deciding which lines of a binder count. */
  let keepRuledOut = $state(false);
  /** Rows read in the plan and put aside. */
  let left = $state(new Set());

  let plan = $state(null);
  let planning = $state(false);
  let failed = $state('');
  /** Whether this plan has already been pressed. The case moved under it, so the plan on
   *  screen is now a description of what *was* true, and offering the button again would
   *  offer to build rows that are already built. Reading it again is one press. */
  let pressed = $state(false);

  const ready = $derived(Boolean(picked.point && (picked.source || picked.proof) && count));
  const doing = $derived(
    (plan?.rows ?? []).filter(
      (row) => ['make', 'join', 'update'].includes(row.action) && !left.has(row.key),
    ),
  );
  /** What a row came back with, by row key, once a press is over. */
  const outcomes = $derived(
    new Map((report?.rows ?? []).map((row) => [row.key, row])),
  );

  function declaration() {
    return {
      ...picked,
      pov,
      skip_states: keepRuledOut ? [] : ['ruled out'],
      skip: [...left],
    };
  }

  function set(part, name) {
    picked = { ...picked, [part]: name };
    plan = null;
  }

  async function look() {
    planning = true;
    failed = '';
    try {
      plan = await onpreview(declaration());
      left = new Set();
      pressed = false;
    } catch (error) {
      failed = error?.message || 'That declaration could not be read.';
      plan = null;
    } finally {
      planning = false;
    }
  }

  function leaveOut(key) {
    const next = new Set(left);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    left = next;
  }
</script>

<div class="build">
  <p class="lead">
    <strong>{count}</strong> {scope} {count === 1 ? 'row' : 'rows'}. This one goes to the
    network: each row downloads what it points at, and a row that fails costs that row.
  </p>

  <p class="label">What each column is</p>
  <div class="parts">
    {#each PARTS as part (part.id)}
      <label class="row">
        <span>{part.label}</span>
        <select class="input" aria-label={part.label} value={picked[part.id] ?? ''}
                onchange={(event) => set(part.id, event.currentTarget.value)}>
          <option value="">—</option>
          {#each columns as name (name)}<option value={name}>{name}</option>{/each}
        </select>
      </label>
    {/each}
  </div>

  <label class="check">
    <input type="checkbox" checked={pov}
           onchange={(event) => (pov = event.currentTarget.checked)} />
    <span>The camera was at this point, not looking at it</span>
  </label>
  {#if picked.status}
    <label class="check">
      <input type="checkbox" checked={keepRuledOut}
             onchange={(event) => { keepRuledOut = event.currentTarget.checked; plan = null; }} />
      <span>Build the rows ruled out too</span>
    </label>
  {/if}

  {#if failed}
    <p class="failed" role="alert">{failed}</p>
  {/if}

  {#if plan}
    <p class="label">
      {report ? 'What it wrote' : 'What this would write'}
      {#each ['make', 'join', 'update', 'skip', 'error'] as action (action)}
        {#if plan.counts?.[action]}
          <span class="tally-part {action}">
            <strong>{plan.counts[action]}</strong> {WORDS[action].toLowerCase()}
          </span>
        {/if}
      {/each}
    </p>
    <div class="plan">
      {#each plan.rows as row (row.key)}
        {@const done = outcomes.get(row.key)}
        {@const said = done
          ? (done.outcome === 'failed' ? done.reason : done.outcome)
          : row.reason || row.writes}
        <div class="plan-row {done ? done.outcome : row.action}" class:aside={left.has(row.key)}>
          <span class="mark">{done ? DONE[done.outcome] : WORDS[row.action]}</span>
          <!-- A binder's title is a sentence, and it used to take the whole line and leave
               four characters for the reason — which on a failed row is the only part worth
               reading. So the reason gets the room and both carry what they say in full. -->
          <span class="who" title={row.title || row.coords || row.key}>
            {row.title || row.coords || row.key}
          </span>
          <small class="why" title={said}
                 class:warn={done ? done.outcome === 'failed' : row.action === 'error'}>
            {said}
          </small>
          {#if ['make', 'join', 'update'].includes(row.action)}
            <button class="undo" onclick={() => leaveOut(row.key)}>
              {left.has(row.key) ? 'Put back' : 'Leave out'}
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if progress}
    <!-- Counted in rows, not in bytes: what an analyst watches for two minutes is how far
         down the binder it has got, and a row is the unit this road is atomic in. The
         same bar the Media Library draws, so a download reads the same wherever it is. -->
    {@const of = progress.total ?? 0}
    {@const at = progress.done ?? 0}
    <div class="progress" aria-live="polite">
      <div class="bar" role="progressbar" aria-valuenow={at} aria-valuemin="0"
           aria-valuemax={of} aria-label="Rows built">
        <div class="fill" class:indeterminate={!of}
             style:width={of ? `${Math.round((at / of) * 100)}%` : '40%'}></div>
      </div>
      <span class="progress-meta" title={progress.label ?? ''}>
        {at} of {of}{#if progress.label} · <em>{progress.label}</em>{/if}
      </span>
    </div>
  {:else if report}
    <p class="progress done" aria-live="polite">
      <Icon name="check" size={13} />
      {[
        report.counts?.built && `${report.counts.built} built`,
        report.counts?.restated && `${report.counts.restated} refreshed`,
        report.counts?.failed && `${report.counts.failed} failed`,
        report.stopped && 'stopped',
      ]
        .filter(Boolean)
        .join(' · ') || 'Nothing to build in those rows'}
    </p>
    <!-- Where the result is, and the one loose end this road leaves: a proof of several
         panels has no render until somebody opens it. -->
    <p class="note">
      Each row now points at what it produced. A proof composed of several pictures has no
      export until it is opened in the composer once.
    </p>
  {/if}

  <div class="modal-row">
    <div class="spacer"></div>
    {#if busy}
      <button class="btn" onclick={oncancel}>Stop</button>
    {:else if report}
      <button class="btn" disabled={planning} onclick={look}>Preview again</button>
      <button class="btn btn-primary" onclick={onclose}>Done</button>
    {:else}
      <button class="btn" onclick={onclose}>Close</button>
      <button class="btn" disabled={!ready || planning} onclick={look}>
        {planning ? 'Reading…' : plan ? 'Preview again' : 'Preview'}
      </button>
      {#if plan && !pressed}
        <button class="btn btn-primary" disabled={!doing.length}
                onclick={() => { pressed = true; onbuild(declaration()); }}>
          Build {doing.length} {doing.length === 1 ? 'row' : 'rows'}
        </button>
      {/if}
    {/if}
  </div>
</div>

<style>
  /* Nothing in here widens the dialog: a modal that scrolls sideways is a modal whose
     buttons walk off the screen. */
  .build { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .lead { color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; }
  .lead strong { color: var(--text-1); }
  .label {
    display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
    color: var(--text-3); font-size: var(--fs-xs); margin: 12px 0 5px; line-height: 1.5;
  }
  .parts { display: flex; flex-direction: column; }
  .row {
    display: grid; grid-template-columns: minmax(0, 1fr) 210px; align-items: center;
    gap: 8px; padding: 3px 0;
  }
  .row span { color: var(--text-2); font-size: var(--fs-sm); }
  .check { display: flex; align-items: center; gap: 7px; padding: 6px 0 2px; }
  .check span { color: var(--text-2); font-size: var(--fs-sm); }
  .failed { color: var(--danger); font-size: var(--fs-sm); margin-top: 10px; }

  .tally-part { color: var(--text-3); }
  .tally-part strong { color: var(--text-1); font-weight: 600; }
  .tally-part.error, .tally-part.error strong { color: var(--danger); }
  .plan {
    max-height: 260px; overflow: auto;
    border: 1px solid var(--border); border-radius: var(--r-sm);
  }
  .plan-row {
    display: flex; align-items: center; gap: 8px; padding: 4px 7px;
    border-bottom: 1px solid var(--border); font-size: var(--fs-xs);
  }
  .plan-row:last-child { border-bottom: 0; }
  .plan-row.aside { opacity: 0.5; }
  .mark {
    flex: none; width: 84px; color: var(--text-3);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .plan-row.make .mark, .plan-row.built .mark { color: var(--ok); }
  .plan-row.join .mark, .plan-row.update .mark, .plan-row.restated .mark {
    color: var(--accent);
  }
  .plan-row.error .mark, .plan-row.failed .mark { color: var(--danger); }
  /* The title yields, the reason grows: a row that could not be built says why, and a
     sentence of a title is not what the analyst is reading at that moment. */
  .who {
    flex: 0 1 auto; min-width: 0; max-width: 44%; color: var(--text-1);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .why {
    flex: 1 1 0; min-width: 0; color: var(--text-3);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .why.warn { color: var(--anno-6); }
  .progress {
    display: flex; align-items: center; gap: 9px; margin-top: 12px; min-width: 0;
    color: var(--text-2); font-size: var(--fs-sm);
  }
  .progress em { color: var(--text-1); font-style: normal; }
  .progress.done { color: var(--ok); }
  .bar {
    flex: 1 1 auto; min-width: 90px; height: 6px; border-radius: 3px;
    background: var(--bg-3); overflow: hidden;
  }
  .fill {
    height: 100%; background: var(--accent); border-radius: 3px;
    transition: width 0.4s var(--ease);
  }
  /* Before the first row lands there is nothing to be a fraction of, so it moves rather
     than sitting at zero looking stuck. */
  .fill.indeterminate { animation: creep 1.4s var(--ease) infinite; }
  @keyframes creep {
    0% { margin-left: -40%; }
    100% { margin-left: 100%; }
  }
  /* A binder's title is a sentence. Unbounded and `nowrap`, one of them pushed the line
     past the modal, squeezed the bar to nothing and set the whole dialog scrolling
     sideways — so the name yields and the bar keeps its floor. */
  .progress-meta {
    flex: 0 1 auto; min-width: 0; max-width: 55%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .spacer { flex: 1; }
  .undo { flex: none; margin-left: auto; color: var(--text-3); font-size: var(--fs-xs); }
  .undo:hover { color: var(--accent); text-decoration: underline; }
  .modal-row { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
</style>
