<script>
  /**
   * The work already done in the case, put on the plate from Add › From the case. Each
   * section is read when it is first shown, never before, and kept while the panel is open.
   *
   * - **Comparisons**: each pair saved in Compare, its picture and its two days. A
   *   press lays it as two live maps side by side, each on its side's ground and day
   *   (`lib/plate/fromCompare.js`); **Picture** sets the newest image kept from it
   *   instead, which keeps Compare's marks and highlights. **Open in Compare** goes
   *   back to it.
   * - **Geo Proofs**: each proof's picture, set on the page pointing at its point.
   * - **Footage on the map**: what the case collected and placed on the map, a video
   *   played on a slide, a photo set on the page, each pointing at its place. The same
   *   files a right-click on a marker offers, in one list.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import { api } from '../../lib/api.js';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { momentLabel } from '../../lib/map/layerHistory.js';
  import { openComparison } from '../../lib/navigate.js';
  import { linkedMedia } from '../../lib/plate/clip.js';

  let {
    anchor = null,
    caseId = '',
    /** The section shown first: 'comparison', 'proof' or 'media'. */
    what = 'comparison',
    /** How many more maps the plate holds, since a pair takes two. */
    room = 8,
    /** The plate has a map for a picture or a video to point at. */
    mapped = true,
    /** `({ what, row, how })`: a row laid on the page; a comparison as 'maps' or as its kept 'picture'. */
    onpick,
    onclose,
  } = $props();

  const SECTIONS = [
    { id: 'comparison', label: 'Comparisons', hint: 'Two dates of one place, saved in Compare' },
    { id: 'proof', label: 'Geo Proofs', hint: 'Each proof\'s picture, pointing at its place' },
    { id: 'media', label: 'Footage on the map', hint: 'The videos and photos the case placed on the map' },
  ];
  /** What each section reads, and which of its rows it keeps. */
  const READS = {
    comparison: [(id) => `/api/cases/${id}/satellite/index`, (row) => row.kind === 'comparison' && row.session],
    proof: [(id) => `/api/cases/${id}/proofs`, (row) => !!row.png],
    media: [(id) => `/api/cases/${id}/satellite/media`, (row) => !!row.path && !!linkedMedia({ media_path: row.path, media_kind: row.media_kind })],
  };

  // the section shown starts as asked, then follows the tabs
  let shown = $state(null);
  const section = $derived(shown ?? what);
  let read = $state({});
  let failed = $state({});

  $effect(() => {
    const id = section;
    if (!caseId || read[id]) return;
    let live = true;
    const [url, keep] = READS[id];
    api.get(url(caseId)).then((list) => {
      if (live) read = { ...read, [id]: (Array.isArray(list) ? list : []).filter(keep) };
    }, (error) => {
      if (live) { read = { ...read, [id]: [] }; failed = { ...failed, [id]: error?.message ?? 'The case could not be read' }; }
    });
    return () => { live = false; };
  });

  const rows = $derived(read[section] ?? null);
  const day = (value) => (/^\d{4}-\d{2}-\d{2}/.test(String(value ?? '')) ? momentLabel(String(value).slice(0, 10)) : String(value ?? ''));
  const days = (row) => [row.imagery_a, row.imagery_b].map(day);
  const kept = (row) => (row.kept ?? []).at(-1) ?? null;
  const isVideo = (row) => linkedMedia({ media_path: row.path, media_kind: row.media_kind })?.as === 'video';
  const place = (row) => [row.geo?.name, row.country_en].filter(Boolean).join(', ');

  /** The row picked, its section read before the panel closes: a closed panel's props are gone. */
  function pick(row, how = '') {
    const picked = { what: section, row, how };
    onclose?.();
    onpick?.(picked);
  }
</script>

