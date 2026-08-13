<script>
  import { windowWords } from '../lib/timeline.js';

  let {
    period,
    ontimeline = () => {},
    onmap = () => {},
    onclear = () => {},
  } = $props();

  const words = $derived(windowWords(period?.from, period?.to, 'UTC'));
</script>

<div class="analysis-period" aria-label="Fact-time range">
  <span><strong>Fact time</strong> · {words}</span>
  <button class="as-link" onclick={ontimeline}>Timeline</button>
  <button class="as-link" onclick={onmap}>Map</button>
  <button class="as-link quiet" onclick={onclear}>Clear</button>
</div>

<style>
  .analysis-period {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--accent-soft);
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .analysis-period span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .analysis-period strong {
    color: var(--text-1);
    font-weight: 600;
  }
  .as-link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .as-link:hover {
    text-decoration: underline;
  }
  .quiet {
    color: var(--text-3);
  }
</style>
