<script>
  import Icon from '../../components/Icon.svelte';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';

  // The first thing a video with nothing marked says, in place of the empty strip's
  // line, in the strip's own height: is it one place or several? The whole video keeps
  // one scene about all of it. Several places only says how S marks them as the video
  // plays, and the strip stops asking, as Not now does. It goes at the first scene.
  let { onwhole, onseveral, onlater } = $props();
</script>

<div class="invite" role="group" aria-label="Mark to geolocate" data-testid="scene-invite">
  <span class="ask">One place or several?</span>
  <span class="picks">
    <button class="btn btn-sm" onclick={() => onwhole?.()} title={INSPECT_HELP.inviteWhole}>
      <Icon name="video" size={13} /> The whole video: one place
    </button>
    <button class="btn btn-sm several" onclick={() => onseveral?.()} title={INSPECT_HELP.inviteSeveral}>
      <Icon name="pin" size={13} /> Several places: mark them as you watch <kbd>S</kbd>
    </button>
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
    flex-wrap: wrap;
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
  .picks .btn :global(svg) {
    color: var(--text-2);
  }
  .several :global(svg) {
    color: var(--accent);
  }
  kbd {
    padding: 0 4px;
    border-radius: 3px;
    border: 1px solid currentColor;
    font-size: 10px;
    font-family: var(--font-mono);
    opacity: 0.6;
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
