<script>
  /**
   * The work already done in the case, put on the plate from Add › From the case,
   * read when the panel opens and never before.
   *
   * - **Comparison**: each pair saved in Compare, its picture and its two days. A
   *   press lays it as two live maps side by side, each on its side's ground and day
   *   (`lib/plate/fromCompare.js`); **Picture** sets the newest image kept from it
   *   instead, which keeps Compare's marks and highlights. **Open in Compare** goes
   *   back to it.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import { api } from '../../lib/api.js';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { momentLabel } from '../../lib/map/layerHistory.js';
  import { openComparison } from '../../lib/navigate.js';

  let {
    anchor = null,
    caseId = '',
    /** How many more maps the plate holds, since a pair takes two. */
    room = 8,
    /** `(row, how)`: a comparison of the saved index laid as 'maps' or as its kept 'picture'. */
    onpick,
    onclose,
  } = $props();

  let rows = $state(null);
  let failed = $state('');

  $effect(() => {
    if (!caseId) return;
    let live = true;
    api.get(`/api/cases/${caseId}/satellite/index`).then((list) => {
      if (live) rows = (Array.isArray(list) ? list : []).filter((row) => row.kind === 'comparison' && row.session);
    }, (error) => { if (live) { rows = []; failed = error?.message ?? 'The case could not be read'; } });
    return () => { live = false; };
  });

  const day = (value) => (/^\d{4}-\d{2}-\d{2}/.test(String(value ?? '')) ? momentLabel(String(value).slice(0, 10)) : String(value ?? ''));
  const days = (row) => [row.imagery_a, row.imagery_b].map(day);
  const kept = (row) => (row.kept ?? []).at(-1) ?? null;

  function pick(row, how) {
    onclose?.();
    onpick?.(row, how);
  }
</script>

<FloatingMenu {anchor} width={420} label="From the case" role="dialog" {onclose}>
  <div class="head">
    <h4>Comparisons</h4>
    <span class="hint">Two dates of one place, saved in Compare</span>
  </div>
  {#if rows === null}
    <p class="none">Reading the case…</p>
  {:else if failed}
    <p class="none">{failed}</p>
  {:else if !rows.length}
    <p class="none">No comparison in this case yet. Compare two dates of a place in Compare and save it: it shows here.</p>
  {:else}
    {#if room < 2}<p class="warn">The plate holds eight maps at most: a pair needs two more, so only its picture can go on.</p>{/if}
    <ul class="rows">
      {#each rows as row (row.id)}
        {@const [first, second] = days(row)}
        {@const picture = kept(row)}
        <li>
          <button type="button" class="main" disabled={room < 2} title="Two live maps side by side, each on its side's ground and day"
            onclick={() => pick(row, 'maps')}>
            {#if row.thumbnail}<img src={fileUrl(caseId, row.thumbnail)} alt="" />{:else}<span class="thumb"><Icon name="compare" size={16} /></span>{/if}
            <span class="text">
              <span class="title">{row.title || row.session}</span>
              <span class="days">{first || 'Before'} → {second || 'After'}</span>
            </span>
          </button>
          <button type="button" class="btn btn-xs" disabled={!picture}
            title={picture ? `${picture.title || 'The image'} kept from it, with Compare's marks` : 'No image kept from it yet: Keep one in Compare first'}
            onclick={() => pick(row, 'picture')}><Icon name="image" size={11} /> Picture</button>
          <button type="button" class="open" aria-label={`Open ${row.title || row.session} in Compare`} title="Open it in Compare"
            onclick={() => { onclose?.(); openComparison(row); }}><Icon name="external" size={12} /></button>
        </li>
      {/each}
    </ul>
  {/if}
</FloatingMenu>

<style>
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 6px 4px 6px; }
  h4 { margin: 0; color: var(--text-3); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .hint { color: var(--text-3); font-size: 10.5px; }
  .none { margin: 12px 6px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.45; }
  .warn { margin: 4px 6px 8px; color: var(--warn); font-size: 11px; line-height: 1.4; }
  .rows { display: grid; gap: 3px; margin: 0; padding: 0 2px 2px; list-style: none; }
  .rows li { display: flex; align-items: center; gap: 6px; }
  .main { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 0; padding: 4px; border: 1px solid transparent; border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-1); text-align: left; cursor: pointer; }
  .main:hover:not(:disabled), .main:focus-visible { border-color: var(--accent); background: var(--accent-soft); outline: none; }
  .main:disabled { opacity: .5; cursor: default; }
  img, .thumb { flex: none; width: 56px; height: 36px; border-radius: 3px; object-fit: cover; background: var(--bg-3); }
  .thumb { display: grid; place-items: center; color: var(--text-3); }
  .text { display: grid; min-width: 0; }
  .title { overflow: hidden; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .days { color: var(--text-2); font-size: 11px; font-variant-numeric: tabular-nums; }
  .open { display: grid; flex: none; place-items: center; width: 24px; height: 24px; border-radius: var(--r-sm); color: var(--text-2); cursor: pointer; }
  .open:hover { background: var(--bg-3); color: var(--text-1); }
</style>
