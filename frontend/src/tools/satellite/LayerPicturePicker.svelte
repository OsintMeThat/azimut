<script>
  /**
   * The picture a feature's card shows: a file, a capture or a proof of the case,
   * the marker keeping its own point (`picture`, `lib/map/layerPicture.js`).
   *
   * With none set, it lists at once the pictures named like the feature (its number
   * on its own, so "#7" is offered "Vehicle 07" and never "17", `suggestion`), else the newest; a
   * search finds any by name. A press, or Enter for the first row, sets one, so a
   * layer of sixty vehicles is linked one press each, the section staying open from
   * one feature to the next. The one set shows small with its name: a press opens it,
   * Change finds another, Remove takes it off.
   */
  import Icon from '../../components/Icon.svelte';
  import { api } from '../../lib/api.js';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { pictureKind, picturesQuery, showable, suggestion } from '../../lib/map/layerPicture.js';

  let {
    caseId,
    /** The feature's key: another feature starts on its own rows. */
    feature = '',
    /** The feature's name, which the first rows are matched to. */
    name = '',
    /** The id set, '' for none. */
    value = '',
    /** What the layer said of it: `{ path, label, type }`. */
    shown = null,
    disabled = false,
    onpick,
    onopen = null,
    /** Stands in for the API in tests. */
    get = api.get,
  } = $props();

  let query = $state('');
  let rows = $state([]);
  let said = $state('');
  let loading = $state(false);
  let active = $state(0);
  let changing = $state(false);
  /** The row last pressed, shown until the layer's answer names it. */
  let picked = $state(null);
  let seq = 0;

  const listing = $derived(!value || changing);
  const current = $derived(picked && picked.id === value
    ? { path: picked.thumb ?? '', label: picked.label ?? '', kind: pictureKind(picked) }
    : value && shown ? { path: shown.path ?? '', label: shown.label ?? '', kind: pictureKind({ type: shown.type }) } : null);

  /** Ask the case for what the field holds: the rows named like the feature, the newest, or the ones found. */
  async function read(term, featureName) {
    const mine = ++seq;
    loading = true;
    try {
      let found = [];
      let heading = '';
      const rule = term ? null : suggestion(featureName);
      if (term) {
        found = (await get(picturesQuery(caseId, term))).items ?? [];
      } else if (rule) {
        const page = await get(picturesQuery(caseId, rule.query, 200));
        found = (page.items ?? []).filter((entity) => rule.keeps(entity.label))
          .sort((first, second) => rule.rank(first.label) - rule.rank(second.label));
        heading = rule.said;
      }
      if (!term && !found.filter(showable).length) {
        found = (await get(picturesQuery(caseId))).items ?? [];
        heading = 'Newest in the case';
      }
      if (mine !== seq) return;
      rows = found.filter(showable).slice(0, 40);
      said = heading;
      active = 0;
    } catch {
      if (mine === seq) rows = [];
    } finally {
      if (mine === seq) loading = false;
    }
  }

  // another feature starts on its own rows, the search emptied
  $effect(() => {
    void feature;
    void caseId;
    query = '';
    changing = false;
    picked = null;
  });

  $effect(() => {
    const term = query.trim();
    const featureName = name;
    if (!caseId || !listing) return;
    const timer = setTimeout(() => read(term, featureName), term ? 180 : 0);
    return () => clearTimeout(timer);
  });

  function pick(entity) {
    if (!entity || disabled) return;
    picked = entity;
    changing = false;
    query = '';
    onpick?.(entity.id);
  }

  function onkeydown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!rows.length) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(rows[active]);
    } else if (event.key === 'Escape' && changing) {
      event.stopPropagation();
      changing = false;
      query = '';
    }
  }

  const thumbOf = (path) => (String(path).startsWith('data:') ? path : fileUrl(caseId, path));
</script>

