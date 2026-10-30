<script>
  /**
   * When one feature of a layer followed over time shows, under its name in the
   * sheet: the day it first shows and the day it leaves the map, each pressed for
   * a calendar, and its history as a short line of dates.
   *
   * The history says what each date brought and where the next edit goes: the
   * date it rewrites carries a pencil, and a dated edit that would start a new
   * one shows as a dashed row at the day the layer is shown at, before it is
   * made. A row pressed shows the layer that day; "Change" goes to a day picked,
   * where the next move or status is a change from it. While edits carry no date
   * a line says what a date holds: a feature moved on a day moves from a day. A
   * long history shows its first and last dates and those round the edit, the
   * rest counted on a row that unfolds them (`foldRows`).
   *
   * Given several `features`, the two days are theirs together: a day they share
   * is said, else "Mixed", and one picked goes to all of them in one edit. The
   * calendars offer only the days every one of them can take; the history and
   * the changes from a day stay with one feature.
   *
   * On a layer dated to the minute each calendar has a time above it: a day
   * picked carries it, and a time changed on a bound already dated moves it there.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import MonthGrid from '../../components/MonthGrid.svelte';
  import LayerClock from './LayerClock.svelte';
  import { dayNumber, isoDay } from '../../lib/map/layerDates.js';
  import { foldRows, lifeRows, momentLabel, momentNow, shortMoment, spanOf } from '../../lib/map/layerHistory.js';
  import { addedLayers } from '../../lib/map/addedLayersState.svelte.js';

  let { controller, feature = null, features = null, event = false } = $props();

  const busy = $derived(controller.loading);
  const cursor = $derived(controller.cursor);
  const list = $derived(features?.length ? features : [feature]);
  const many = $derived(list.length > 1);
  const spans = $derived(list.map(spanOf));
  /** The days they share; a bound they differ on is null. */
  const span = $derived({
    start: spans.every((one) => one.start === spans[0].start) ? spans[0].start : null,
    end: spans.every((one) => one.end === spans[0].end && one.ends === spans[0].ends && one.unknown === spans[0].unknown) ? spans[0].end : null,
    ends: spans[0].ends,
    unknown: spans.every((one) => one.unknown),
  });
  const rows = $derived(many ? [] : lifeRows(feature, cursor, controller.timeMode));
  /** While edits carry no date, what a date holds: a feature moved on a day moves from a day. */
  const held = $derived(many ? { shape: '', status: '' } : controller.held?.(feature) ?? { shape: '', status: '' });
  const states = $derived(many ? [] : feature.properties.states ?? []);
  const key = $derived(list.map((one) => one.properties.key).join(' '));
  /** Today on the layer's clock: no day after it is offered. */
  const today = $derived(momentNow({ zone: controller.editor?.track?.zone }));
  const dayOf = (at) => dayNumber(String(at ?? '').slice(0, 10));
  const shift = (at, days) => (dayOf(at) === null ? '' : isoDay(dayOf(at) + days));
  const earliest = (...days) => days.filter(Boolean).sort()[0] ?? '';
  const latest = (...days) => days.filter(Boolean).sort().at(-1) ?? '';
  /** Each one's state after the first, which a start must stay before. */
  const nexts = $derived(list.map((one) => one.properties.states?.[1]?.at ?? '').filter(Boolean));
  /** Each one's last state it is drawn in, which an end must come after. */
  const lastLives = $derived(list.map((one, index) => {
    const own = one.properties.states ?? [];
    return own.length ? own.findLast((state) => !state.gone)?.at ?? '' : spans[index].start;
  }));
  const startMax = $derived(earliest(today, ...nexts.map((next) => shift(next, -1))));
  const endMin = $derived(latest(...lastLives.map((last) => last && shift(last, 1))));
  const changeMin = $derived(span.start ? shift(span.start, 1) : '');
  const changeMax = $derived(earliest(today, span.end && span.ends === 'gone' && shift(span.end, -1)));
  /** The day the layer is shown at, offered as a start or an end where every one can take it. */
  const shownStart = $derived(cursor !== null && cursor !== span.start && nexts.every((next) => cursor < next) && cursor.slice(0, 10) <= today);
  const shownEnd = $derived(!event && cursor !== null && cursor !== span.end && lastLives.every((last) => cursor > last));

  const startSaid = $derived(span.start === null ? 'Mixed' : event ? (span.start ? shortMoment(span.start) : 'No day')
    : span.start ? `From ${shortMoment(span.start)}` : 'Always');
  const endSaid = $derived(span.end === null ? 'Mixed' : span.unknown ? 'Unknown' : !span.end ? 'Still there'
    : span.ends === 'gone' ? `Gone ${shortMoment(span.end)}` : `Until ${shortMoment(span.end)}`);

  /** Which calendar is open: 'start', 'end', 'change' or ''. */
  let open = $state('');
  let anchors = $state({});
  /** Whether the whole history is shown, for this feature only. */
  let whole = $state(false);
  $effect(() => { void key; open = ''; whole = false; });
  const shownRows = $derived(whole ? rows : foldRows(rows));

  const zone = $derived(controller.editor?.track?.zone || 'UTC');
  const timed = $derived(controller.editor?.track?.precision === 'time');
  /** The moment each calendar stands on: what its day picked replaces. */
  const bound = (which) => ({ start: span.start, end: span.unknown ? '' : span.end, change: cursor }[which] ?? '');
  const clockOf = (at) => (String(at ?? '').includes('T') ? String(at).slice(11, 16) : '');
  /** The time the open calendar's day is given, `HH:MM` or ''. */
  let clock = $state('');
  const withClock = (iso) => (timed && clock ? `${iso}T${clock}` : iso);

  function toggle(which) {
    open = open === which ? '' : which;
    clock = open ? clockOf(bound(open)) || clockOf(cursor) : '';
  }
  /** A time changed: a bound already dated moves to it, the calendar stays open. */
  function retime(value) {
    clock = value;
    const day = String(bound(open) ?? '').slice(0, 10);
    if (!day) return;
    const at = value ? `${day}T${value}` : day;
    if (open === 'start') start(at, true);
    else if (open === 'end') end(at, true);
    else if (open === 'change') controller.changeOn(at);
  }
  function start(at, stay = false) {
    if (!stay) open = '';
    if (at === span.start) return;
    if (many) controller.setSelectionWhen({ start: at });
    else controller.setStart(key, at);
  }
  function end(at, stay = false) {
    if (!stay) open = '';
    if (at === span.end && !span.unknown) return;
    if (many) controller.setSelectionWhen({ end: at });
    else controller.setEnd(key, at);
  }
  /** Nobody knows when it left: no end, drawn as still there. Only ever on a press. */
  function unknown() {
    open = '';
    if (span.unknown) return;
    if (many) controller.setSelectionWhen({ end_unknown: true });
    else controller.setEndUnknown(key);
  }
  function change(at) { open = ''; controller.changeOn(at); }
  const view = (at) => addedLayers.setTime(controller.editor.name, { at });
