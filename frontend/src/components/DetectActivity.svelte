<script>
  /**
   * The top bar's word on Detect while a run is queued or running in the open
   * case. It is there so a sweep can be left to work: the analyst goes back to
   * any other tool and still sees it moving, and one press returns to it.
   */
  import { caseState } from '../lib/state.svelte.js';
  import { detectRuns, openDetect, refreshRuns } from '../lib/detectRuns.svelte.js';
  import { isActive, plural } from '../lib/map/detections.js';

  const active = $derived(
    detectRuns.caseId && detectRuns.caseId === caseState.current?.id ? detectRuns.rows.filter(isActive) : []
  );
  const running = $derived(active.find((row) => row.status === 'running'));
  const share = $derived(running?.total ? Math.round((100 * (running.progress ?? 0)) / running.total) : 0);
  const label = $derived(running ? `Detect ${share}%` : 'Detect queued');
  const title = $derived(active.map((row) => row.title).join(', '));

  // A case opened with runs still queued, say after a reload, is found here.
  $effect(() => {
    void refreshRuns(caseState.current?.id ?? null).catch(() => {});
  });
</script>

{#if active.length}
  <button
    class="btn btn-ghost btn-sm detect-activity"
    title={`${plural(active.length, 'detection')} working: ${title}`}
    onclick={() => openDetect(`runs-${(running ?? active[0]).id}`)}
  >
    <span class="pulse" aria-hidden="true"></span>
    {label}{active.length > 1 ? ` · ${active.length}` : ''}
  </button>
{/if}

<style>
  .detect-activity {
    gap: 7px;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.4s var(--ease) infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse { animation: none; }
  }
</style>
