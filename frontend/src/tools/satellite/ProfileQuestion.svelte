<script>
  /**
   * The line-of-sight question an Elevation profile answers, in its window's
   * title bar: how high the eye stands at A and the target at B, and whether
   * B is in sight from A. Set beside the answer, so changing a height and
   * reading what it does happen in one place.
   */
  import Icon from '../../components/Icon.svelte';
  import { formatDistance } from '../../lib/measure.js';

  let {
    eyeHeight,
    targetHeight,
    /** The sight answer (`profile.sight`), or null while it is being read. */
    sight = null,
    units = 'metric',
    setHeights,
    /** Open Horizon at A, facing B, with B marked. */
    onlook = null,
  } = $props();

  function height(which, event) {
    setHeights({ [which]: event.currentTarget.value });
  }
</script>

<div class="question">
  <label title="How high the eye stands above the ground at A">
    <span>Eye at A</span>
    <input class="input mono" type="number" min="0" step="any" value={eyeHeight} onchange={(event) => height('eye', event)} />
    <span class="unit">m</span>
  </label>
  <label title="How high the target stands above the ground at B">
    <span>Target at B</span>
    <input class="input mono" type="number" min="0" step="any" value={targetHeight} onchange={(event) => height('target', event)} />
    <span class="unit">m</span>
  </label>
  {#if sight}
    <p class="verdict" class:clear={sight.visible} aria-live="polite">
      <span class="dot" aria-hidden="true"></span>
      {sight.visible ? 'B is in sight from A' : `Ground in the way at ${formatDistance(sight.blocked_at_m, units)}`}
    </p>
  {/if}
  {#if onlook}
    <button class="btn btn-ghost btn-sm look" onclick={onlook} title="Open Horizon standing at A, facing B">
      <Icon name="eye" size={13} /> Look from A
    </button>
  {/if}
</div>

<style>
  .question {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
    min-width: 0;
    font-size: var(--fs-xs);
  }
  label {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--text-3);
  }
  input {
    width: 54px;
    padding: 1px 5px;
    font-size: var(--fs-xs);
  }
  .unit {
    color: var(--text-3);
  }
  .verdict {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--danger);
    font-weight: 600;
  }
  .verdict.clear {
    color: var(--ok);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }
  .look {
    margin-left: auto;
  }
</style>
