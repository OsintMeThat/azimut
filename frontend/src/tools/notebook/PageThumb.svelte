<script>
  /**
   * Page 1 of a template as it prints (`lib/notes/thumbs.js`), drawn once the
   * picture comes into view and kept for the tab's life. Until then, and if it
   * cannot be drawn, a blank sheet holds its place.
   */
  import { templateThumb } from '../../lib/notes/thumbs.js';

  let { name = '', body = '', look = null, width = 120 } = $props();

  let node = $state(null);
  let seen = $state(false);
  let url = $state('');
  let failed = $state(false);

  $effect(() => {
    if (!node || seen) return;
    if (typeof IntersectionObserver === 'undefined') { seen = true; return; }
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { seen = true; watch.disconnect(); }
    }, { rootMargin: '200px' });
    watch.observe(node);
    return () => watch.disconnect();
  });

  $effect(() => {
    if (!seen) return;
    const wanted = { name, body, look };
    let live = true;
    failed = false;
    templateThumb(wanted)
      .then((picture) => { if (live) url = picture; })
      .catch(() => { if (live) failed = true; });
    return () => { live = false; };
  });
</script>

<span class="thumb" class:failed bind:this={node} style:width={`${width}px`} aria-hidden="true"
  title={failed ? 'The first page could not be drawn' : undefined}>
  {#if url}<img src={url} alt="" draggable="false" />{:else}<span class="lines"></span>{/if}
</span>

<style>
  .thumb {
    position: relative; display: block; flex: none; aspect-ratio: 210 / 297; overflow: hidden; border-radius: 2px; background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, .35), 0 0 0 1px rgba(0, 0, 0, .12);
  }
  .thumb img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
  /* a sheet still being drawn: faint lines where the words will be */
  .lines {
    position: absolute; inset: 14% 14% 30%;
    background: repeating-linear-gradient(to bottom, #e6e6e6 0 3px, transparent 3px 9px);
    opacity: .7;
  }
  .failed .lines { opacity: .3; }
</style>
