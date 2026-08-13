<script>
  import { api } from '../lib/api.js';
  import { fetchAttrFacets } from '../lib/catalog.js';
  import { chipsOf, clearAxis, emptyFilter, normalizeFilter, toGraphQuery } from '../lib/entityFilter.js';
  import {
    entityFamily,
    entityHint,
    entityLabel,
    entityTypes,
    familyReads,
    loadEntityTypes,
  } from '../lib/entityTypes.svelte.js';
  import { TRACK_COLORS, timelineTrack, trackTint } from '../lib/timelineTracks.js';
  import FilterBar from './FilterBar.svelte';

  let { caseId, caseFolders = [], track = null, onsave = () => {}, oncancel = () => {} } = $props();

  let name = $state('');
  let color = $state('');
  let categories = $state(new Set());
  let relation = $state('any');
  let roles = $state(new Set());
  let filter = $state(emptyFilter());
  let summary = $state(null);
  let facets = $state([]);
  let facetState = $state('unasked');
  let fieldsWanted = $state(false);
  let loadedFor = null;
  let facetsFor = null;
  let initialized = false;

  $effect(() => {
    if (initialized) return;
    initialized = true;
    name = track?.label ?? 'New track';
    color = track?.color ?? '';
    categories = new Set(track?.categories ?? ['statement']);
    relation = track?.query?.relation ?? 'any';
    roles = new Set(track?.query?.roles ?? []);
    filter = normalizeFilter(track?.query?.filter ?? emptyFilter());
  });

  loadEntityTypes();
  const families = $derived([
    ...new Set(Object.keys(summary?.by_type ?? {}).map(entityFamily).filter(Boolean)),
  ]);
  const typeOptions = $derived(
    entityTypes().filter((entry) => !filter.families.length || filter.families.includes(entry.family))
  );
  const wantedTypes = $derived(
    filter.types.length ? filter.types
      : filter.families.length ? typeOptions.map((entry) => entry.type) : []
  );
  const queryLabel = $derived(
    chipsOf(filter, {
      type: entityLabel,
      family: (family) => family.charAt(0).toUpperCase() + family.slice(1),
    }).map((chip) => chip.text).join(' · ')
  );

  $effect(() => {
    if (!caseId || loadedFor === caseId) return;
    loadedFor = caseId;
    api.get(`/api/cases/${caseId}/catalog/summary`)
      .then((value) => { if (loadedFor === caseId) summary = value; })
      .catch(() => { if (loadedFor === caseId) summary = null; });
  });

  $effect(() => {
    const key = `${caseId}|${wantedTypes.join(',')}|${fieldsWanted}`;
    if (!caseId) return;
    if (!wantedTypes.length && !fieldsWanted) {
      facets = [];
      facetState = 'unasked';
      return;
    }
    if (facetsFor === key) return;
    facetsFor = key;
    facetState = 'loading';
    fetchAttrFacets(caseId, wantedTypes)
      .then((rows) => {
        if (facetsFor !== key) return;
        facets = rows;
        facetState = 'ready';
        if (filter.attrKey && !rows.some((row) => row.key === filter.attrKey && row.values.length)) {
          filter = clearAxis(filter, 'field');
        }
      })
      .catch(() => {
        if (facetsFor === key) {
          facets = [];
          facetState = 'ready';
        }
      });
  });

  function toggleCategory(category) {
    const next = new Set(categories);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    if (next.size) categories = next;
  }

  function toggleRole(role) {
    const next = new Set(roles);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    roles = next;
  }

  function save() {
    if (!name.trim() || !categories.size) return;
    onsave(timelineTrack({
      ...(track ?? {}),
      label: name.trim(),
      color,
      categories: [...categories],
      query: {
        filter: normalizeFilter(filter),
        terms: toGraphQuery(filter, { types: wantedTypes }),
        label: queryLabel,
        relation,
        roles: [...roles],
      },
    }));
  }
</script>

