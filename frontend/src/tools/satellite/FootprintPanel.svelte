<script>
  /**
   * Tracing a footprint, or a new zone, in the rail's one panel slot.
   *
   * It names the place the whole time it is open: the shape on the map belongs
   * to a point somewhere else on the screen, and without the name this is a
   * polygon being drawn for nobody. A new zone has no name yet, so it is asked
   * here, beside the corners being clicked.
   */
  import Icon from '../../components/Icon.svelte';
  import { ZONE_NAME_MAX } from './state/footprint.svelte.js';

  let { place, points, complete, covers, ready, title = $bindable(''), saving, undo, save, cancel } = $props();

  const fresh = $derived(Boolean(place?.fresh));
  const editing = $derived(!fresh && Boolean(place?.footprint));

  /** What this tracing takes the place of. A place states how tightly it is pinned
   *  once, so saving a shape drops the circle it had. */
  const replaces = $derived.by(() => {
    if (fresh || place?.footprint) return '';
    const m = Number(place?.radius_m);
    if (!(m > 0)) return '';
    return `replaces its ${m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`} circle`;
  });
</script>

<div class="footprint-panel card">
  {#if fresh}
    <p class="who">New zone</p>
    <input
      class="input name"
      type="text"
      placeholder="Its name"
      maxlength={ZONE_NAME_MAX}
      aria-label="Zone name"
      title="The zone's name, as its card and the Names switch show it"
      bind:value={title}
      onkeydown={(event) => {
        if (event.key === 'Enter' && ready && !saving) save();
      }}
    />
  {:else}
    <p class="who">
      {editing ? 'Editing' : 'Tracing'} <strong>{place?.title}</strong>
      {#if replaces}<span class="over">{replaces}</span>{/if}
    </p>
  {/if}
  <p class="hint" class:warn={complete && !covers}>
    {#if complete && !covers}
      The shape has to contain the pin it belongs to.
    {:else if editing || (complete && points > 3)}
      Drag a corner to move it, a side's dot to add one. Click a corner, then Delete.
    {:else if complete}
      {points} corners. {fresh ? 'Name it, then Save.' : 'Save closes the shape.'}
    {:else}
      Click the corners. {3 - points} more to make an area.
    {/if}
  </p>
  <div class="acts">
    <button class="btn btn-sm" onclick={undo} disabled={!points || saving} title="Take the last corner back (Backspace)">
      <Icon name="reset" size={13} /> Undo
    </button>
    <button class="btn btn-sm btn-primary" onclick={save} disabled={!ready || saving}>
      {saving ? 'Saving…' : 'Save'}
    </button>
    <button class="btn btn-ghost btn-sm" onclick={cancel} disabled={saving}>Cancel</button>
  </div>
</div>

<style>
  .footprint-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: max-content;
    max-width: 260px;
    padding: 10px;
    background: rgba(24, 24, 24, 0.92);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-2);
  }
  .who {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .over {
    display: block;
    color: var(--text-3);
  }
  .name {
    width: 220px;
  }
  .hint {
    margin: -4px 0 0;
    font-size: 10px;
    color: var(--text-3);
  }
  .hint.warn {
    color: var(--warn);
  }
  .acts {
    display: flex;
    gap: 4px;
  }
</style>
