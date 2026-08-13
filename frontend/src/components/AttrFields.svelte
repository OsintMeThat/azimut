<script>
  /**
   * The declared fields of one entity type, rendered from the registry.
   *
   * Generated rather than written per type: the backend says which fields exist,
   * how each reads, how it is edited and what bounds it has, so `vessel` gaining an
   * IMO number is a line in `engine/entities.py` and nothing here.
   *
   * Empty is a value. Every field may be unknown, and clearing one sends `null`
   * rather than `0` or `""` — a blank radius means *we do not know how precise this
   * is*, where `0` would claim infinite precision. Nothing here is required and
   * nothing is flagged for being absent.
   */
  import { entityFields, withHeadings } from '../lib/entityTypes.svelte.js';
  import TemporalInput from './TemporalInput.svelte';

  let { type, values = $bindable({}), exclude = [] } = $props();

  const fields = $derived(entityFields(type));

  /**
   * A shape can only be traced on a map, and no map offers that gesture yet. So an
   * empty footprint shows nothing at all: a label over a hint reads as a control
   * that has stopped working, where absence reads as what it is. It appears the
   * moment a shape exists — set through the API, or by the drawing tool when it
   * lands — carrying the summary and the Clear that drops it.
   */
  const shown = $derived(withHeadings(fields.filter((field) => {
    if (exclude.includes(field.key)) return false;
    if (field.editable === false) return values?.[field.key] != null && values[field.key] !== '';
    return field.kind !== 'geojson' || values?.[field.key];
  })));

  function set(key, raw) {
    // `undefined` would be dropped from the JSON body and read as "leave it be";
    // null is what actually clears a stored field.
    values = { ...values, [key]: raw === '' || raw == null ? null : raw };
  }

  function setNumber(key, raw) {
    const value = Number(raw);
    set(key, raw === '' || !Number.isFinite(value) ? null : value);
  }

  /** A rung is a toggle, not a radio: clicking the chosen one clears the field back
   *  to unknown. Otherwise the only way out of a value picked by mistake would be to
   *  find the metre box and empty it, and "unknown" is a state the analyst is
   *  entitled to return to. */
  function toggle(key, value) {
    set(key, values?.[key] === value ? null : value);
  }

  /** A footprint is traced, never typed. This reports the shape it holds; the map
   *  is the only thing that can make one. */
  function footprintSummary(value) {
    if (!value?.coordinates) return '';
    const count = JSON.stringify(value.coordinates).match(/-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?/g);
    const points = count ? count.length : 0;
    return `${value.type === 'MultiPolygon' ? 'Multi-polygon' : 'Polygon'}, ${points} points`;
  }
</script>

{#if shown.length}
  <div class="attrs">
    {#each shown as field (field.key)}
      {#if field.heads}<div class="attrs-h">{field.heads}</div>{/if}
      <div class="attr">
        {#if field.editable === false}
          <span class="attr-k" title={field.hint}>{field.label}</span>
        {:else}
          <!-- the label says what the field is called, the tooltip what it is for -->
          <label class="attr-k" for={`attr-${field.key}`} title={field.hint}>{field.label}</label>
        {/if}

        {#if field.editable === false}
          <div class="legacy-value">
            <span>{values[field.key]}</span>
            <small>Older field</small>
          </div>
        {:else if field.kind === 'number'}
          {#if field.rungs?.length}
            <div class="rungs">
              {#each field.rungs as rung (rung.value)}
                <button
                  type="button"
                  class="chip"
                  class:on={values?.[field.key] === rung.value}
                  aria-pressed={values?.[field.key] === rung.value}
                  onclick={() => toggle(field.key, rung.value)}
                >{rung.label}</button>
              {/each}
            </div>
          {/if}
          <input
            id={`attr-${field.key}`}
            class="input input-sm"
            type="number"
            min={field.minimum ?? undefined}
            max={field.maximum ?? undefined}
            step={field.whole ? 1 : 'any'}
            value={values?.[field.key] ?? ''}
            placeholder="Unknown"
            oninput={(e) => setNumber(field.key, e.currentTarget.value)}
          />
        {:else if field.kind === 'choice'}
          <!-- A closed scale, so the options are the registry's and never this
               file's. The blank one clears the field: an ungraded source is the
               normal case, and "we have not judged it" is a state to return to. -->
          <select
            id={`attr-${field.key}`}
            class="select input-sm"
            value={values?.[field.key] ?? ''}
            onchange={(e) => set(field.key, e.currentTarget.value)}
          >
            <option value="">Unknown</option>
            {#each field.options ?? [] as option (option.value)}
              <option value={option.value}>
                {option.value.length <= 2 ? `${option.value} · ${option.label}` : option.label}
              </option>
            {/each}
          </select>
        {:else if field.kind === 'temporal'}
          <div class="temporal-field">
            <TemporalInput
              id={`attr-${field.key}`}
              value={values?.[field.key] ?? ''}
              onchange={(value) => set(field.key, value)}
            />
          </div>
        {:else if field.kind === 'longtext'}
          <!-- A quoted source and the reasoning behind a claim run to paragraphs.
               Held in a one-line box they scroll sideways past eighty characters,
               which is a field nobody fills in. -->
          <textarea
            id={`attr-${field.key}`}
            class="textarea input-sm"
            rows="3"
            value={values?.[field.key] ?? ''}
            placeholder="Unknown"
            oninput={(e) => set(field.key, e.currentTarget.value)}
          ></textarea>
        {:else if field.kind === 'geojson'}
          <div class="geo-row">
            <span class="mono">{footprintSummary(values[field.key])}</span>
            <button type="button" class="chip clear" onclick={() => set(field.key, null)}>
              Clear
            </button>
          </div>
        {:else}
          <input
            id={`attr-${field.key}`}
            class="input input-sm"
            type={field.kind === 'url' ? 'url' : 'text'}
            value={values?.[field.key] ?? ''}
            placeholder="Unknown"
            oninput={(e) => set(field.key, e.currentTarget.value)}
          />
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  /* One block, so four optional fields read as a subject rather than as a form
     someone left half-finished in the middle of the panel. */
  .attrs {
    margin: 10px 0 2px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px 12px;
  }
  .attrs-h {
    grid-column: 1 / -1;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-2);
    margin-bottom: 6px;
  }
  /* A second heading opens a block under one already filled, so it needs the air
     the first one gets from the block above it. */
  .attrs-h:not(:first-child) {
    margin-top: 8px;
  }
  .attr-k {
    display: block;
    font-size: var(--fs-xs);
    color: var(--text-3);
    margin-bottom: 3px;
  }
  .input-sm {
    width: 100%;
    padding: 4px 7px;
    font-size: var(--fs-xs);
  }
  /* A long field takes the whole row: two paragraph boxes side by side in a 180px
     column would be narrower than the one-line input they replace. */
  .attr:has(.textarea) {
    grid-column: 1 / -1;
  }
  .attr:has(.temporal-field) {
    grid-column: 1 / -1;
  }
  .textarea {
    resize: vertical;
    line-height: 1.5;
  }
  .rungs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 5px;
  }
  /* `.chip` is per-component in this codebase, never global — the rungs rendered
     as bare text until this block existed. */
  .chip {
    padding: 3px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
    white-space: nowrap;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }
  .chip:hover {
    color: var(--text-1);
    border-color: var(--border-strong);
  }
  .chip.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .chip.clear {
    color: var(--danger);
  }
  .geo-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .legacy-value {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 30px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
  }
  .legacy-value small {
    color: var(--text-3);
    font-size: 10px;
  }
</style>
