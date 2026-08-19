<script>
  /**
   * A column of place names read into coordinates, or a column of coordinates read into
   * place names.
   *
   * Both directions were already in this app — the map searches, the media library backfills
   * countries — and the sheet, which is where a geolocation index is actually worked, could
   * reach neither. So four hundred rows of `Kherson, Ukraine` were typed in by hand.
   *
   * The screen is built around the two rules this has to keep:
   *
   * - **Nothing is applied on its own.** The pass looks the values up, shows what it found,
   *   and writes only on the second press. A geocoder's first hit is a guess, and a guess
   *   written unattended into a column of evidence is indistinguishable from a coordinate
   *   somebody read off a photograph.
   * - **Only the empty cells.** A row that already holds an answer is never asked about,
   *   which is stated on screen rather than assumed.
   *
   * It reads the rows **on screen**, filter and all, like the cleaning passes. Nominatim is
   * paced at about one request a second on the server, so the lookups run one at a time with
   * a count and a Stop — a progress bar here is not decoration, it is the honest shape of
   * the thing.
   *
   * A forward pass has **two halves**, and the first one is free: the rows whose cell already
   * points at an entity the case has placed are answered off the graph, exactly and at once.
   * Only the words left over are worth a stranger's server. Before that split, a column of
   * linked subjects spent forty seconds being told nothing, because `3rd Bde` is not a
   * toponym and Nominatim was the wrong thing to ask.
   */
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { ID_COLUMN } from '../lib/sheet.js';
  import {
    MAX_CASE_POINTS,
    MAX_LOOKUPS,
    casePoints,
    geocodeValue,
    linkedRows,
    namesToRead,
    placeCell,
    pointCell,
    pointsToRead,
    reverseValue,
  } from '../lib/sheetGeo.js';

  let {
    caseId,
    sheetId,
    table,
    meta,
    column,
    mode = 'forward',
    rows = [],
    writable = [],
    onedits,
    onclose,
  } = $props();

  const forward = $derived(mode === 'forward');
  /** Where the answers go. Never the column being read, and never the row's handle. */
  const targets = $derived(
    (writable ?? []).filter(
      (entry) => entry.index !== column.index && String(entry.name).toLowerCase() !== ID_COLUMN,
    ),
  );

  let targetName = $state('');
  let looking = $state(false);
  let stopped = $state(false);
  let done = $state(0);
  /** What was found, as `{ label, cell, rows }` — one entry per lookup, so the analyst reads
   *  the answers rather than a number claiming there were some. */
  let found = $state([]);
  let missed = $state([]);

  const targetIndex = $derived((table?.columns ?? []).indexOf(targetName));

  /** The rows the case may answer, read without regard to the target column so the graph is
   *  asked once for the dialog rather than once per column considered. */
  const linkable = $derived(forward ? linkedRows(table, meta, column.index, -1, rows) : []);
  /** What the graph answered, `{ id: { lat, lon } }`. Empty until it has, and empty for good
   *  if it could not: the geocoder then covers the column exactly as it used to. */
  let points = $state({});

  // Asked once as the screen opens, and untracked: the links are what they are for as long
  // as this dialog is up, so re-asking would be the same question put again on every colour
  // or filter the grid behind it writes into the sidecar.
  $effect(() => {
    untrack(() => ask());
  });

  async function ask() {
    const ids = linkable.map((entry) => entry.id);
    if (ids.length) points = await casePoints(caseId, sheetId, ids);
  }

  /** The rows written straight from the case: a link, a point behind it, and an empty cell
   *  to put it in. An entity the case places two ways answers nothing and stays here. */
  const fromCase = $derived(
    linkable
      .filter(
        (entry) =>
          targetIndex !== -1 && !String(table.rows[entry.row]?.[targetIndex] ?? '').trim(),
      )
      .map((entry) => ({ ...entry, cell: pointCell(points[entry.id]) }))
      .filter((entry) => entry.cell),
  );
  const answered = $derived(new Set(fromCase.map((entry) => entry.row)));
  const work = $derived(
    forward
      ? namesToRead(
          table,
          column.index,
          targetIndex,
          (rows ?? []).filter((index) => !answered.has(index)),
        )
      : pointsToRead(table, column.index, targetIndex, rows),
  );
  const capped = $derived(work.length > MAX_LOOKUPS);
  const batch = $derived(work.slice(0, MAX_LOOKUPS));
  /** Whether a lookup has run, so the buttons say "look" once and "look again" after. */
  const lookedUp = $derived(done > 0 || found.length > 0 || missed.length > 0);
  const writes = $derived([
    ...fromCase.map((entry) => ({
      row: entry.row,
      column: targetIndex,
      before: table.rows[entry.row]?.[targetIndex] ?? '',
      after: entry.cell,
    })),
    ...found.flatMap((entry) =>
      entry.rows.map((row) => ({
        row,
        column: targetIndex,
        before: table.rows[row]?.[targetIndex] ?? '',
        after: entry.cell,
      })),
    ),
  ]);

  // Seeded once there is something to choose, and only then: a column picked before the
  // dialog knows the sheet's headings would be a blank select.
  $effect(() => {
    if (!targetName && targets.length) targetName = targets[0].name;
  });

  async function look() {
    if (!batch.length || looking || targetIndex === -1) return;
    looking = true;
    stopped = false;
    done = 0;
    found = [];
    missed = [];
    for (const entry of batch) {
      if (stopped) break;
      const answer = forward
        ? await geocodeValue(entry.value)
        : await reverseValue(entry.point.lat, entry.point.lon);
      const cell = forward ? pointCell(answer) : placeCell(answer);
      if (cell) {
        found = [
          ...found,
          {
            label: forward ? entry.value : `${entry.point.lat}, ${entry.point.lon}`,
            says: forward ? (answer?.display_name ?? '') : cell,
            cell,
            rows: forward ? entry.rows : [entry.row],
          },
        ];
      } else {
        missed = [...missed, forward ? entry.value : `${entry.point.lat}, ${entry.point.lon}`];
      }
      done += 1;
    }
    looking = false;
  }
