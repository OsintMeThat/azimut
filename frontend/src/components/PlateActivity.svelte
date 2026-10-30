<script>
  /**
   * The top bar's word on a plate export while it runs, as Detect has its own: the
   * analyst works in another tool and still sees it moving, and one press goes back
   * to the plate.
   */
  import { uiState } from '../lib/state.svelte.js';
  import { exportShare, plateExport } from '../lib/plate/exportRun.svelte.js';

  const share = $derived(exportShare(plateExport));
</script>

{#if plateExport.running}
  <button class="btn btn-ghost btn-sm plate-activity" title={`Exporting ${plateExport.name}${plateExport.said ? `: ${plateExport.said}` : ''}`}
    onclick={() => (uiState.tool = 'plate')}>
    <span class="pulse" aria-hidden="true"></span>
    Plate export{share === null ? '…' : ` ${share}%`}
  </button>
{/if}

<style>
  .plate-activity { gap: 7px; color: var(--accent); font-variant-numeric: tabular-nums; }
  .pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: pulse 1.4s var(--ease) infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
</style>
