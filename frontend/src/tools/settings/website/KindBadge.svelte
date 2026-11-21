<script>
  /** What a card of the site is: an article, a map, a page or unlisted. */
  import { KIND_LABEL } from '../../../lib/websiteHub.js';

  let { kind } = $props();
</script>

<span class="kind {kind}">{KIND_LABEL[kind] ?? kind}</span>

<style>
  .kind { display: inline-block; justify-self: start; padding: 1px 6px; border-radius: 3px; font-size: 0.66rem; font-weight: 600;
    letter-spacing: 0.04em; text-transform: uppercase; background: var(--bg-3); color: var(--text-2); }
  .article { background: var(--info-soft); color: var(--info); }
  .map { background: var(--ok-soft); color: var(--ok); }
  .page { background: color-mix(in srgb, var(--internal) 16%, transparent); color: var(--internal); }
  .unlisted { background: var(--bg-3); color: var(--text-2); }
</style>
