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
  <div class="line">
    <span class="ask">One place or several?</span>
    <button class="btn btn-sm" onclick={() => onwhole?.()} title={INSPECT_HELP.inviteWhole}>
      <Icon name="video" size={13} /> <span>The whole video<span class="spare">: one place</span></span>
    </button>
    <button class="btn btn-sm several" onclick={() => onseveral?.()} title={INSPECT_HELP.inviteSeveral}>
      <Icon name="pin" size={13} /> <span>Several places: mark them <span class="watch">as you watch</span></span> <kbd>S</kbd>
    </button>
    <button class="later" onclick={() => onlater?.()} title={INSPECT_HELP.inviteLater}>Not now</button>
  </div>
</div>

<style>
  /* It keeps to the height a frame's tile gives the strip, whatever room the strip has:
     the question goes first, then the choices take a line each, then their spare words. */
  .invite {
    flex: 1;
    min-width: 0;
    container-type: inline-size;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 4px 6px;
    white-space: nowrap;
  }
  .ask {
    margin-right: 4px;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .btn {
    flex-shrink: 0;
    gap: 5px;
    min-height: 24px;
    padding-top: 2px;
    padding-bottom: 2px;
  }
  .btn :global(svg) {
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
  @container (max-width: 680px) {
    .ask {
      display: none;
    }
  }
  @container (max-width: 530px) {
    .line {
      flex-wrap: wrap;
    }
    .several {
      order: 1;
    }
  }
  @container (max-width: 290px) {
    .watch {
      display: none;
    }
  }
  @container (max-width: 250px) {
    .spare {
      display: none;
    }
  }
</style>
