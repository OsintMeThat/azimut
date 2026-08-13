<script>
  import {
    TEMPORAL_FORMATS,
    TEMPORAL_MARKERS,
    TEMPORAL_SYNTAX,
    readTemporalInput,
    writeTemporalInput,
  } from '../lib/temporalInput.js';
  import { formatTemporalValue } from '../lib/timeline.js';

  let { id, value = '', onchange, onvaliditychange } = $props();
  let state = $state(readTemporalInput(''));
  let sent = $state('');
  const rawValue = $derived(writeTemporalInput(state));
  const reading = $derived(formatTemporalValue(rawValue));

  $effect(() => {
    const incoming = value ?? '';
    if (incoming !== sent) {
      state = readTemporalInput(incoming);
      sent = incoming;
      onvaliditychange?.(formatTemporalValue(incoming));
    }
  });

  function emit(patch) {
    state = { ...state, ...patch };
    sent = writeTemporalInput(state);
    onchange?.(sent);
    onvaliditychange?.(formatTemporalValue(sent));
  }

  function chooseMode(mode) {
    if (mode === state.mode) return;
    if (mode === 'advanced') {
      emit({ mode, raw: writeTemporalInput(state) });
      return;
    }
    state = readTemporalInput('');
    emit({ mode });
  }

  function choosePrecision(precision) {
    emit({ precision, date: '' });
  }
</script>