<FloatingMenu {anchor} width={440} label="From the case" role="dialog" {onclose}>
  <div class="tabs" role="tablist" aria-label="From the case">
    {#each SECTIONS as entry (entry.id)}
      <button type="button" role="tab" aria-selected={section === entry.id} class:on={section === entry.id} title={entry.hint}
        onclick={() => (shown = entry.id)}>{entry.label}</button>
    {/each}
  </div>
  {#if rows === null}
    <p class="none">Reading the case…</p>
  {:else if failed[section]}
    <p class="none">{failed[section]}</p>
  {:else if section === 'comparison'}
    {#if !rows.length}
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
                <span class="sub">{first || 'Before'} → {second || 'After'}</span>
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
  {:else if section === 'proof'}
    {#if !rows.length}
      <p class="none">No Geo Proof with a picture in this case yet. A proof saved in Geo Proof shows here.</p>
    {:else}
      {#if !mapped}<p class="warn">No map on the page: the picture goes on without pointing at its place.</p>{/if}
      <ul class="rows">
        {#each rows as row (row.name)}
          <li>
            <button type="button" class="main" title={mapped ? 'Its picture on the page, pointing at its place' : 'Its picture on the page'} onclick={() => pick(row)}>
              {#if row.thumb}<img src={fileUrl(caseId, row.thumb)} alt="" />{:else}<span class="thumb"><Icon name="image" size={16} /></span>{/if}
              <span class="text">
                <span class="title">{row.title || row.name}</span>
                <span class="sub">{[row.when ? day(row.when) : '', row.place].filter(Boolean).join(' · ') || 'No day or place said'}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    {#if !rows.length}
      <p class="none">No footage or photo placed on the map yet. A file placed in Details, or the footage a proof rests on, shows here.</p>
    {:else}
      {#if !mapped}<p class="warn">No map on the page: what goes on does not point at its place.</p>{/if}
      <ul class="rows">
        {#each rows as row (row.key ?? `${row.path}@${row.lat},${row.lon}`)}
          <li>
            <button type="button" class="main" title={isVideo(row) ? 'Plays on a slide of its own, pointing at its place' : 'Set on the page, pointing at its place'}
              onclick={() => pick(row)}>
              {#if row.thumbnail}<img src={fileUrl(caseId, row.thumbnail)} alt="" />{:else}<span class="thumb"><Icon name={isVideo(row) ? 'video' : 'image'} size={16} /></span>{/if}
              <span class="text">
                <span class="title">{row.title || row.path.split('/').pop()}</span>
                <span class="sub">{isVideo(row) ? 'Video, on a slide' : 'Photo'}{place(row) ? ` · ${place(row)}` : ''}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</FloatingMenu>

<style>
  .tabs { display: flex; gap: 2px; margin: 4px 2px 8px; }
  .tabs button { padding: 4px 8px; border-radius: var(--r-sm); color: var(--text-3); font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .06em; cursor: pointer; }
  .tabs button:hover { color: var(--text-1); }
  .tabs button.on { background: var(--bg-3); color: var(--text-1); }
  .none { margin: 12px 6px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.45; }
  .warn { margin: 4px 6px 8px; color: var(--warn); font-size: 11px; line-height: 1.4; }
  .rows { display: grid; gap: 3px; max-height: 360px; margin: 0; padding: 0 2px 2px; overflow-y: auto; list-style: none; }
  .rows li { display: flex; align-items: center; gap: 6px; }
  .main { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 0; padding: 4px; border: 1px solid transparent; border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-1); text-align: left; cursor: pointer; }
  .main:hover:not(:disabled), .main:focus-visible { border-color: var(--accent); background: var(--accent-soft); outline: none; }
  .main:disabled { opacity: .5; cursor: default; }
  img, .thumb { flex: none; width: 56px; height: 36px; border-radius: 3px; object-fit: cover; background: var(--bg-3); }
  .thumb { display: grid; place-items: center; color: var(--text-3); }
  .text { display: grid; min-width: 0; }
  .title { overflow: hidden; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .sub { overflow: hidden; color: var(--text-2); font-size: 11px; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }
  .open { display: grid; flex: none; place-items: center; width: 24px; height: 24px; border-radius: var(--r-sm); color: var(--text-2); cursor: pointer; }
  .open:hover { background: var(--bg-3); color: var(--text-1); }
</style>
