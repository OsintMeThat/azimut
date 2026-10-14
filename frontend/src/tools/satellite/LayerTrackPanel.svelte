<script>
  /**
   * Time, in the editor of a layer followed over time: the moment it is read
   * and edited at, and how its moments are dated.
   *
   * The cursor is the one every map reads (`addedLayers.time`). At now, an edit
   * corrects what each feature is now; at a moment, it starts a state there, or
   * corrects the one in force then, as the map's edit bar says.
   */
  import ClockField from '../../components/ClockField.svelte';
  import LayerTimeCursor from './LayerTimeCursor.svelte';
  import { addedLayers } from '../../lib/map/addedLayersState.svelte.js';
  import { momentLabel } from '../../lib/map/layerHistory.js';

  let { controller } = $props();
  const editor = $derived(controller.editor);
  const track = $derived(editor?.track ?? {});
  const time = $derived(addedLayers.time(editor.name));
  const busy = $derived(controller.pending > 0 || controller.loading);
</script>

<div class="track-panel" role="group" aria-label="Time">
  <LayerTimeCursor {time} moments={addedLayers.moments(editor.name)} precision={track.precision ?? 'day'}
    zone={track.zone ?? 'UTC'} label={`${editor.title}: moment`} onchange={(patch) => addedLayers.setTime(editor.name, patch)} />
  <p class="says">{time.at === null ? 'Now: an edit corrects what a feature is now.'
    : controller.timeMode === 'fix' ? `An edit corrects the state in force on ${momentLabel(time.at)}.`
      : `An edit starts a state on ${momentLabel(time.at)}.`}</p>
  <div class="settings">
    <div class="segments" role="group" aria-label="Date states by">
      <button type="button" aria-pressed={(track.precision ?? 'day') === 'day'} disabled={busy}
        onclick={() => controller.setTrack({ precision: 'day' })}>Day</button>
      <button type="button" aria-pressed={track.precision === 'time'} disabled={busy}
        onclick={() => controller.setTrack({ precision: 'time' })}>Day and time</button>
    </div>
    <ClockField value={time.at ?? ''} clock={{ zone: track.zone ?? 'UTC', fixed: '' }} timed={false} disabled={busy}
      onpick={(zone) => { if (zone) controller.setTrack({ zone }); }} />
  </div>
</div>

<style>
  .track-panel { margin: 8px 0 4px; padding: 4px 6px 6px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); }
  .track-panel :global(.cursor) { padding-left: 0; }
  .says { margin: 2px 0 6px; color: var(--text-3); font-size: 10px; line-height: 1.4; }
  .settings { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .segments { display: flex; border: 1px solid var(--border); border-radius: var(--r-sm); overflow: hidden; background: var(--bg-1); }
  .segments button { padding: 3px 7px; color: var(--text-2); font-size: 11px; cursor: pointer; }
  .segments button + button { border-left: 1px solid var(--border); }
  .segments button:hover:not(:disabled) { background: var(--bg-3); }
  .segments button[aria-pressed='true'] { background: var(--accent-soft); color: var(--text-1); font-weight: 600; }
</style>
