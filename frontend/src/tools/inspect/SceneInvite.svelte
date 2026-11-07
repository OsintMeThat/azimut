<script>
  import Icon from '../../components/Icon.svelte';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';

  // The first thing a video with nothing marked says, in place of the empty strip's
  // line, in the strip's own height: does it hold several places? It goes at the first
  // scene, and Not now keeps that file quiet.
  let { onmoment, onwhole, onlater } = $props();
</script>

<div class="invite" role="group" aria-label="Mark to geolocate" data-testid="scene-invite">
  <span class="ask">Several places in this video?</span>
  <span class="picks">
    <button class="btn btn-sm mark-one" onclick={() => onmoment?.()} title={INSPECT_HELP.inviteMoment}>
      <Icon name="pin" size={13} /> This moment
    </button>
    <button class="btn btn-sm" onclick={() => onwhole?.()} title={INSPECT_HELP.inviteWhole}>Whole video</button>
    <button class="later" onclick={() => onlater?.()} title={INSPECT_HELP.inviteLater}>Not now</button>
  </span>
</div>

<style>
  /* One line, or the question over its answers where the strip is narrow: both fit the
     height a frame's tile gives the strip. */
  .invite {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    white-space: nowrap;
  }
  .ask {
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .picks {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .picks .btn {
    flex-shrink: 0;
    gap: 5px;
    min-height: 24px;
    padding-top: 2px;
    padding-bottom: 2px;
  }
  .mark-one :global(svg) {
    color: var(--accent);
  }
  .later {
    flex-shrink: 0;
    padding: 2px 6px;
    border-radius: var(--r-sm);
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .later:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
</style>
