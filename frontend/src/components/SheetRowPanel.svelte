<script>
  /**
   * One row of a sheet, read down instead of across.
   *
   * The field binders this tool replaces run to fourteen columns and more — a type, a
   * local time, an estimated local time, an upload time, an hour note, a code, a
   * city, coordinates, two links, two synchro offsets — and a grid thirty pixels tall
   * cannot show one row of that. Scrolling sideways to read one case loses the case.
   *
   * So the same row, one field per line, every cell editable, and the links live. It
   * is a second view of the table and not a second store: every change goes back
   * through the same cell edit the grid uses.
   */
  import Icon from './Icon.svelte';
  import { ID_COLUMN, linkLabel, urlsIn } from '../lib/sheet.js';

  let { table, rowIndex, linkOf, onedit, onlink, onopenentity, onstep, onclose } = $props();

  const row = $derived(table.rows[rowIndex] ?? []);
  const fields = $derived(
    (table.columns ?? []).map((name, index) => ({
      name,
      index,
      value: row[index] ?? '',
      isKey: String(name).toLowerCase() === ID_COLUMN,
    })),
  );
  const filled = $derived(fields.filter((field) => !field.isKey && String(field.value).trim()).length);
  const total = $derived(fields.length - 1);
</script>

<aside class="panel" aria-label="This row, field by field">
  <header>
    <button class="btn btn-ghost btn-sm" title="The row above" onclick={() => onstep(-1)}>
      <Icon name="chevronUp" size={13} />
    </button>
    <button class="btn btn-ghost btn-sm" title="The row below" onclick={() => onstep(1)}>
      <Icon name="chevronDown" size={13} />
    </button>
    <span class="progress">{filled} of {total} filled</span>
    <div class="spacer"></div>
    <button class="btn btn-ghost btn-sm" title="Close" aria-label="Close this row" onclick={onclose}>
      <Icon name="x" size={14} />
    </button>
  </header>

  <div class="fields">
    {#each fields as field (field.name)}
      {@const linked = linkOf(rowIndex, field.name)}
      {@const links = urlsIn(field.value)}
      <div class="field" class:key={field.isKey}>
        <div class="label">
          <span>{field.name}</span>
          {#if linked}
            <button class="mark" title="Open this entity" onclick={() => onopenentity(linked)}>
              <Icon name="link" size={11} />
            </button>
          {/if}
          {#if !field.isKey}
            <button class="mark at" title="Point this cell at an entity"
                    aria-label="Point {field.name} at an entity"
                    onclick={() => onlink(rowIndex, field.index)}>@</button>
          {/if}
        </div>
        {#if field.isKey}
          <p class="handle">{field.value}</p>
        {:else}
          <textarea class="input" rows={String(field.value).includes('\n') ? 3 : 1}
                    aria-label={field.name} value={field.value}
                    onchange={(event) => onedit(rowIndex, field.index, event.currentTarget.value)}
          ></textarea>
          {#if links.length}
            <p class="links">
              {#each links as url (url)}
                <a href={url} target="_blank" rel="noreferrer noopener">
                  <Icon name="external" size={11} /> {linkLabel(url)}
                </a>
              {/each}
            </p>
          {/if}
        {/if}
      </div>
    {/each}
  </div>
</aside>

<style>
  .panel {
    width: 340px; flex: none; display: flex; flex-direction: column; min-height: 0;
    border-left: 1px solid var(--border); background: var(--bg-1);
  }
  header {
    display: flex; align-items: center; gap: 4px; padding: 5px 8px;
    border-bottom: 1px solid var(--border);
  }
  .spacer { flex: 1; }
  .progress { color: var(--text-3); font-size: var(--fs-xs); }
  .fields { flex: 1; min-height: 0; overflow: auto; padding: 4px 10px 14px; }
  .field { padding: 7px 0; border-bottom: 1px solid var(--border); }
  .field:last-child { border-bottom: 0; }
  .label { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
  .label span {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--text-3); font-size: var(--fs-xs);
  }
  .mark { display: flex; color: var(--accent); }
  .mark.at { color: var(--text-3); font-family: var(--font-mono); font-weight: 600; }
  .mark.at:hover { color: var(--accent); }
  .field.key .handle {
    color: var(--text-3); font-family: var(--font-mono); font-size: var(--fs-xs);
  }
  .field textarea { width: 100%; resize: vertical; line-height: 1.45; }
  .links { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 4px; }
  .links a {
    display: inline-flex; align-items: center; gap: 4px;
    color: var(--accent); font-size: var(--fs-xs);
  }
</style>
