<script>
  /**
   * Adding a batch of rows to the sheet that is already open.
   *
   * Import filed a **new sheet**, always — right the first time and wrong every time after
   * it. The daily batch of links, the second export out of the same tool, the forty rows a
   * colleague sent: all of them belong in the worklist that already carries the statuses,
   * the roles and the colours, and the only ways in were to paste into a selection whose
   * columns happened to line up, or to keep twelve sheets nobody compares.
   *
   * Two answers here and nothing else. **Which columns land where**, proposed by name and
   * then the analyst's; and **what would be dropped**, said before the press, because "40
   * rows added" over three silently discarded columns is the kind of import somebody finds
   * out about a week later.
   *
   * The CSV is parsed by the server (`POST /sheets/parse`) like every other CSV in this app.
   * The append itself is an ordinary structural edit, so it undoes like anything else.
   */
  import Icon from './Icon.svelte';
  import { api } from '../lib/api.js';
  import { ID_COLUMN } from '../lib/sheet.js';
  import { guessMapping, mappingSummary } from '../lib/sheetAppend.js';

  let { caseId, table, onappend, onclose } = $props();

  let text = $state('');
  let incoming = $state(null); // { columns, rows }
  let mapping = $state({});
  let reading = $state(false);
  let failed = $state('');

  const columns = $derived(
    (table?.columns ?? []).filter((name) => String(name).toLowerCase() !== ID_COLUMN),
  );
  const summary = $derived(incoming ? mappingSummary(incoming.columns, mapping) : null);
  const ready = $derived(Boolean(incoming?.rows?.length && summary?.taken));

  async function read() {
    if (!text.trim() || reading) return;
    reading = true;
    failed = '';
    try {
      const answer = await api.post(`/api/cases/${caseId}/sheets/parse`, { text });
      incoming = answer;
      mapping = guessMapping(answer.columns, table?.columns ?? []);
    } catch (error) {
      failed = error?.message || 'That table could not be read.';
      incoming = null;
    } finally {
      reading = false;
    }
  }

  function pick(name, onto) {
    mapping = { ...mapping, [name]: onto };
  }

  function pickFile(files) {
    const file = files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      text = String(reader.result ?? '');
      read();
    };
    reader.readAsText(file);
  }
</script>

<div class="append">
  {#if !incoming}
    <p class="lead">
      Paste the rows, or pick a file. The delimiter is guessed, and every row is keyed here.
    </p>
    <textarea class="input paste-box" rows="8" bind:value={text} aria-label="The rows to add"
              placeholder="id,url,city&#10;…"></textarea>
    {#if failed}<p class="failed" role="alert">{failed}</p>{/if}
    <div class="modal-row">
      <label class="btn btn-sm">
        <Icon name="upload" size={13} /> Pick a file
        <input type="file" accept=".csv,.tsv,text/csv,text/plain" hidden
               onchange={(event) => { pickFile(event.currentTarget.files); event.currentTarget.value = ''; }} />
      </label>
      <div class="spacer"></div>
      <button class="btn" onclick={onclose}>Cancel</button>
      <button class="btn btn-primary" disabled={!text.trim() || reading} onclick={read}>
        {reading ? 'Reading' : 'Read it'}
      </button>
    </div>
  {:else}
    <p class="lead">
      <strong>{incoming.rows.length}</strong> {incoming.rows.length === 1 ? 'row' : 'rows'},
      {incoming.columns.length} {incoming.columns.length === 1 ? 'column' : 'columns'}. Say
      where each one lands.
    </p>
    <div class="pairs">
      {#each incoming.columns as name (name)}
        {#if String(name).toLowerCase() !== ID_COLUMN}
          <label class="pair">
            <span class="from" title={name}>{name}</span>
            <Icon name="arrowRight" size={11} />
            <select class="input" value={mapping[name] ?? ''} aria-label="Where {name} lands"
                    onchange={(event) => pick(name, event.currentTarget.value)}>
              <option value="">— leave it out</option>
              {#each columns as onto (onto)}<option value={onto}>{onto}</option>{/each}
            </select>
          </label>
        {/if}
      {/each}
    </div>
    {#if summary.dropped.length}
      <p class="note">
        Left out: {summary.dropped.join(', ')}. Add a column to this sheet first to keep them.
      </p>
    {/if}
    {#if failed}<p class="failed" role="alert">{failed}</p>{/if}
    <div class="modal-row">
      <button class="btn btn-sm" onclick={() => { incoming = null; failed = ''; }}>Back</button>
      <div class="spacer"></div>
      <button class="btn" onclick={onclose}>Cancel</button>
      <button class="btn btn-primary" disabled={!ready}
              onclick={() => onappend(incoming, mapping)}>
        Add {incoming.rows.length} {incoming.rows.length === 1 ? 'row' : 'rows'}
      </button>
    </div>
  {/if}
</div>

<style>
  .append { display: flex; flex-direction: column; min-height: 0; }
  .lead { color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; }
  .lead strong { color: var(--text-1); }
  .paste-box { width: 100%; margin-top: 10px; font-family: var(--font-mono); resize: vertical; }
  .pairs { max-height: 320px; overflow: auto; margin-top: 12px; }
  .pair {
    display: grid; grid-template-columns: minmax(0, 1fr) auto 190px; align-items: center;
    gap: 8px; padding: 3px 0;
  }
  .from {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--text-1); font-size: var(--fs-sm);
  }
  .note { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; padding: 4px 0; }
  .failed { color: var(--danger); font-size: var(--fs-sm); margin-top: 10px; }
  .modal-row { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
  .spacer { flex: 1; }
</style>