</script>

<div class="when" role="group" aria-label="When it shows">
  <Icon name="clock" size={12} />
  <button type="button" class="bound" class:open-ended={span.start === ''} class:mixed={span.start === null} aria-label="When it first shows" aria-expanded={open === 'start'}
    title={event ? 'The day of the event' : 'The day it first shows on the map'} disabled={busy}
    bind:this={anchors.start} onclick={() => toggle('start')}>{startSaid}</button>
  {#if !event}
    <span class="to" aria-hidden="true">→</span>
    <button type="button" class="bound" class:open-ended={span.end === '' && !span.unknown} class:mixed={span.end === null} aria-label="When it leaves the map" aria-expanded={open === 'end'}
      title="The day it leaves the map" disabled={busy} bind:this={anchors.end} onclick={() => toggle('end')}>{endSaid}</button>
  {/if}
  <span class="grow"></span>
  {#if !many}
  <button type="button" class="add-change" aria-label="Change it from a day" aria-expanded={open === 'change'}
    title="Change it from a day: pick the day, then move it or set its status" disabled={busy}
    bind:this={anchors.change} onclick={() => toggle('change')}><Icon name="plus" size={12} /></button>
  {/if}
</div>

{#if rows.length > 1}
  <ol class="life" aria-label="Feature history">
    {#each shownRows as row (row.fold ? `fold ${row.at}` : row.ghost ? 'ghost' : row.at)}
      {#if row.fold}
        <li class="folded"><span class="dot" aria-hidden="true"></span>
          <button type="button" class="more" title="Show every date" onclick={() => (whole = true)}>{row.fold} more dates</button></li>
      {:else}
      <li class:current={row.current && !row.ghost} class:gone={row.gone} class:ghost={row.ghost}>
        <span class="dot" aria-hidden="true"></span>
        <button type="button" class="moment" disabled={row.ghost || !row.at || row.at === cursor}
          title={row.ghost ? 'A move or a status set now starts here' : row.at ? 'Show the layer that day' : 'Before any date'}
          onclick={() => view(row.at)}>
          <span class="at">{row.at ? shortMoment(row.at) : 'Always'}</span>
          <span class="what">{row.what}</span>
          {#if row.editing}<span class="pen" title="Your edits change this one"><Icon name="edit" size={10} /></span>{/if}
        </button>
        {#if !row.ghost && states.length > 1}
          <button type="button" class="drop" aria-label={`Remove the change of ${momentLabel(row.at)}`} title="Take this date out" disabled={busy}
            onclick={() => controller.dropState(key, row.at)}><Icon name="x" size={9} /></button>
        {/if}
      </li>
      {/if}
    {/each}
  </ol>
{/if}

{#if held.shape || held.status}
  <p class="held"><Icon name="lock" size={10} />{held.shape ? `Moved on ${shortMoment(held.shape)}: pick a day to move it.`
    : `Status changes on ${shortMoment(held.status)}: pick a day to set it.`}</p>
{/if}

{#if open === 'start'}
  <FloatingMenu anchor={anchors.start} width={248} label="When it first shows" onclose={() => (open = '')}>
    <p class="fm-head">{event ? 'Day of the event' : 'Shows from'}</p>
    <button type="button" class="fm-item" role="menuitemradio" aria-checked={span.start === ''} onclick={() => start('')}>
      <Icon name="always" size={14} /><span class="fm-grow">{event ? 'No day' : 'Always'}</span>
      {#if span.start === ''}<span class="fm-tick"><Icon name="check" size={13} /></span>{/if}</button>
    {#if shownStart}
      <button type="button" class="fm-item" role="menuitemradio" aria-checked="false" onclick={() => start(cursor)}>
        <Icon name="eye" size={14} /><span class="fm-grow">{momentLabel(cursor)}</span><span class="aside">day shown</span></button>
    {/if}
    <div class="fm-sep"></div>
    {#if timed}<LayerClock value={clock} {zone} label="Time it first shows" onchange={retime} />{/if}
    <MonthGrid value={(span.start ?? '').slice(0, 10)} max={startMax} label="First day" onpick={(iso) => { if (iso) start(withClock(iso)); }} />
  </FloatingMenu>
{:else if open === 'end'}
  <FloatingMenu anchor={anchors.end} width={248} label="When it leaves the map" onclose={() => (open = '')}>
    <p class="fm-head">Leaves the map</p>
    <button type="button" class="fm-item" role="menuitemradio" aria-checked={span.end === '' && !span.unknown} onclick={() => end('')}>
      <Icon name="always" size={14} /><span class="fm-grow">Still there</span>
      {#if span.end === '' && !span.unknown}<span class="fm-tick"><Icon name="check" size={13} /></span>{/if}</button>
    {#if shownEnd}
      <button type="button" class="fm-item" role="menuitemradio" aria-checked="false" onclick={() => end(cursor)}>
        <Icon name="eye" size={14} /><span class="fm-grow">{momentLabel(cursor)}</span><span class="aside">day shown</span></button>
    {/if}
    <div class="fm-sep"></div>
    {#if timed}<LayerClock value={clock} {zone} label="Time it leaves" onchange={retime} />{/if}
    <MonthGrid value={(span.end ?? '').slice(0, 10)} min={endMin} max={today} label="Day it leaves" onpick={(iso) => { if (iso) end(withClock(iso)); }}
      also={{ label: 'Unknown', title: 'Nobody knows when it left: drawn as still there', pressed: span.unknown, onclick: unknown }} />
    <p class="fm-note">{many ? `Gone from that day on, for all ${list.length}.` : 'Gone from that day on.'}</p>
  </FloatingMenu>
{:else if open === 'change'}
  <FloatingMenu anchor={anchors.change} align="end" width={248} label="Change it from a day" onclose={() => (open = '')}>
    <p class="fm-head">Changes from</p>
    {#if timed}<LayerClock value={clock} {zone} label="Time it changes" onchange={retime} />{/if}
    <MonthGrid value={cursor ? cursor.slice(0, 10) : ''} min={changeMin} max={changeMax} label="Day it changes" onpick={(iso) => { if (iso) change(withClock(iso)); }} />
    <p class="fm-note">Then move it or set its status.</p>
  </FloatingMenu>
{/if}

<style>
  .when { display: flex; align-items: center; gap: 5px; min-width: 0; margin: -2px 0 8px; color: var(--text-3); font-size: 11px; }
  .when > :global(svg) { flex: none; }
  .bound { min-width: 0; height: 22px; padding: 0 9px; overflow: hidden; border: 1px solid var(--border); border-radius: 999px; background: var(--bg-1);
    color: var(--text-1); font-size: 11px; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;
    transition: border-color .12s, background-color .12s; }
  /* no date is drawn open: a dashed rim, the words quieter */
  .bound.open-ended { border-style: dashed; color: var(--text-2); }
  /* days the selection does not share: the words quieter, the rim whole */
  .bound.mixed { border-style: solid; color: var(--text-3); font-style: italic; }
  .bound:hover:not(:disabled), .bound[aria-expanded='true'] { border-color: var(--accent); border-style: solid; }
  .bound[aria-expanded='true'] { background: var(--accent-soft); }
  .to { flex: none; color: var(--text-3); }
  .grow { flex: 1; }
  /* a date to add, drawn as the dates are: round, the rim dashed until it is one */
  .add-change { display: grid; place-items: center; flex: none; width: 22px; height: 22px; border: 1px dashed var(--border); border-radius: 50%;
    color: var(--text-3); cursor: pointer; transition: color .12s, border-color .12s, background-color .12s; }
  .add-change:hover:not(:disabled), .add-change[aria-expanded='true'] { border-style: solid; border-color: var(--accent); color: var(--text-1); }
  .add-change[aria-expanded='true'] { background: var(--accent-soft); }

  .life { max-height: 156px; margin: -4px 0 8px; padding: 0 0 0 3px; overflow-y: auto; list-style: none; }
  .life li { position: relative; display: flex; align-items: center; min-height: 22px; padding-left: 13px; }
  /* the rail the dates hang on, from the first dot to the last */
  .life li::before { content: ''; position: absolute; left: 3px; top: 0; bottom: 0; width: 1px; background: var(--border); }
  .life li:first-child::before { top: 50%; }
  .life li:last-child::before { bottom: 50%; }
  .dot { position: absolute; left: 0; top: 50%; width: 7px; height: 7px; margin-top: -3.5px; border: 1.5px solid var(--text-3);
    border-radius: 50%; background: var(--bg-2); box-sizing: border-box; }
  .current .dot { border-color: var(--accent); background: var(--accent); }
  .ghost .dot { border-color: var(--accent); border-style: dashed; }
  .gone .dot { border-color: var(--border); }
  /* dates folded away: the rail runs on through a hollow dot, dashed */
  .folded .dot { border-style: dotted; background: transparent; }
  .more { padding: 2px 6px; color: var(--text-3); font-size: 10.5px; font-style: italic; cursor: pointer; }
  .more:hover { color: var(--text-1); text-decoration: underline; }
  .moment { display: grid; grid-template-columns: 76px minmax(0, 1fr) auto; align-items: center; gap: 6px; flex: 1; min-width: 0;
    padding: 2px 6px; border-radius: var(--r-sm); color: var(--text-2); font-size: 11px; text-align: left; cursor: pointer; }
  .moment:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
  .moment:disabled { cursor: default; }
  .at { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .what { overflow: hidden; color: var(--text-3); text-overflow: ellipsis; white-space: nowrap; }
  .current .at { color: var(--text-1); font-weight: 600; }
  .gone .moment { font-style: italic; }
  .ghost .moment { border: 1px dashed var(--accent); color: var(--accent); }
  .ghost .what { color: var(--accent); font-style: italic; }
  .pen { display: grid; place-items: center; color: var(--accent); }
  .drop { display: grid; place-items: center; flex: none; width: 18px; height: 18px; border-radius: 50%; color: var(--text-3);
    opacity: 0; cursor: pointer; transition: opacity .12s; }
  .life li:hover .drop, .drop:focus-visible { opacity: 1; }
  .drop:hover:not(:disabled) { background: var(--bg-3); color: var(--danger); }
  .aside { flex: none; color: var(--text-3); font-size: 10.5px; }
  .held { display: flex; align-items: center; gap: 5px; margin: -4px 0 8px; color: var(--text-3); font-size: 10.5px; line-height: 1.35; }
  .held > :global(svg) { flex: none; }
</style>
