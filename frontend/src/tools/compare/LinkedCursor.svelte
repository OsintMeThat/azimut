<script>
  /**
   * The pointer over the other map, echoed on this one as a cross: side by
   * side, the eye goes to the same roof in both pictures without hunting for
   * it. Only drawn, never in the way of a click, and never in an export.
   */
  import { mirrorPointer } from '../../lib/map/linkedCursor.js';

  /** `source` is the map under the pointer, `engine` this one; `client` the pointer in viewport px. */
  let { source = null, engine = null, client = null } = $props();

  let revision = $state(0);

  $effect(() => {
    if (!engine) return;
    const refresh = () => revision++;
    const release = engine.on('view-move', refresh);
    return release;
  });

  const at = $derived.by(() => {
    revision;
    return mirrorPointer(source, engine, client);
  });
</script>

{#if at}
  <svg class="linked-cursor" width="25" height="25" viewBox="0 0 25 25"
    style:left={`${at.x}px`} style:top={`${at.y}px`} aria-hidden="true">
    <path d="M12.5 0 V9 M12.5 16 V25 M0 12.5 H9 M16 12.5 H25" />
    <circle cx="12.5" cy="12.5" r="1.5" />
  </svg>
{/if}

<style>
  .linked-cursor {
    position: absolute;
    z-index: 600;
    transform: translate(-50%, -50%);
    pointer-events: none;
    overflow: visible;
    color: #fff;
    filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.8));
  }
  path { fill: none; stroke: currentColor; stroke-width: 1.5; }
  circle { fill: currentColor; }
</style>