<div class="temporal-editor">
  <label class="field format-field">
    <span>Format</span>
    <select
      class="select input-sm format"
      aria-label="Date format"
      value={state.mode}
      onchange={(event) => chooseMode(event.currentTarget.value)}
    >
      {#each TEMPORAL_FORMATS as format (format.value)}
        <option value={format.value}>{format.label}</option>
      {/each}
    </select>
  </label>

  {#if state.mode === 'date'}
    <div class="parts date-parts">
      <label class="field precision-field">
        <span>Precision</span>
        <select
          class="select input-sm precision"
          aria-label="Date precision"
          value={state.precision}
          onchange={(event) => choosePrecision(event.currentTarget.value)}
        >
          <option value="day">Day</option>
          <option value="month">Month</option>
          <option value="year">Year</option>
        </select>
      </label>
      <label class="field date-field">
        <span>Date</span>
        <input
          {id}
          class="input input-sm mono date-value"
          type={state.precision === 'day' ? 'date' : state.precision === 'month' ? 'month' : 'number'}
          min={state.precision === 'year' ? 1 : undefined}
          max={state.precision === 'year' ? 9998 : undefined}
          placeholder={state.precision === 'year' ? 'YYYY' : 'Unknown'}
          value={state.date}
          oninput={(event) => emit({ date: event.currentTarget.value })}
        />
      </label>
      <label class="field certainty-field">
        <span>Certainty</span>
        <select
          class="select input-sm certainty"
          aria-label="Date certainty"
          value={state.certainty}
          onchange={(event) => emit({ certainty: event.currentTarget.value })}
        >
          <option value="">Exact as stated</option>
          <option value="~">Approximate</option>
          <option value="?">Uncertain</option>
          <option value="%">Approximate and uncertain</option>
        </select>
      </label>
    </div>
  {:else if state.mode === 'timestamp'}
    <div class="parts timestamp-parts">
      <label class="field datetime-field">
        <span>Date and time</span>
        <input
          {id}
          class="input input-sm mono datetime-value"
          type="datetime-local"
          step="any"
          value={state.datetime}
          oninput={(event) => emit({ datetime: event.currentTarget.value })}
        />
      </label>
      <label class="field zone-field">
        <span>Timezone</span>
        <select
          class="select input-sm zone"
          aria-label="Timezone"
          value={state.zone}
          onchange={(event) => emit({ zone: event.currentTarget.value })}
        >
          <option value="local">Unknown</option>
          <option value="utc">UTC</option>
          <option value="offset">UTC offset</option>
        </select>
      </label>
      {#if state.zone === 'offset'}
        <label class="field offset-field">
          <span>Offset</span>
          <input
            class="input input-sm mono offset"
            aria-label="UTC offset"
            type="text"
            value={state.offset}
            placeholder="+02:00"
            autocomplete="off"
            spellcheck="false"
            oninput={(event) => emit({ offset: event.currentTarget.value })}
          />
        </label>
      {/if}
    </div>
  {:else if state.mode === 'range'}
    <div class="parts range-parts">
      <label class="field">
        <span>Start</span>
        <input
          {id}
          class="input input-sm mono"
          aria-label="Start date"
          type="date"
          value={state.start}
          oninput={(event) => emit({ start: event.currentTarget.value })}
        />
      </label>
      <label class="field">
        <span>End</span>
        <input
          class="input input-sm mono"
          aria-label="End date"
          type="date"
          value={state.end}
          oninput={(event) => emit({ end: event.currentTarget.value })}
        />
      </label>
    </div>
  {:else if state.mode === 'time-range'}
    <div class="parts time-range-parts">
      <label class="field">
        <span>Start</span>
        <input
          {id}
          class="input input-sm mono"
          aria-label="Start time"
          type="datetime-local"
          step="any"
          value={state.startTime}
          oninput={(event) => emit({ startTime: event.currentTarget.value })}
        />
      </label>
      <label class="field">
        <span>End</span>
        <input
          class="input input-sm mono"
          aria-label="End time"
          type="datetime-local"
          step="any"
          value={state.endTime}
          oninput={(event) => emit({ endTime: event.currentTarget.value })}
        />
      </label>
      <label class="field zone-field">
        <span>Timezone</span>
        <select class="select input-sm zone" aria-label="Range timezone" value={state.rangeZone} onchange={(event) => emit({ rangeZone: event.currentTarget.value })}>
          <option value="utc">UTC</option>
          <option value="offset">UTC offset</option>
        </select>
      </label>
      {#if state.rangeZone === 'offset'}
        <label class="field offset-field">
          <span>Offset</span>
          <input class="input input-sm mono offset" aria-label="Range UTC offset" type="text" value={state.rangeOffset} placeholder="+02:00" autocomplete="off" spellcheck="false" oninput={(event) => emit({ rangeOffset: event.currentTarget.value })} />
        </label>
      {/if}
    </div>
  {:else}
    <div class="advanced-editor">
      <label class="field">
        <span>Stored value</span>
        <input
          {id}
          class="input input-sm mono advanced"
          type="text"
          value={state.raw}
          placeholder="2026-08~, 2026-08/2026-10"
          autocomplete="off"
          spellcheck="false"
          aria-describedby={`${id}-advanced-guide`}
          aria-invalid={!reading.valid}
          oninput={(event) => emit({ raw: event.currentTarget.value })}
        />
      </label>

      <details class="syntax-help">
        <summary>Syntax guide</summary>
        <section class="advanced-guide" id={`${id}-advanced-guide`} aria-label="Supported date syntax">
          <header>
            <h4>Supported syntax</h4>
            <p>Dates use Azimut's EDTF profile. Times use ISO 8601.</p>
          </header>

          <div class="format-table" role="table" aria-label="Supported temporal formats">
            <div class="format-row format-head" role="row">
              <span role="columnheader">Meaning</span>
              <span role="columnheader">Pattern</span>
              <span role="columnheader">Example</span>
            </div>
            {#each TEMPORAL_SYNTAX as format (format.meaning)}
              <div class="format-row" role="row">
                <span role="cell">{format.meaning}</span>
                <span role="cell"><code>{format.pattern}</code></span>
                <span role="cell"><code>{format.example}</code></span>
              </div>
            {/each}
          </div>

          <div class="markers" aria-label="Date markers">
            {#each TEMPORAL_MARKERS as marker (marker.value)}
              <span><code>{marker.value}</code> {marker.meaning}</span>
            {/each}
          </div>

          <ul class="syntax-rules">
            <li>Markers follow a year, month or day.</li>
            <li>Times include seconds.</li>
            <li>Ranges contain two dates or two zoned times.</li>
            <li>UTC offsets run from −14:00 to +14:00.</li>
          </ul>
          <p>A time without a timezone stays outside the UTC timeline.</p>
          <p>Open ranges and other EDTF Level 2 forms are not supported.</p>
        </section>
      </details>
    </div>
  {/if}

  {#if rawValue}
    <div class="temporal-preview" class:error={!reading.valid} aria-live="polite">
      <span>{reading.valid ? reading.label : reading.error}</span>
      {#if reading.valid && reading.qualifiers.length}<small>{reading.qualifiers.join(' · ')}</small>{/if}
      {#if reading.valid && reading.label !== rawValue}<code>{rawValue}</code>{/if}
    </div>
  {/if}
</div>

<style>
  .temporal-editor { display: grid; gap: 7px; }
  .field { min-width: 0; display: grid; gap: 3px; }
  .field > span { color: var(--text-3); font-size: 10px; }
  .parts { display: grid; align-items: end; gap: 6px; }
  .date-parts { grid-template-columns: auto minmax(150px, 1fr) minmax(170px, .8fr); }
  .timestamp-parts { grid-template-columns: minmax(190px, 1fr) auto auto; }
  .range-parts { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
  .time-range-parts { grid-template-columns: repeat(2, minmax(180px, 1fr)) auto auto; }
  .format-field { justify-self: start; }
  .format, .precision, .zone { width: max-content; max-width: 100%; }
  .date-value, .datetime-value, .certainty, .advanced { width: 100%; }
  .offset { width: 90px; }
  .advanced-editor { position: relative; display: grid; gap: 5px; }
  .syntax-help { justify-self: start; }
  .syntax-help > summary { color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
  .advanced-guide {
    position: absolute; z-index: 40; top: calc(100% + 5px); left: 0;
    width: min(610px, calc(100vw - 64px)); max-height: min(360px, 55vh); overflow: auto;
    padding: 11px; border: 1px solid var(--border-strong); border-radius: var(--r-md);
    background: var(--bg-1); box-shadow: var(--shadow-2); color: var(--text-3); font-size: var(--fs-xs);
  }
  .advanced-guide header { position: sticky; top: -11px; z-index: 1; margin: -11px -11px 0; padding: 11px; background: var(--bg-1); }
  .advanced-guide h4, .advanced-guide p { margin: 0; }
  .advanced-guide h4 { color: var(--text-2); font-size: var(--fs-xs); }
  .advanced-guide header p { margin-top: 3px; }
  .format-table { margin-top: 8px; border-top: 1px solid var(--border); }
  .format-row {
    display: grid; grid-template-columns: minmax(90px, .7fr) minmax(120px, 1fr) minmax(170px, 1.35fr);
    gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--border); align-items: baseline;
  }
  .format-head { color: var(--text-2); font-weight: 600; }
  .markers { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; }
  .syntax-rules { margin: 7px 0; padding-left: 18px; line-height: 1.5; }
  .advanced-guide > p + p { margin-top: 4px; }
  .temporal-preview {
    min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 5px 9px;
    padding: 7px 9px; border-left: 2px solid var(--timeline-statement); background: var(--bg-2);
    color: var(--text-2); font-size: var(--fs-xs);
  }
  .temporal-preview small { color: var(--text-3); }
  .temporal-preview code { margin-left: auto; color: var(--text-3); overflow-wrap: anywhere; }
  .temporal-preview.error { border-left-color: var(--danger); color: var(--danger); }
  @media (max-width: 620px) {
    .date-parts, .timestamp-parts, .range-parts, .time-range-parts { grid-template-columns: 1fr; }
    .format-field { justify-self: stretch; }
    .format, .precision, .zone, .offset { width: 100%; }
  }
</style>
