<script>
  /**
   * What a line of two points answers, in its ground window's title bar:
   * whether B is in sight from A, where the ground stands in the way, at what
   * angle the eye looks up or down to B, and how much higher B stands. One
   * glance before the chart.
   */
  import Icon from '../../components/Icon.svelte';
  import { formatDistance, formatHeight } from '../../lib/measure.js';
  import { signed } from '../../lib/measures.js';

  let {
    /** The sight answer (`profile.sight`), or null. */
    sight = null,
    /** The ground at A and at B, once read. */
    corners = null,
    busy = false,
    units = 'metric',
  } = $props();
</script>

<div class="verdict" aria-live="polite">
  {#if sight}
    <span class="pill" class:clear={sight.visible}>
      <Icon name={sight.visible ? 'eye' : 'eyeOff'} size={12} />
      {sight.visible ? 'B is in sight from A' : `Hidden: ground in the way at ${formatDistance(sight.blocked_at_m, units)}`}
    </span>
    {#if Number.isFinite(sight.angle_deg)}
      <span class="chip mono" title="How far above or below the level the eye at A looks to see B">
        {sight.angle_deg >= 0 ? '↗' : '↘'} {sight.angle_deg >= 0 ? '+' : '−'}{Math.abs(sight.angle_deg).toFixed(1)}°
      </span>
    {/if}
    {#if corners?.length === 2}
      <span class="chip mono" title="The ground at A, then at B">
        {formatHeight(corners[0], units)} → {formatHeight(corners[1], units)}
        <b>{signed(corners[1] - corners[0], units)}</b>
      </span>
    {/if}
  {:else if busy}
    <span class="waiting">Reading the ground…</span>
  {/if}
</div>

<style>
  .verdict {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: var(--fs-xs);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 9px;
    border-radius: 999px;
    background: var(--danger-soft);
    box-shadow: inset 0 0 0 1px rgba(217, 112, 112, 0.45);
    color: #f0a0a0;
    font-weight: 600;
  }
  .pill.clear {
    background: var(--ok-soft);
    box-shadow: inset 0 0 0 1px rgba(102, 181, 120, 0.45);
    color: #8fdcae;
  }
  .chip {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-2);
    color: var(--text-2);
  }
  .chip b {
    margin-left: 3px;
    color: var(--text-1);
    font-weight: 600;
  }
  .waiting {
    color: var(--text-3);
  }
</style>
