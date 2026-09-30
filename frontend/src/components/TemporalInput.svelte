<script>
  import {
    TEMPORAL_FORMATS,
    TEMPORAL_MARKERS,
    TEMPORAL_SYNTAX,
    readTemporalInput,
    writeTemporalInput,
  } from '../lib/temporalInput.js';
  import { formatTemporalValue } from '../lib/timeline.js';
  import { zoneReading, zonesOf } from '../lib/localZone.js';

  let {
    id,
    value = '',
    /** Where the claim happened, for a time typed as the local time there (D33). */
    places = [],
    /** The zone the value was stated in (`when_zone`), and where a change to it goes.
     *  Without the callback the editor has no zone row, as a bare field. */
    dayZone = null,
    ondayzonechange = null,
    onchange,
    onvaliditychange,
  } = $props();
  let state = $state(readTemporalInput(''));
  let sent = $state('');
  // Whether the analyst picked a zone, and whether they typed the time here. A place's
  // clock is the default only for a time typed in this editor while the zone is still
  // Unknown: a stored time is never rewritten because the editor was opened.
  let chosen = $state(false);
  let typed = $state(false);
  let dayChosen = $state(false);
  let zones = $state({ zones: [], only: null });
  // The places' zones, and the stated one when no place gives it: a Claim a proof
  // dated carries its point's zone without being tied to a place entity.
  const zoneChoices = $derived(
    dayZone && !zones.zones.some((entry) => entry.zone === dayZone)
      ? [...zones.zones, { zone: dayZone, place: '' }]
      : zones.zones,
  );
  const DATE_SHAPED = /^\d{4}(-\d{2}(-\d{2})?)?[~?%]?(\/\d{4}(-\d{2}(-\d{2})?)?[~?%]?)?$/;

  $effect(() => {
    const held = places.map((entry) => ({ type: entry.type, label: entry.label, attrs: entry.attrs }));
    let live = true;
    zonesOf(held).then((found) => { if (live) zones = found; });
    return () => { live = false; };
  });

  // A day typed here for a Claim tied to one zone is that place's day, the same
  // default a typed time gets below; a stored day is never re-read by opening it.
  $effect(() => {
    const only = zones.only;
    if (!ondayzonechange || !only || dayChosen || !typed || !DATE_SHAPED.test(rawValue)) return;
    if (dayZone !== only.zone) ondayzonechange(only.zone);
  });

  $effect(() => {
    const only = zones.only;
    if (!only || chosen || !typed || state.mode !== 'timestamp' || !state.datetime) return;
    if (state.zone === 'local' || (state.zone === 'place' && state.placeZone !== only.zone)) {
      emit({ zone: 'place', placeZone: only.zone });
    }
  });
  // A place taken off the claim takes its clock with it, unless it was chosen.
  $effect(() => {
    if (state.zone === 'place' && !chosen && !zoneChoices.some((entry) => entry.zone === state.placeZone)) {
      emit({ zone: 'local', placeZone: '' });
    }
  });
  const placeName = $derived(zoneChoices.find((entry) => entry.zone === state.placeZone)?.place ?? '');
  const rawValue = $derived(writeTemporalInput(state));
  const reading = $derived(
    formatTemporalValue(rawValue, DATE_SHAPED.test(rawValue) || state.zone === 'place' ? dayZone : null),
  );

  $effect(() => {
    const incoming = value ?? '';
    if (incoming !== sent) {
      state = readTemporalInput(incoming);
      // A local time stated in a zone opens on that zone's clock rather than as
      // Unknown. Nothing is written until the analyst edits it.
      if (state.mode === 'timestamp' && state.zone === 'local' && dayZone) {
        state = { ...state, zone: 'place', placeZone: dayZone };
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
    state = readTemporalInput('');
    emit({ mode });
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
      <label class="field zone-field">
        <span>Timezone</span>
        <select
          class="select input-sm zone"
          aria-label="Timezone"
          value={state.zone === 'place' ? `place:${state.placeZone}` : state.zone}
          onchange={(event) => {
            const picked = event.currentTarget.value;
            chosen = true;
            if (picked.startsWith('place:')) emit({ zone: 'place', placeZone: picked.slice(6) });
            else emit({ zone: picked, placeZone: '' });
          }}
        >
          <option value="local">Unknown</option>
          <option value="utc">UTC</option>
          <option value="offset">UTC offset</option>
          {#each zoneChoices as entry (entry.zone)}
            <option value={`place:${entry.zone}`}>{entry.place ? `Local at ${entry.place}` : `Local, ${entry.zone}`}</option>
          {/each}
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

  <!-- Which day a date is: a day has no hour to carry an offset, so the zone is
       stated beside it. Unstated, it spans UTC's day, and the row says so. -->
  {#if ondayzonechange && DATE_SHAPED.test(rawValue)}
    <label class="field day-zone-field">
      <span>Day in</span>
      <select
        class="select input-sm zone day-zone"
        aria-label="Day in"
        value={dayZone ?? ''}
        onchange={(event) => { dayChosen = true; ondayzonechange(event.currentTarget.value || null); }}
      >
        <option value="">UTC (not stated)</option>
        {#each zoneChoices as entry (entry.zone)}
          <option value={entry.zone}>{entry.place ? `Local at ${entry.place} (${entry.zone})` : entry.zone}</option>
        {/each}
      </select>
    </label>
  {/if}
  {#if rawValue}
    <div class="temporal-preview" class:error={!reading.valid} aria-live="polite">
      <span>{reading.valid ? reading.label : reading.error}</span>
      {#if reading.valid && reading.qualifiers.length}<small>{reading.qualifiers.join(' · ')}</small>{/if}
      {#if reading.valid && reading.label !== rawValue}<code>{rawValue}</code>{/if}
    </div>
    {#if state.mode === 'timestamp' && state.zone === 'place' && placeName}
      <p class="zone-rule">{zoneReading(state.datetime.length === 16 ? `${state.datetime}:00` : state.datetime, state.placeZone, placeName)}</p>
    {/if}
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
  .timestamp-parts { grid-template-columns: minmax(190px, 1fr) auto auto; }
  .range-parts { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
  .time-range-parts { grid-template-columns: repeat(2, minmax(180px, 1fr)) auto auto; }
  .format-line { display: flex; align-items: end; gap: 10px; min-width: 0; }
  .format-hint { padding-bottom: 5px; color: var(--text-3); font-size: var(--fs-xs); }
  .format-field { justify-self: start; }
  .day-zone-field { justify-self: start; }
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
  .zone-rule { margin: 0; color: var(--text-3); font-size: var(--fs-xs); }
  .temporal-preview code { margin-left: auto; color: var(--text-3); overflow-wrap: anywhere; }
  .temporal-preview.error { border-left-color: var(--danger); color: var(--danger); }
  @media (max-width: 620px) {
    .date-parts, .timestamp-parts, .range-parts, .time-range-parts { grid-template-columns: 1fr; }
    .format-field { justify-self: stretch; }
    .format, .precision, .zone, .offset { width: 100%; }
  }
</style>
