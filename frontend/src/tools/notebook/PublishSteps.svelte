<script>
  /**
   * How to put a web folder on GitHub Pages, step by step: the words the folder's own
   * HOW-TO-PUBLISH.md holds (`lib/githubPagesSetup.js`).
   */
  import { PAGES_CARD, PAGES_INTRO, PAGES_PUBLIC, PAGES_SIGNUP, PAGES_STEPS, PAGES_UPDATE } from '../../lib/githubPagesSetup.js';
</script>

<section class="publish" aria-label="How to publish">
  <p>{PAGES_INTRO}</p>
  <p class="public">{PAGES_PUBLIC}</p>
  <ol>
    {#each PAGES_STEPS as step, index (index)}
      <li>{step}{#if index === 0}{' '}<a href={PAGES_SIGNUP} target="_blank" rel="noopener noreferrer">Sign up</a>{/if}</li>
    {/each}
  </ol>
  <h5>To update it</h5>
  <p>{PAGES_UPDATE}</p>
  <h5>The picture card on X</h5>
  <p>{PAGES_CARD}</p>
</section>

<style>
  .publish {
    max-height: 300px; overflow: auto; margin-top: 8px; padding: 8px 12px; border: 1px solid var(--border);
    border-radius: var(--r-md); background: var(--bg-1); color: var(--text-1); font-size: var(--fs-sm); line-height: 1.45;
  }
  .publish p { margin: 0 0 6px; }
  .public { color: var(--warn); }
  .publish ol { margin: 4px 0 8px; padding-left: 20px; display: flex; flex-direction: column; gap: 5px; }
  .publish h5 { margin: 8px 0 2px; color: var(--text-2); font-size: var(--fs-xs); font-weight: 600; }
</style>
