<script>
  /**
   * Time, in the editor of a layer followed over time: the day the layer is
   * shown at. Only what is seen is set here; what an edit is dated to is the
   * map's edit bar's to say, beside the tools that make it, and each feature's
   * own days are under its name in the sheet.
   *
   * The cursor is the one every map reads (`addedLayers.time`). How the states
   * are dated (the day, or the day and time, and on which clock) is set once, in
   * the layer's menu.
   */
  import LayerTimeCursor from './LayerTimeCursor.svelte';
  import { addedLayers } from '../../lib/map/addedLayersState.svelte.js';

  let { controller } = $props();
  const editor = $derived(controller.editor);
  const track = $derived(editor?.track ?? {});
  const time = $derived(addedLayers.time(editor.name));
</script>

<div class="track-panel" role="group" aria-label="Time">
  <p class="caption">Shown on the map</p>
  <LayerTimeCursor {time} moments={controller.moments} precision={track.precision ?? 'day'}
    zone={track.zone ?? 'UTC'} label={`${editor.title}: moment`} onchange={(patch) => addedLayers.setTime(editor.name, patch)} />
</div>

<style>
  .track-panel { margin: 8px 0 4px; padding: 5px 6px 4px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); }
  .track-panel :global(.cursor) { padding-left: 0; }
  .caption { margin: 0 0 1px; color: var(--text-3); font-size: 10px; }
</style>
