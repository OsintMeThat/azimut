<script>
  /**
   * What each row colour means in this sheet.
   *
   * Six colours and no legend is six colours whose meaning lives in one analyst's head:
   * yellow was "check the timestamp again" on Monday and "asked the source" by Thursday, and
   * a case is handed over. The colours were the one annotation in the grid that said nothing
   * about itself.
   *
   * Only the colours actually used are worth naming, so the ones in the sheet come first and
   * carry their count; the rest are there to be started. Kept in the sidecar beside the
   * colours themselves — losing both together costs presentation and never a finding, which
   * is the deal the sidecar is under.
   */
  import { ROW_COLOURS } from '../lib/sheet.js';

  let { meta, counts = {}, onlabel } = $props();

  const rows = $derived(
    [...ROW_COLOURS].sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0)),
  );
</script>

<div class="legend-menu">
  <p class="head">What the colours mean</p>
  {#each rows as colour (colour)}
    <div class="line">
      <span class="swatch c-{colour}"></span>
      <input class="input" value={meta?.legend?.[colour] ?? ''}
             placeholder={counts[colour] ? 'what it marks' : 'unused'}
             aria-label="What {colour} means"
             onkeydown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
             onblur={(event) => onlabel(colour, event.currentTarget.value)} />
      <small>{counts[colour] ?? 0}</small>
    </div>
  {/each}
  <p class="note">Saved next to the sheet, not in the CSV.</p>
</div>

<style>
  .legend-menu {
    position: absolute; z-index: 8; top: calc(100% + 4px); right: 0; width: 300px;
    padding: 7px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-1); box-shadow: 0 12px 30px #0004;
  }
  .head { padding: 1px 3px 6px; color: var(--text-3); font-size: var(--fs-xs); }
  .line { display: flex; align-items: center; gap: 7px; padding: 2px 0; }
  /* The same swatch the bar and the gutter menu draw. `.c-*` is global and sets `--mark`. */
  .swatch {
    flex: none; width: 14px; height: 14px; border-radius: var(--r-sm);
    border: 1px solid var(--border-strong); background: var(--mark, var(--bg-3));
  }
  .line .input { flex: 1; min-width: 0; font-size: var(--fs-xs); padding: 2px 6px; }
  .line small { flex: none; width: 26px; text-align: right; color: var(--text-3); font-size: var(--fs-xs); }
  .note { padding: 7px 3px 1px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
</style>
