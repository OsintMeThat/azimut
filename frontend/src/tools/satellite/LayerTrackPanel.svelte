<script>
  /**
   * Time, in the editor of a layer followed over time: the moment it is read
   * and edited at, and how its moments are dated.
   *
   * The cursor is the one every map reads (`addedLayers.time`). At now, an edit
   * corrects what each feature is now; at a moment, it starts a state there, or
   * corrects the one in force then, as the map's edit bar says. How the states
   * are dated (the day, or the day and time, and on which clock) is set once, in
   * the layer's menu.
   */
  import LayerTimeCursor from './LayerTimeCursor.svelte';
  import { addedLayers } from '../../lib/map/addedLayersState.svelte.js';
  import { momentLabel } from '../../lib/map/layerHistory.js';

  let { controller } = $props();
  const editor = $derived(controller.editor);
  const track = $derived(editor?.track ?? {});
  const time = $derived(addedLayers.time(editor.name));
</script>

<div class="track-panel" role="group" aria-label="Time">
  <LayerTimeCursor {time} moments={controller.moments} precision={track.precision ?? 'day'}
    zone={track.zone ?? 'UTC'} label={`${editor.title}: moment`} onchange={(patch) => addedLayers.setTime(editor.name, patch)} />
  <p class="says">{time.at === null ? 'Now: an edit corrects what a feature is now.'
    : controller.timeMode === 'fix' ? `An edit corrects the state in force on ${momentLabel(time.at)}.`
      : `An edit starts a state on ${momentLabel(time.at)}.`}</p>
</div>

<style>
  .track-panel { margin: 8px 0 4px; padding: 4px 6px 6px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); }
  .track-panel :global(.cursor) { padding-left: 0; }
  .says { margin: 2px 0 6px; color: var(--text-3); font-size: 10px; line-height: 1.4; }
</style>
