<script>
  /** What a card of the site is: an article, a map, a page or unlisted, each in a colour of its own. */
  import { KIND_LABEL } from '../../../lib/websiteSetup.js';

  let { kind } = $props();
</script>

<span class="kind {kind}">{KIND_LABEL[kind] ?? kind}</span>

<style>
  .kind { display: inline-block; justify-self: start; padding: 1px 6px; border-radius: 3px; background: var(--bg-3); color: var(--text-2);
    font-size: 0.66rem; font-weight: 600; line-height: 1.5; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; }
  .article { background: var(--info-soft); color: var(--info); }
  .map { background: var(--ok-soft); color: var(--ok); }
  .page { background: color-mix(in srgb, var(--internal) 15%, transparent); color: var(--internal); }
  .unlisted { background: var(--bg-3); color: var(--text-2); }
</style>
