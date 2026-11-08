<script>
  /**
   * The starts a new proof template is picked from, each shown as the sample proof
   * set in its style. A press opens the editor on a copy; nothing is stored until
   * the template is saved.
   */
  import { onMount } from 'svelte';
  import { PROOF_STARTERS } from '../lib/proofTemplates.js';
  import { signatureLogo, stillOf } from './ProofStylePreview.svelte';

  let { onpick } = $props();

  // starter id → { url, aspect } once drawn
  let stills = $state({});

  onMount(() => {
    let alive = true;
    // one after the other: six pages at once would be six canvases held together
    (async () => {
      const logo = await signatureLogo();
      for (const starter of PROOF_STARTERS) {
        try {
          const still = await stillOf(starter.data, { width: 420, legend: starter.legend, logo });
          if (!alive) return;
          stills[starter.id] = still;
        } catch {
          // a card without its picture still names its start
        }
      }
    })();
    return () => { alive = false; };
  });
</script>

<div class="pts" role="group" aria-label="Starts">
  {#each PROOF_STARTERS as starter (starter.id)}
    {@const still = stills[starter.id]}
    <button type="button" class="pts-card" data-starter={starter.id} onclick={() => onpick(starter)}>
      <span class="pts-stage">
        {#if still}
          <img src={still.url} alt="" style:aspect-ratio={still.aspect} />
        {:else}
          <span class="pts-wait" style:background={starter.data.bg}></span>
        {/if}
      </span>
      <span class="pts-words">
        <span class="pts-name">{starter.name}</span>
        <span class="pts-said">{starter.said}</span>
      </span>
    </button>
  {/each}
</div>

<style>
  .pts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 14px;
  }
  .pts-card {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 0;
    text-align: left;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md, 8px);
    overflow: hidden;
    cursor: pointer;
    color: inherit;
    font: inherit;
    transition: border-color 0.12s var(--ease, ease), transform 0.12s var(--ease, ease), box-shadow 0.12s var(--ease, ease);
  }
  .pts-card:hover {
    border-color: var(--accent);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
    transform: translateY(-1px);
  }
  .pts-card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  /* a fixed stage, so every card is one height whatever its page's shape */
  .pts-stage {
    height: 150px;
    display: grid;
    place-items: center;
    padding: 12px;
    background:
      radial-gradient(circle at 1px 1px, rgba(148, 163, 196, 0.08) 1px, transparent 0) 0 0 / 14px 14px,
      var(--bg-0);
    border-bottom: 1px solid var(--border);
  }
  .pts-stage img {
    display: block;
    max-width: 100%;
    max-height: 126px;
    width: auto;
    height: auto;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25), 0 6px 16px rgba(0, 0, 0, 0.25);
  }
  .pts-wait {
    width: 70%;
    height: 70%;
    border-radius: 2px;
    opacity: 0.6;
    box-shadow: 0 0 0 1px var(--border);
  }
  .pts-words {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 9px 12px 11px;
  }
  .pts-name {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-1);
  }
  .pts-said {
    font-size: var(--fs-xs);
    color: var(--text-3);
    line-height: 1.4;
  }
</style>
