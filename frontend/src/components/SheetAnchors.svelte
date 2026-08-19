<script>
  /**
   * The **sync points** several rows are lined up on, and the time each one happened.
   *
   * The method no consumer tool has. Ten videos of one event each carry an offset against
   * a shot that is visible and audible in all of them — `-00:01:50`, `00:04:04` — and the
   * binders wrote exactly that, in a column called `start synchro`. Their **relative
   * order is usable straight away**, before anybody knows what time anything happened.
   * The moment the shot itself is dated, every one of those rows has an absolute time to
   * the second.
   *
   * Named here rather than on the columns, because one moment serves several of them and a
   * time restated per column is a time that will disagree with itself. A sheet holds
   * several: the binders had `start synchro` *and* `end synchro`, and a real event has
   * more than one moment that several videos happen to catch.
   *
   * Dating one is optional and staying undated is the normal state. What it costs is only
   * the absolute times; the ordering is already there.
   */
  import Icon from './Icon.svelte';
  import { MAX_ANCHORS, MAX_ANCHOR_NAME, formatOffset, offsetMoment, parseOffset } from '../lib/sheetRoles.js';

  let { table, meta, onchange, onclose } = $props();

  const anchors = $derived(Object.entries(meta?.anchors ?? {}));
  /** Which columns count from each anchor, so renaming or dropping one is not done blind. */
  const columns = $derived(
    Object.entries(meta?.roles ?? {}).filter(([, role]) => role?.kind === 'offset'),
  );

  let adding = $state('');

  function counting(name) {
    return columns.filter(([, role]) => role.anchor === name).map(([column]) => column);
  }

  /** What one anchor's column would read once it is dated: the first row that carries an
   *  offset, shown as the time it lands on. A worked example beats a rule — nobody can
   *  check `-00:01:50` against `01:57:00Z` in their head. */
  function example(name, at) {
    const [column] = counting(name);
    if (!column || !at) return null;
    const index = (table?.columns ?? []).indexOf(column);
    for (const row of table?.rows ?? []) {
      const seconds = parseOffset(row[index]);
      if (seconds !== null) {
        return { offset: formatOffset(seconds), moment: offsetMoment(at, seconds) };
      }
    }
    return null;
  }

  function set(name, at) {
    onchange({ ...(meta.anchors ?? {}), [name]: { at } });
  }

  function drop(name) {
    const next = { ...(meta.anchors ?? {}) };
    delete next[name];
    onchange(next);
  }

  function add() {
    const name = adding.trim().slice(0, MAX_ANCHOR_NAME);
    if (!name || meta?.anchors?.[name]) return;
    adding = '';
    set(name, '');
  }
</script>

<div class="anchors">
  <p class="lead">
    A <strong>sync point</strong> is one moment visible in several rows: a launch, an impact, a
    shot heard in every video. Name it now and date it later; the order the rows run in does
    not wait for that.
  </p>

  <div class="list">
    {#each anchors as [name, entry] (name)}
      {@const used = counting(name)}
      {@const shown = example(name, entry.at)}
      <div class="entry">
        <div class="head">
          <Icon name="clock" size={12} />
          <span class="name">{name}</span>
          <div class="spacer"></div>
          <button class="drop" title="Remove this sync point" aria-label="Remove {name}"
                  onclick={() => drop(name)}>
            <Icon name="x" size={12} />
          </button>
        </div>
        <label class="field">
          <span>When it happened</span>
          <input class="input" type="datetime-local" step="1"
                 aria-label="When {name} happened"
                 value={(entry.at ?? '').replace('Z', '').slice(0, 19)}
                 onchange={(event) =>
                   set(name, event.currentTarget.value ? `${event.currentTarget.value}Z` : '')} />
        </label>
        <p class="why">
          {#if used.length}
            {used.join(', ')} {used.length === 1 ? 'is' : 'are'} synced on it.
          {:else}
            No column is synced on it yet. Set a column's type to <em>Offset</em>.
          {/if}
          {#if shown?.moment}
            <br />{shown.offset} lands on {shown.moment.replace('T', ' ').slice(0, 19)}.
          {:else if !entry.at}
            <br />Undated, so the rows have an order and no times.
          {/if}
        </p>
      </div>
    {:else}
      <p class="hint">No sync point named yet.</p>
    {/each}
  </div>

  {#if anchors.length < MAX_ANCHORS}
    <div class="add">
      <input class="input" placeholder="what happens at it"
             aria-label="Name a sync point" bind:value={adding}
             onkeydown={(event) => event.key === 'Enter' && add()} />
      <button class="btn btn-sm" disabled={!adding.trim()} onclick={add}>Name it</button>
    </div>
  {/if}

  <div class="modal-row">
    <div class="spacer"></div>
    <button class="btn" onclick={onclose}>Done</button>
  </div>
</div>

<style>
  .anchors { display: flex; flex-direction: column; min-height: 0; }
  .lead { color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; }
  .list { max-height: 340px; overflow: auto; margin-top: 12px; }
  .entry {
    padding: 7px 9px; margin-bottom: 6px;
    border: 1px solid var(--border); border-radius: var(--r-sm);
  }
  .head { display: flex; align-items: center; gap: 6px; color: var(--text-3); }
  .name {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--text-1); font-size: var(--fs-sm);
  }
  .drop { flex: none; color: var(--text-3); }
  .drop:hover { color: var(--danger); }
  .field { display: block; padding: 5px 0 2px; }
  .field span { display: block; color: var(--text-3); font-size: var(--fs-xs); margin-bottom: 3px; }
  .field .input { width: 100%; }
  .why { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
  .why em { font-style: normal; color: var(--text-2); }
  .hint { padding: 14px 10px; color: var(--text-3); font-size: var(--fs-sm); line-height: 1.5; }
  .add { display: flex; gap: 6px; margin-top: 8px; }
  .add .input { flex: 1; }
  .modal-row { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
  .spacer { flex: 1; }
</style>