<div class="picker">
  {#if current}
    <div class="current">
      <button type="button" class="current-picture" title={`Open “${current.label || 'the picture'}”`} disabled={!onopen}
        onclick={() => onopen?.(value)}>
        {#if current.path}<img src={thumbOf(current.path)} alt={current.label} />{:else}<Icon name="image" size={16} />{/if}
      </button>
      <div class="current-text">
        <span class="current-name" dir="auto" title={current.label}>{current.label || 'Untitled'}</span>
        <span class="current-kind">{current.kind} · shown in its card</span>
        <span class="acts">
          {#if !changing}<button type="button" class="text-act" {disabled} onclick={() => (changing = true)}>Change</button>{/if}
          <button type="button" class="text-act" {disabled} onclick={() => { picked = null; changing = false; onpick?.(''); }}>Remove</button>
        </span>
      </div>
    </div>
  {/if}

  {#if listing}
    <div class="find">
      <Icon name="search" size={12} />
      <input type="search" aria-label="Find a picture" placeholder="Find a picture by name" autocomplete="off" spellcheck="false"
        bind:value={query} {onkeydown} />
    </div>
    {#if said && rows.length}<p class="said">{said}</p>{/if}
    <ul class="rows" aria-label="Pictures of the case">
      {#each rows as entity, index (entity.id)}
        <li>
          <button type="button" class:active={index === active} {disabled} title={entity.label}
            onpointerenter={() => (active = index)} onclick={() => pick(entity)}>
            <span class="thumb">
              {#if entity.thumb}<img src={thumbOf(entity.thumb)} alt="" loading="lazy" />{:else}<Icon name="image" size={13} />{/if}
            </span>
            <span class="row-text">
              <span class="row-name" dir="auto">{entity.label || 'Untitled'}</span>
              <small>{pictureKind(entity)}</small>
            </span>
          </button>
        </li>
      {:else}
        <li class="none">{loading ? 'Looking…' : query.trim() ? 'No picture by that name' : 'No picture in the case yet'}</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .picker { display: flex; flex-direction: column; gap: 6px; padding: 2px 0 7px; }
  .current { display: flex; align-items: center; gap: 8px; }
  .current-picture { display: grid; place-items: center; flex: none; width: 84px; height: 56px; padding: 0; border: 1px solid var(--border);
    border-radius: var(--r-sm); background: #000; color: var(--text-3); overflow: hidden; cursor: pointer; }
  .current-picture:hover:not(:disabled) { border-color: var(--accent); }
  .current-picture:disabled { cursor: default; }
  .current-picture img { display: block; width: 100%; height: 100%; object-fit: contain; }
  .current-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .current-name { overflow: hidden; color: var(--text-1); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .current-kind { color: var(--text-3); font-size: 10px; }
  .acts { display: flex; gap: 10px; }
  .text-act { padding: 0; color: var(--text-2); font-size: 10px; cursor: pointer; }
  .text-act:hover:not(:disabled) { color: var(--text-1); text-decoration: underline; }
  .find { display: flex; align-items: center; gap: 6px; height: 26px; padding: 0 7px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-1); color: var(--text-3); }
  .find:focus-within { border-color: var(--accent); }
  .find input { flex: 1; min-width: 0; border: 0; background: none; color: var(--text-1); font: inherit; font-size: var(--fs-xs); outline: none; }
  .said { margin: 0; color: var(--text-3); font-size: 10px; }
  .rows { max-height: 196px; margin: 0; padding: 0; overflow: auto; overscroll-behavior: contain; list-style: none; }
  .rows button { display: grid; grid-template-columns: 48px minmax(0, 1fr); align-items: center; gap: 8px; width: 100%; padding: 3px 4px;
    border-radius: var(--r-sm); color: var(--text-2); text-align: left; cursor: pointer; }
  .rows button.active { background: var(--bg-3); color: var(--text-1); }
  .rows button:disabled { cursor: default; opacity: .6; }
  .thumb { display: grid; place-items: center; width: 48px; height: 32px; border-radius: 3px; background: #000; color: var(--text-3); overflow: hidden; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .row-text { display: grid; min-width: 0; }
  .row-name { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .row-text small { color: var(--text-3); font-size: 10px; }
  .none { padding: 8px 4px; color: var(--text-3); font-size: 10.5px; text-align: center; }
</style>