<section class="track-editor" aria-label={track ? 'Edit timeline track' : 'Add timeline track'}>
  <div class="naming">
    <label class="name">Name<input class="input" bind:value={name} maxlength="80" /></label>
    <!-- Left unset the lane keeps the colours of the categories it holds, which is
         what the legend explains. A colour here tells this reading apart instead. -->
    <fieldset class="tint">
      <legend>Colour</legend>
      <div class="swatches">
        <button
          class="swatch none"
          aria-pressed={!color}
          title="By category"
          onclick={() => (color = '')}
        >Auto</button>
        {#each TRACK_COLORS as option (option)}
          <button
            class="swatch"
            aria-pressed={color === option}
            aria-label={option}
            title={option}
            style:background={trackTint(option)}
            onclick={() => (color = option)}
          ></button>
        {/each}
      </div>
    </fieldset>
  </div>

  <fieldset>
    <legend>Timeline entries</legend>
    <div class="checks">
      {#each [['statement', 'Statements'], ['media', 'Media'], ['case_activity', 'Case activity']] as option}
        <label><input type="checkbox" checked={categories.has(option[0])} onchange={() => toggleCategory(option[0])} />{option[1]}</label>
      {/each}
    </div>
  </fieldset>

  <label class="match">Match the Search+ question through
    <select class="input" bind:value={relation}>
      <option value="any">Any connection</option>
      <option value="owner">Entry itself</option>
      <option value="about">Subject</option>
      <option value="place">Place</option>
      <option value="source">Evidence</option>
    </select>
  </label>

  <div class="search-query">
    <span>Search+</span>
    <FilterBar
      bind:filter
      {summary}
      {facets}
      {facetState}
      {families}
      {caseFolders}
      types={typeOptions}
      familyName={(family) => family.charAt(0).toUpperCase() + family.slice(1)}
      typeName={entityLabel}
      familyHint={familyReads}
      typeHint={entityHint}
      onfields={() => (fieldsWanted = true)}
    />
  </div>

  <fieldset>
    <legend>Time role</legend>
    <div class="checks">
      {#each [['occurred', 'Occurred'], ['observed', 'Observed'], ['valid', 'Valid'], ['unset', 'Not set']] as option}
        <label><input type="checkbox" checked={roles.has(option[0])} onchange={() => toggleRole(option[0])} />{option[1]}</label>
      {/each}
    </div>
    <small>Leave all clear to include every role.</small>
  </fieldset>

  <div class="actions">
    <button class="btn" onclick={oncancel}>Cancel</button>
    <button class="btn btn-primary" disabled={!name.trim() || !categories.size} onclick={save}>
      {track ? 'Update track' : 'Add track'}
    </button>
  </div>
</section>

<style>
  .track-editor { display: grid; gap: 15px; }
  .name, .match { display: grid; gap: 5px; color: var(--text-2); font-size: var(--fs-sm); }
  .naming { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 12px; }
  .tint { gap: 6px; padding: 7px 9px; }
  .swatches { display: flex; align-items: center; gap: 5px; }
  .swatch { width: 18px; height: 18px; border: 1px solid var(--border-strong); border-radius: 50%; cursor: pointer; }
  .swatch.none { width: auto; padding: 0 7px; border-radius: 999px; background: var(--bg-2); color: var(--text-3); font-size: 9px; }
  .swatch[aria-pressed='true'] { box-shadow: 0 0 0 2px var(--bg-1), 0 0 0 3px var(--text-1); }
  .swatch.none[aria-pressed='true'] { color: var(--text-1); }
  fieldset { display: grid; gap: 8px; margin: 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-sm); }
  legend, .search-query > span { padding: 0 4px; color: var(--text-2); font-size: var(--fs-xs); font-weight: 650; }
  .checks { display: flex; flex-wrap: wrap; gap: 8px 14px; }
  .checks label { display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); font-size: var(--fs-sm); }
  fieldset small { color: var(--text-3); }
  .search-query { overflow: visible; border: 1px solid var(--border); border-radius: var(--r-sm); }
  .search-query > span { display: block; width: max-content; margin: -7px 0 0 8px; background: var(--bg-1); }
  .search-query :global(.filter-bar) { padding: 10px 12px; border: 0; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
