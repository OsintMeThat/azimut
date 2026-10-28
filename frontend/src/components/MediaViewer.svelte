<script>
  /**
   * A case file on the whole screen: the picture, the video playing, the sound.
   *
   * Media opens it on a press of a card, Files on a double press or Space. ← and →
   * walk the files of the list it was opened from, in the order shown there, and
   * Escape, Space or a press beside the file closes it. A video gives the arrows and
   * Space to its own controls once it is pressed, as a player does.
   */
  import { fileUrl } from '../lib/fileUrl.js';
  import { portal } from '../lib/fullscreen.js';
  import { isTopOverlay, joinOverlays } from '../lib/overlayStack.js';
  import Icon from './Icon.svelte';

  let {
    caseId,
    /** What ← and → walk, in the order on screen: `{ key, path, kind, name, poster }`. */
    items = [],
    /** The key of the file shown. */
    current = null,
    /** Another file is asked for, by its key. */
    onmove = () => {},
    onclose = () => {},
  } = $props();

  const at = $derived(current == null ? -1 : items.findIndex((item) => item.key === current));
  const item = $derived(at >= 0 ? items[at] : null);

  // A HEIC, a TIFF or a codec the browser lacks: said plainly, not drawn broken.
  let failed = $state(null);

  const self = {};
  $effect(() => (item ? joinOverlays(self, () => onclose()) : undefined));

  function step(delta) {
    if (at < 0 || items.length < 2) return;
    onmove(items[(at + delta + items.length) % items.length].key);
  }

  /** Keys a pressed control keeps for itself: Space presses a button, arrows seek a video. */
  const OWNS_KEYS = 'button, a, input, textarea, select, video, audio, [contenteditable]';

  function onkeydown(event) {
    if (!item || !isTopOverlay(self)) return;
    const owned = event.target instanceof Element && event.target.closest(OWNS_KEYS);
    // A Space already taken is the one that opened the viewer (Files), not a close.
    if (event.key === 'Escape' || (event.key === ' ' && !owned && !event.defaultPrevented)) {
      event.preventDefault();
      onclose();
    } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !owned) {
      event.preventDefault();
      step(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }
</script>

<svelte:window {onkeydown} />

{#if item}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="viewer"
    data-guide="media.viewer"
    use:portal
    role="dialog"
    aria-label={item.name}
    tabindex="-1"
    onclick={(event) => event.target === event.currentTarget && onclose()}
  >
    <button class="close btn btn-ghost" aria-label="Close" title="Close (Esc)" onclick={onclose}>
      <Icon name="x" size={20} />
    </button>
    {#if items.length > 1}
      <button class="nav prev btn btn-ghost" aria-label="Previous file" title="Previous (←)" onclick={() => step(-1)}>
        <Icon name="chevronLeft" size={26} />
      </button>
      <button class="nav next btn btn-ghost" aria-label="Next file" title="Next (→)" onclick={() => step(1)}>
        <Icon name="chevronRight" size={26} />
      </button>
    {/if}
    {#key item.key}
      {#if failed === item.key}
        <p class="unreadable">This browser cannot show this file.</p>
      {:else if item.kind === 'video'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          src={fileUrl(caseId, item.path)}
          poster={item.poster ? fileUrl(caseId, item.poster) : undefined}
          controls
          autoplay
          onerror={() => (failed = item.key)}
        ></video>
      {:else if item.kind === 'audio'}
        <div class="sound">
          <Icon name="audio" size={40} />
          <audio src={fileUrl(caseId, item.path)} controls autoplay onerror={() => (failed = item.key)}></audio>
        </div>
      {:else}
        <img src={fileUrl(caseId, item.path)} alt={item.name} onerror={() => (failed = item.key)} />
      {/if}
    {/key}
    <span class="caption" dir="auto">
      {item.name}{#if items.length > 1}<span class="count">{` · ${at + 1}/${items.length}`}</span>{/if}
    </span>
  </div>
{/if}

<style>
  /* Below the top bar, like a modal: its Add event seats the file on screen. */
  .viewer {
    position: fixed;
    inset: var(--topbar-h, 0px) 0 0;
    z-index: 950;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px 72px 56px;
    background: rgba(4, 7, 12, 0.94);
    cursor: zoom-out;
  }
  .viewer img,
  .viewer video {
    max-width: 100%;
    max-height: 100%;
    min-height: 0;
    object-fit: contain;
    border-radius: var(--r);
    box-shadow: var(--shadow-2);
    cursor: default;
  }
  .sound {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
    width: min(480px, 100%);
    color: var(--text-2);
    cursor: default;
  }
  .unreadable {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-sm);
    cursor: default;
  }
  .sound audio {
    width: 100%;
  }
  .close {
    position: absolute;
    top: 14px;
    right: 14px;
    color: #fff;
  }
  .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    padding: 14px 8px;
    color: var(--text-1);
    background: rgba(16, 16, 16, 0.55);
    border-radius: var(--r-md);
  }
  .nav:hover {
    background: rgba(16, 16, 16, 0.85);
  }
  .nav.prev {
    left: 14px;
  }
  .nav.next {
    right: 14px;
  }
  .caption {
    position: absolute;
    bottom: 18px;
    left: 50%;
    max-width: calc(100% - 160px);
    overflow: hidden;
    transform: translateX(-50%);
    padding: 4px 12px;
    border-radius: var(--r-sm);
    background: rgba(16, 16, 16, 0.75);
    color: var(--text-2);
    font-size: var(--fs-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    color: var(--text-3);
  }
</style>
