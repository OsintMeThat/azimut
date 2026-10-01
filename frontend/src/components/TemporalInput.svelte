<script>
  import {
    TEMPORAL_FORMATS,
    TEMPORAL_MARKERS,
    TEMPORAL_SYNTAX,
    readTemporalInput,
    writeTemporalInput,
  } from '../lib/temporalInput.js';
  import { formatTemporalValue } from '../lib/timeline.js';
  import { zonesOf } from '../lib/localZone.js';
  import { UTC, clockOf } from '../lib/clock.js';
  import { axisZone, learnAxisZone } from '../lib/caseAxis.svelte.js';
  import { caseState } from '../lib/state.svelte.js';
  import ClockField from './ClockField.svelte';

  let {
    id,
    value = '',
    /** Where the claim happened, for a date read on the clock there (D33). */
    places = [],
    /** The zone the value was stated in (`when_zone`), and where a change to it goes.
     *  Without the callback a date has no clock row, as a bare field: a time still
     *  has one, since its clock is written into the value. */
    zone = null,
    onzonechange = null,
    onchange,
    onvaliditychange,
  } = $props();
  let state = $state(readTemporalInput(''));
  let sent = $state('');
  // Whether the analyst picked a clock, whether they typed here, and whether the editor
  // opened empty. The places' clock, else the case's, is the default only for a value typed
  // into an empty editor: a stored value keeps its clock, and is never rewritten
  // because the editor was opened or edited.
  let chosen = $state(false);
  let typed = $state(false);
  let fresh = $state(true);
  let zones = $state({ zones: [], only: null });
  const DATE_SHAPED = /^\d{4}(-\d{2}(-\d{2})?)?[~?%]?(\/\d{4}(-\d{2}(-\d{2})?)?[~?%]?)?$/;

  $effect(() => {
    const held = places.map((entry) => ({ type: entry.type, label: entry.label, attrs: entry.attrs }));
    let live = true;
    zonesOf(held).then((found) => { if (live) zones = found; });
    return () => { live = false; };
  });

  const rawValue = $derived(writeTemporalInput(state));
  const timedMode = $derived(state.mode === 'timestamp' || state.mode === 'time-range');
  /** A time's clock is written into the value; a date's is the zone kept beside it. */
  const clock = $derived(
    timedMode
      ? { zone: state.zone || null, fixed: state.zone ? '' : state.offset }
      : { zone: zone || UTC, fixed: '' },
  );
  const showClock = $derived(timedMode || Boolean(onzonechange && DATE_SHAPED.test(rawValue)));
  const reading = $derived(
    formatTemporalValue(rawValue, timedMode ? (state.zone && state.zone !== UTC ? state.zone : null) : zone),
  );

  /** Put the value on a clock: a zone name, `UTC`, or null for none known. */
  function setClock(next) {
    if (timedMode) emit({ zone: next ?? '', offset: '' });
    onzonechange?.(next && next !== UTC ? next : null);
  }

  // A value typed into an empty editor reads on the places' clock, else on the clock
  // the case's axis reads on, and follows them while the analyst has not picked one.
  $effect(() => { learnAxisZone(caseState.current?.id); });
  $effect(() => {
    if (!fresh || chosen || !typed) return;
    const fallback = zones.only?.zone ?? axisZone(caseState.current?.id);
    if (timedMode) {
      if (rawValue && state.zone !== fallback) setClock(fallback);
    } else if (onzonechange && DATE_SHAPED.test(rawValue)) {
      const want = fallback === UTC ? null : fallback;
      if ((zone || null) !== want) onzonechange(want);
    }
  });

  $effect(() => {
    const incoming = value ?? '';
    if (incoming !== sent) {
      state = readTemporalInput(incoming);
      if (incoming) fresh = false;
      // A time stated with its zone opens on that zone, not on the bare offset it was
      // written with. Nothing is written until the analyst edits it.
      if (state.mode === 'timestamp' || state.mode === 'time-range') {
        const read = clockOf(incoming, zone);
        state = { ...state, zone: read.zone ?? '', offset: read.zone ? '' : read.fixed };
      }
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
    // The clock goes with the value: a day read in Kyiv becomes a time read in Kyiv.
    const carried = state.zone || zone || UTC;
    state = readTemporalInput('');
    emit({ mode, zone: carried });
  }

  function choosePrecision(precision) {
    emit({ precision, date: '' });
  }
</script>

<div class="temporal-editor">
  <div class="format-line">
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
    <small class="format-hint">
      {TEMPORAL_FORMATS.find((format) => format.value === state.mode)?.hint}{#if !rawValue}. Left empty, the claim waits in Undated{/if}
    </small>
  </div>

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
          oninput={(event) => { typed = true; emit({ date: event.currentTarget.value }); }}
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
          oninput={(event) => { typed = true; emit({ datetime: event.currentTarget.value }); }}
        />
      </label>
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
          oninput={(event) => { typed = true; emit({ start: event.currentTarget.value }); }}
        />
      </label>
      <label class="field">
        <span>End</span>
        <input
          class="input input-sm mono"
          aria-label="End date"
          type="date"
          value={state.end}
          oninput={(event) => { typed = true; emit({ end: event.currentTarget.value }); }}
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
          oninput={(event) => { typed = true; emit({ startTime: event.currentTarget.value }); }}
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
          oninput={(event) => { typed = true; emit({ endTime: event.currentTarget.value }); }}
        />
      </label>
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
          <p>A time without a clock stays off the UTC axis.</p>
          <p>Open ranges and other EDTF Level 2 forms are not supported.</p>
        </section>
      </details>
    </div>
  {/if}

  <!-- Which clock the value is read on, one control whatever its shape: a day spans
       that zone's day, and a time is that zone's local time. -->
  {#if showClock}
    <div class="field clock-field">
      <span>Clock</span>
      <ClockField
        value={rawValue}
        {clock}
        here={zones.zones}
        timed={state.mode === 'timestamp'}
        onpick={(next) => { chosen = true; setClock(next); }}
      />
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
  .field > span { color: var(--text-3); font-size: var(--fs-xs); }
  /* The size this editor's controls always meant to be. `input-sm` was written
     on every one of them, but it is defined in the callers' scoped styles, which
     Svelte does not let through to a child component — so the class did nothing
     and the controls rendered a step larger than the fields beside them. */
  .input-sm { padding: 4px 7px; font-size: var(--fs-xs); }
  .parts { display: grid; align-items: end; gap: 6px; }
  .date-parts { grid-template-columns: auto minmax(150px, 1fr) minmax(170px, .8fr); }
  .timestamp-parts { grid-template-columns: minmax(190px, 1fr); }
  .range-parts { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
  .time-range-parts { grid-template-columns: repeat(2, minmax(180px, 1fr)); }
  .format-line { display: flex; align-items: end; gap: 10px; min-width: 0; }
  .format-hint { padding-bottom: 5px; color: var(--text-3); font-size: var(--fs-xs); }
  .format-field { justify-self: start; }
  .clock-field { justify-self: start; }
  .format, .precision { width: max-content; max-width: 100%; }
  .date-value, .datetime-value, .certainty, .advanced { width: 100%; }
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
    .format, .precision { width: 100%; }
  }
</style>
