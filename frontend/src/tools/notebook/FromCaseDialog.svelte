<script>
  /**
   * A note made of the case's geolocations over a period (`lib/notes/fromCase.js`).
   *
   * Four questions and nothing else: the days, on the case's clock; whether a day
   * means what the item shows or when it was geolocated; a figure each or a table;
   * and the count, said again as either changes. It opens on every day the case's
   * geolocations cover, so the count means something before anything is touched.
   * Create writes the note from the count on screen.
   */
  import { untrack } from 'svelte';
  import Modal from '../../components/Modal.svelte';
  import DayPicker from '../../components/DayPicker.svelte';
  import { axisZone, caseAxis, learnAxisZone } from '../../lib/caseAxis.svelte.js';
  import { offsetLabel, zoneWords } from '../../lib/timeline.js';
  import { freeTitle } from '../../lib/notes/ready.js';
  import {
    FROM_CASE_LOOK, LAYOUTS, READINGS, countWords, fromCaseNote, periodTitle, readFromCase,
  } from '../../lib/notes/fromCase.js';

  let {
    caseId,
    /** The names of the notes already in the case, so the new one gets a free one. */
    taken = [],
    oncreate,
    onclose,
  } = $props();

  let from = $state('');
  let to = $state('');
  let by = $state('shown');
  let layout = $state('figures');
  let picked = $state(false); // the analyst chose the days; until then they follow the reading
  let found = $state(null); // the answer for `answered`
  let answered = $state('');
  let reading = $state(false);
  let failed = $state('');
  let creating = $state(false);

  $effect(() => { void learnAxisZone(caseId); });
  const zone = $derived(caseAxis.caseId === caseId ? axisZone(caseId) : 'UTC');
  // the offset the zone keeps in the period, not today: a summer clock is an hour off in March
  const clockSaid = $derived(zone === 'UTC'
    ? 'Days on the case’s clock: UTC'
    : `Days on the case’s clock: ${zoneWords(zone).place} (${offsetLabel(zone, from ? Date.parse(`${from}T12:00:00Z`) : Date.now())})`);
  const asked = $derived(`${from}|${to}|${by}|${zone}`);
  const current = $derived(Boolean(found) && answered === asked);
  const ready = $derived(current && !reading && (found?.total ?? 0) > 0 && !creating);

  // the count follows the question, a moment after it stops changing
  $effect(() => {
    const question = { from, to, by, zone, key: asked };
    const open = !untrack(() => picked);
    if (untrack(() => answered) === question.key) {
      reading = false;
      return;
    }
    const controller = new AbortController();
    reading = true;
    failed = '';
    const timer = setTimeout(() => {
      readFromCase(caseId, open ? { by: question.by, zone: question.zone } : question, { signal: controller.signal })
        .then((answer) => {
          if (controller.signal.aborted) return;
          reading = false;
          found = answer;
          if (open) {
            // every day the reading covers, which counts the same as no bound at all
            from = answer.first ?? '';
            to = answer.last ?? '';
            answered = `${from}|${to}|${question.by}|${question.zone}`;
          } else {
            answered = question.key;
          }
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          reading = false;
          failed = error.message || 'The case could not be read.';
        });
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  function pickDay(side, day) {
    picked = true;
    if (side === 'from') {
      from = day;
      if (to && day > to) to = day;
    } else {
      to = day;
      if (from && day < from) from = day;
    }
  }

  function create() {
    if (!ready) return;
    creating = true;
    const title = freeTitle(periodTitle(from, to, by), taken);
    const note = fromCaseNote(found, { from, to, by, zone, layout, title });
    Promise.resolve(oncreate?.({ name: note.title, body: note.body, folder: '', look: FROM_CASE_LOOK }))
      .finally(() => { creating = false; });
  }

  const said = $derived(failed || (!current ? 'Counting…'
    : found?.first || found?.undated ? countWords(found, by) : 'This case holds no geolocation yet.'));
</script>

<Modal title="From the case" {onclose} width="440px">
  <p class="lead">A note with every geolocation of a period: the proofs, and the pictures and videos placed at a confirmed point.</p>

  <section aria-labelledby="from-case-period">
    <h4 id="from-case-period">Period</h4>
    <div class="days">
      <div class="day">
        <span>From</span>
        <DayPicker value={from} max={to} label="First day" placeholder="Pick a day" onpick={(day) => pickDay('from', day)} />
      </div>
      <div class="day">
        <span>To</span>
        <DayPicker value={to} min={from} label="Last day" placeholder="Pick a day" onpick={(day) => pickDay('to', day)} />
      </div>
    </div>
    <p class="clock">{clockSaid}</p>
  </section>

  <section>
    <h4 id="from-case-by">Dated by</h4>
    <div class="choice" role="radiogroup" aria-labelledby="from-case-by">
      {#each READINGS as option (option.id)}
        <button type="button" role="radio" aria-checked={by === option.id} class:on={by === option.id}
          title={option.title} onclick={() => (by = option.id)}>{option.label}</button>
      {/each}
    </div>
  </section>

  <section>
    <h4 id="from-case-layout">Layout</h4>
    <div class="choice" role="radiogroup" aria-labelledby="from-case-layout">
      {#each LAYOUTS as option (option.id)}
        <button type="button" role="radio" aria-checked={layout === option.id} class:on={layout === option.id}
          title={option.title} onclick={() => (layout = option.id)}>{option.label}</button>
      {/each}
    </div>
  </section>

  <p class="count" class:muted={!current || !found?.total} role="status" aria-live="polite">{said}</p>

  <div class="actions">
    <button type="button" class="btn" onclick={onclose}>Cancel</button>
    <button type="button" class="btn btn-primary" disabled={!ready} onclick={create}>{creating ? 'Creating…' : 'Create'}</button>
  </div>
</Modal>

<style>
  .lead { margin: 0 0 14px; color: var(--text-2); font-size: var(--fs-sm); line-height: 1.45; }
  section { margin-bottom: 14px; }
  h4 { margin: 0 0 7px; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; }
  .days { display: flex; gap: 10px; }
  .day { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; color: var(--text-3); font-size: var(--fs-xs); }
  .clock { margin: 6px 0 0; color: var(--text-3); font-size: var(--fs-xs); }
  .choice { display: flex; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
  .choice button {
    flex: 1; padding: 6px 10px; border: none; border-left: 1px solid var(--border); background: var(--bg-2); color: var(--text-2);
    font: inherit; font-size: var(--fs-sm); cursor: pointer;
  }
  .choice button:first-child { border-left: none; }
  .choice button:hover { color: var(--text-1); }
  .choice button.on { background: var(--accent); color: var(--accent-text); font-weight: 600; }
  .count { margin: 4px 0 0; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; }
  .count.muted { color: var(--text-3); font-weight: 400; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
