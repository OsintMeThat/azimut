<script>
  /**
   * What the Azimut mark shows on a proof: the logo and the name, the logo alone, or
   * the name alone. Each choice is drawn as what it puts on the page, with the app's
   * own logo and wordmark, so it reads without words; its name is said on hover and
   * to a screen reader. The template editor and Geo Proof's Style tab both use it.
   */
  import { MARK_SHOWS } from '../lib/composer.js';
  import Logo from './Logo.svelte';
  import Wordmark from './Wordmark.svelte';

  let { value = 'both', onchange, title = '' } = $props();
</script>

<div class="msc" role="radiogroup" aria-label="What the mark shows" {title}>
  {#each MARK_SHOWS as one (one.id)}
    <button type="button" role="radio" aria-checked={value === one.id} aria-label={one.label} title={one.label}
      class:on={value === one.id} onclick={() => onchange(one.id)}>
      {#if one.id !== 'name'}<Logo size={16} />{/if}
      {#if one.id !== 'logo'}<Wordmark height={one.id === 'name' ? 10 : 7} />{/if}
    </button>
  {/each}
</div>

<style>
  .msc {
    display: grid;
    grid-template-columns: 1.4fr 1fr 1fr;
    gap: 4px;
    margin: 2px 0 6px;
  }
  .msc button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    height: 28px;
    padding: 0 6px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm, 4px);
    cursor: pointer;
    opacity: 0.75;
  }
  .msc button:hover { opacity: 1; }
  .msc button.on {
    opacity: 1;
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .msc button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