</script>

<div class="geo">
  <p class="lead">
    {#if forward}
      Every place name in <em>{column.name}</em> is read into the column you choose: from the
      case where the cell points at something it has placed, from the geocoder for the rest.
      Rows that already hold coordinates are left alone.
    {:else}
      Every point in <em>{column.name}</em> is looked up, and the place name lands in the
      column you choose. Rows that already hold one are left alone.
    {/if}
  </p>

  {#if !targets.length}
    <p class="note">This sheet has no other column to write into. Add one first.</p>
  {:else}
    <label class="row">
      <span>Write the {forward ? 'coordinates' : 'place name'} into</span>
      <select class="input" value={targetName} aria-label="Where the answers go"
              onchange={(event) => (targetName = event.currentTarget.value)}>
        {#each targets as entry (entry.name)}<option value={entry.name}>{entry.name}</option>{/each}
      </select>
    </label>

    {#if forward && fromCase.length}
      <p class="note">
        <Icon name="pin" size={11} />
        <strong>{fromCase.length}</strong>
        {fromCase.length === 1 ? 'row is' : 'rows are'} answered by the case itself, from the
        entity the cell points at. No lookup for those.
        {#if linkable.length === MAX_CASE_POINTS}
          Only the first {MAX_CASE_POINTS} linked rows are read; run it again for the rest.
        {/if}
      </p>
    {/if}
    <p class="note">
      <strong>{work.length}</strong>
      {#if forward}
        distinct {work.length === 1 ? 'name' : 'names'} left to look up, over
        {work.reduce((count, entry) => count + entry.rows.length, 0)} rows on screen.
      {:else}
        {work.length === 1 ? 'point' : 'points'} to look up, out of the rows on screen.
      {/if}
      {#if capped}Only the first {MAX_LOOKUPS} are asked for; run it again for the rest.{/if}
    </p>
    {#if work.length}
      <p class="note">
        <Icon name="globe" size={11} />
        Uses OpenStreetMap's geocoder, about one lookup a second, so its servers see what is
        looked for. Nothing is written until you press again.
      </p>
    {/if}

    {#if looking || found.length || missed.length}
      <div class="progress">
        <span>{done} of {batch.length} looked up</span>
        {#if looking}
          <button class="btn btn-sm" onclick={() => (stopped = true)}>Stop</button>
        {/if}
      </div>
      <div class="found">
        {#each found as entry (entry.label)}
          <p class="hit">
            <span class="from" title={entry.label}>{entry.label}</span>
            <Icon name="arrowRight" size={10} />
            <b>{entry.cell}</b>
            <small title={entry.says}>{entry.says}</small>
            <em>{entry.rows.length} {entry.rows.length === 1 ? 'row' : 'rows'}</em>
          </p>
        {/each}
        {#each missed as value (value)}
          <p class="hit bad">
            <span class="from" title={value}>{value}</span>
            <small>nothing came back</small>
          </p>
        {/each}
      </div>
    {/if}
  {/if}

  <div class="modal-row">
    <div class="spacer"></div>
    <button class="btn" onclick={onclose}>Cancel</button>
    <!-- The two halves are two presses, because they cost different things: the case answers
         for nothing, the geocoder for a second a name. A column the case covers entirely
         never offers a lookup at all. -->
    {#if batch.length && targetIndex !== -1}
      <button class="btn" class:btn-primary={!writes.length} disabled={looking} onclick={look}>
        {looking ? 'Looking up' : lookedUp ? 'Look again' : `Look up ${batch.length}`}
      </button>
    {/if}
    {#if writes.length}
      <button class="btn btn-primary" disabled={looking}
              onclick={() => onedits(writes, `${writes.length} ${writes.length === 1 ? 'cell' : 'cells'} written.`)}>
        Write {writes.length} {writes.length === 1 ? 'cell' : 'cells'}
      </button>
    {/if}
  </div>
</div>

<style>
  .geo { display: flex; flex-direction: column; min-height: 0; }
  .lead { color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; }
  .row {
    display: grid; grid-template-columns: minmax(0, 1fr) 190px; align-items: center;
    gap: 8px; padding: 10px 0 4px;
  }
  .row span { color: var(--text-2); font-size: var(--fs-sm); }
  .note {
    display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
    color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; padding: 4px 0;
  }
  .note strong { color: var(--text-1); }
  .progress {
    display: flex; align-items: center; gap: 8px; margin-top: 10px;
    color: var(--text-3); font-size: var(--fs-xs);
  }
  .found {
    max-height: 240px; overflow: auto; margin-top: 6px;
    border: 1px solid var(--border); border-radius: var(--r-sm);
  }
  .hit {
    display: flex; align-items: center; gap: 7px; padding: 4px 7px;
    border-bottom: 1px solid var(--border); font-size: var(--fs-xs);
  }
  .hit:last-child { border-bottom: 0; }
  .hit .from { flex: none; width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); }
  .hit b { flex: none; color: var(--text-1); font-family: var(--font-mono); }
  .hit small { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-3); }
  .hit em { flex: none; color: var(--text-3); font-style: normal; }
  .hit.bad small { color: var(--anno-6); }
  .modal-row { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
  .spacer { flex: 1; }
</style>
