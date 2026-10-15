<script>
  /**
   * A step's video on the page: held on the clip's first frame while the plate is
   * edited, run from its start to its end while the plate plays, with its sound
   * when it is asked for. It stands under the page's writing, so the frame and the
   * source line drawn over it stay on top, as the export lays them.
   */
  import { PX_PER_MM } from '../../lib/plate/page.js';
  import { clipRange } from '../../lib/plate/clip.js';
  import { fileUrl } from '../../lib/fileUrl.js';

  let {
    element,
    caseId = '',
    /** The plate is playing this step: the clip runs. */
    running = false,
    /** How fast the plate plays. */
    speed = 1,
  } = $props();

  let video = $state();
  const range = $derived(clipRange(element));
  const url = $derived(element.src ? fileUrl(caseId, element.src) : '');

  // still on its first frame while edited, run from there once when the play reaches it
  let ran = false;
  $effect(() => {
    if (!video || !url) return;
    const [start] = range;
    video.muted = !(running && element.sound);
    video.volume = Math.min(1, element.volume ?? 1);
    video.playbackRate = speed;
    if (running && !ran) {
      video.currentTime = start;
      video.play().catch(() => { /* a browser refusing to play leaves the still */ });
    } else if (!running) {
      video.pause();
      if (Math.abs(video.currentTime - start) > 0.05) video.currentTime = start;
    }
    ran = running;
  });

  function timeupdate() {
    if (video && video.currentTime >= range[1]) video.pause();
  }
</script>

{#if url}
  <!-- svelte-ignore a11y_media_has_caption -->
  <video class="plate-video" bind:this={video} src={url} preload="auto" playsinline muted ontimeupdate={timeupdate}
    style:left="{element.box[0] * PX_PER_MM}px" style:top="{element.box[1] * PX_PER_MM}px"
    style:width="{element.box[2] * PX_PER_MM}px" style:height="{element.box[3] * PX_PER_MM}px"
    style:object-fit={element.fit === 'cover' ? 'cover' : 'contain'} style:opacity={element.opacity ?? 1}></video>
{/if}

<style>
  .plate-video { position: absolute; z-index: 1; background: #000; pointer-events: none; }
</style>
