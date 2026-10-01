<script>
  /**
   * A file shown where it is read: the picture, the video ready to play, the sound.
   *
   * What an analyst most often wants from a dated file is to see it, and reaching it
   * used to cost Details, then Info, then the file. This draws it in place from the
   * path the entity already carries, with the thumbnail the list already had as the
   * first frame, and one press opens it full screen. Nothing is made: a file with no
   * picture says what it is and where it lives instead.
   */
  import { fileUrl } from '../lib/fileUrl.js';
  import { mediaKindOf } from '../lib/entityIcon.js';
  import { portal } from '../lib/fullscreen.js';
  import { isTopOverlay, joinOverlays } from '../lib/overlayStack.js';
  import Icon from './Icon.svelte';

  let {
    caseId,
    /** The file, as the case holds it: `attrs.path` is what is drawn. */
    entity = null,
    /** A picture the row already had, shown until the file itself is known. */
    thumb = '',
    /** What the preview is of, for the reader of a screen reader and the tooltip. */
    label = '',
  } = $props();

  const kind = $derived(entity ? (entity.type === 'capture' ? 'image' : mediaKindOf(entity)) : '');
  const path = $derived(entity?.attrs?.path ?? '');
  const source = $derived(caseId && path ? fileUrl(caseId, path) : '');
  const still = $derived(caseId && thumb ? (thumb.startsWith('data:') ? thumb : fileUrl(caseId, thumb)) : '');
  const name = $derived(label || entity?.label || 'File');

  let large = $state(false);
  const self = {};
  $effect(() => (large ? joinOverlays(self) : undefined));
  function onkeydown(event) {
    if (large && event.key === 'Escape' && isTopOverlay(self)) {
      event.preventDefault();
      large = false;
    }
  }
</script>

<svelte:window {onkeydown} />

{#if source || still}
  <figure class="preview">
    {#if source && kind === 'image'}
      <button class="frame" title="Open it full screen" onclick={() => (large = true)}>
        <img src={source} alt={name} loading="lazy" decoding="async" />
      </button>
    {:else if source && kind === 'video'}
      <div class="frame">
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={source} poster={still || undefined} controls preload="metadata"></video>
      </div>
    {:else if source && kind === 'audio'}
      <audio src={source} controls preload="metadata"></audio>
    {:else if still}
      <div class="frame"><img src={still} alt={name} /></div>
    {:else}
      <div class="plain"><Icon name="file" size={16} /><span>{name}</span></div>
    {/if}
    {#if source && (kind === 'image' || kind === 'video')}
      <button class="enlarge" title="Open it full screen" aria-label="Open {name} full screen" onclick={() => (large = true)}>
        <Icon name="maximize" size={13} />
      </button>
    {/if}
  </figure>
{/if}

{#if large}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="stage" use:portal onclick={(event) => event.target === event.currentTarget && (large = false)}>
    <button class="close btn btn-ghost" aria-label="Close" title="Close (Esc)" onclick={() => (large = false)}>
      <Icon name="x" size={20} />
    </button>
    {#if kind === 'video'}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video src={source} controls autoplay></video>
    {:else}
      <img src={source} alt={name} />
    {/if}
    <p class="caption" dir="auto">{name}</p>
  </div>
{/if}

<style>
  .preview {
    position: relative;
    margin: 0 0 14px;
  }
  .frame {
    display: grid;
    place-items: center;
    width: 100%;
    max-height: 260px;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: #0b0b0b;
  }
  button.frame {
    cursor: zoom-in;
  }
  .frame img,
  .frame video {
    display: block;
    width: 100%;
    max-height: 258px;
    object-fit: contain;
  }
  audio {
    width: 100%;
  }
  .plain {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-md);
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .enlarge {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: var(--r-sm);
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    opacity: 0;
    cursor: pointer;
    transition: opacity 120ms var(--ease);
  }
  .preview:hover .enlarge,
  .enlarge:focus-visible {
    opacity: 1;
  }
  .stage {
    position: fixed;
    inset: 0;
    z-index: 980;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 40px;
    background: rgba(4, 7, 12, 0.94);
  }
  .stage img,
  .stage video {
    max-width: 100%;
    max-height: calc(100vh - 120px);
    object-fit: contain;
  }
  .stage .close {
    position: absolute;
    top: 14px;
    right: 14px;
    color: #fff;
  }
  .caption {
    margin: 0;
    color: #cfcfcf;
    font-size: var(--fs-sm);
  }
</style>
