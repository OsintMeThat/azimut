<script>
  /**
   * The questions *From the case* asks, under the starts of the New note dialog:
   * the period, what a day means, the layout, and the count said again as they change
   * (`lib/notes/fromCaseAsk.svelte.js`).
   */
  import DayPicker from '../../components/DayPicker.svelte';
  import { LAYOUTS, READINGS } from '../../lib/notes/fromCase.js';

  let { ask } = $props();
</script>

<div class="case-fields">
  <p class="lead">Every geolocation of a period: the proofs, and the pictures and videos placed at a confirmed point.</p>
  <div class="grid">
    <section aria-labelledby="from-case-period">
      <h4 id="from-case-period">Period</h4>
      <div class="days">
        <div class="day">
          <span>From</span>
          <DayPicker value={ask.from} max={ask.to} label="First day" placeholder="Pick a day" onpick={(day) => ask.pickDay('from', day)} />
        </div>
        <div class="day">
          <span>To</span>
          <DayPicker value={ask.to} min={ask.from} label="Last day" placeholder="Pick a day" onpick={(day) => ask.pickDay('to', day)} />
        </div>
      </div>
      <p class="clock">{ask.clockSaid}</p>
    </section>

    <div class="ways">
      <section>
        <h4 id="from-case-by">Dated by</h4>
        <div class="choice" role="radiogroup" aria-labelledby="from-case-by">
          {#each READINGS as option (option.id)}
            <button type="button" role="radio" aria-checked={ask.by === option.id} class:on={ask.by === option.id}
              title={option.title} onclick={() => (ask.by = option.id)}>{option.label}</button>
          {/each}
        </div>
      </section>

      <section>
        <h4 id="from-case-layout">Layout</h4>
        <div class="choice" role="radiogroup" aria-labelledby="from-case-layout">
          {#each LAYOUTS as option (option.id)}
            <button type="button" role="radio" aria-checked={ask.layout === option.id} class:on={ask.layout === option.id}
              title={option.title} onclick={() => (ask.layout = option.id)}>{option.label}</button>
          {/each}
        </div>
      </section>
    </div>
  </div>

  <p class="count" class:muted={!ask.current || !ask.found?.total} role="status" aria-live="polite">{ask.said}</p>
</div>

<style>
  .lead { margin: 0 0 10px; color: var(--text-2); font-size: var(--fs-sm); line-height: 1.45; }
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: 14px 18px; }
  .ways { display: flex; flex-direction: column; gap: 10px; }
  h4 { margin: 0 0 6px; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; }
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
  .count { margin: 10px 0 0; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; }
  .count.muted { color: var(--text-3); font-weight: 400; }
  @media (max-width: 640px) {
    .grid { grid-template-columns: minmax(0, 1fr); }
  }
</style>
