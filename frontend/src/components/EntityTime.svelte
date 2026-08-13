<script>
  /** Entity-scoped temporal history. Mounted only while the Time tab is open. */
  import { api } from '../lib/api.js';
  import { formatTemporalValue } from '../lib/timeline.js';
  import { reloadCase, toast, uiState } from '../lib/state.svelte.js';
  import Icon from './Icon.svelte';
  import TemporalClaimEditor from './TemporalClaimEditor.svelte';

  let { caseId, entity, onclose } = $props();

  let items = $state([]);
  let cursor = $state(null);
  let loading = $state(true);
  let editor = $state(null); // null, 'new', or a statement item
  let seq = 0;

  const dated = $derived(items.filter((item) => item.earliest));
  const unplaced = $derived(items.filter((item) => !item.earliest && item.raw));
  const undated = $derived(items.filter((item) => !item.earliest && !item.raw));
  const ownStatement = $derived(
    entity.type === 'claim'
      ? items.find((item) => item.category === 'statement' && item.owner_id === entity.id) ?? null
      : null
  );
  const statements = $derived(
    dated.filter((item) => item.category === 'statement' && item.owner_id !== ownStatement?.owner_id)
  );
  const about = $derived(statements.filter((item) => item.subjects.includes(entity.id)));
  const placed = $derived(statements.filter((item) => item.places.includes(entity.id) && !about.includes(item)));
  const evidence = $derived(statements.filter((item) => item.sources.includes(entity.id) && !about.includes(item) && !placed.includes(item)));
  const media = $derived(dated.filter((item) => item.category === 'media'));
  const activity = $derived(dated.filter((item) => item.category === 'case_activity'));
  const visibleUnplaced = $derived(unplaced.filter((item) => item.id !== ownStatement?.id));
  const visibleUndated = $derived(undated.filter((item) => item.id !== ownStatement?.id));
  const visibleCount = $derived(
    about.length + placed.length + evidence.length + media.length + activity.length
      + visibleUnplaced.length + visibleUndated.length + (ownStatement?.raw ? 1 : 0)
  );
  const assessmentLabel = $derived(
    entity.type === 'claim'
      ? ownStatement?.raw ? 'Edit statement date' : 'Set statement date'
      : entity.type === 'media' ? 'Add capture assessment' : 'Add time assessment'
  );

  async function load({ more = false } = {}) {
    if (!caseId) return;
    const mine = ++seq;
    loading = true;
    try {
      const params = new URLSearchParams({ entity: entity.id, include_undated: 'true', limit: '100' });
      for (const category of ['statement', 'media', 'case_activity']) params.append('category', category);
      if (more && cursor) params.set('cursor', cursor);
      const page = await api.get(`/api/cases/${caseId}/timeline?${params}`);
      if (mine !== seq) return;
      items = more ? [...items, ...(page.items ?? [])] : page.items ?? [];
      cursor = page.next_cursor ?? null;
    } catch (error) {
      if (mine === seq) toast(error.message, 'danger');
    } finally {
      if (mine === seq) loading = false;
    }
  }

  $effect(() => {
    entity.id;
    items = [];
    cursor = null;
    void load();
  });

  function newAssessment() {
    editor = entity.type === 'claim'
      ? ownStatement ?? {
          id: `temporal:claim:${entity.id}`,
          owner_id: entity.id,
          category: 'statement',
          kind: 'claim',
          label: entity.label,
          raw: entity.attrs?.when ?? null,
        }
      : 'new';
  }

  async function saved() {
    editor = null;
    await reloadCase();
    await load();
  }

  function openTimeline(item = null) {
    uiState.timelineFocus = { entityId: entity.id, entityLabel: entity.label, itemId: item?.id ?? null };
    uiState.tool = 'timeline';
    onclose?.();
  }

  function kindLabel(item) {
    return {
      captured: 'Captured', published: 'Published', imagery: 'Imagery',
      collected: 'Collected', added: 'Added to case', filed: 'Filed in case', claim: 'Assessment',
    }[item.kind] ?? item.kind;
  }

  function timeLabel(item) {
    return formatTemporalValue(item.raw ?? '').label;
  }
</script>

{#snippet row(item, editable = false)}
  <div class="time-row">
    <button class="time-row-main" aria-label={`Open ${item.label} in Timeline`} onclick={() => openTimeline(item)}>
      <span class={`time-mark ${item.category}`}></span>
      <span class="time-copy">
        <strong>{item.label}</strong>
        <small>{kindLabel(item)}{#if item.time_role} · {item.time_role}{/if}{#if item.confidence} · {item.confidence}{/if}</small>
      </span>
      <span class="time-value" class:undated={!item.raw} title={item.raw || undefined}>{timeLabel(item)}</span>
    </button>
    {#if editable}
      <button class="time-row-action" aria-label={`Edit ${item.label}`} title="Edit assessment" onclick={() => (editor = item)}><Icon name="edit" size={12} /></button>
    {/if}
  </div>
{/snippet}

<div class="entity-time">
  <div class="time-actions">
    <button class="btn btn-primary btn-sm" onclick={newAssessment}><Icon name="plus" size={12} />{assessmentLabel}</button>
    <button class="btn btn-ghost btn-sm" onclick={() => openTimeline()}><Icon name="clock" size={12} />Open in Timeline</button>
  </div>
  {#if entity.type === 'claim'}
    <p class="claim-time-rule">A statement has one date or range. Use another statement for a separate assessment.</p>
  {/if}

  {#if editor}
    <section
      class="time-editor"
      aria-label={entity.type === 'claim' ? assessmentLabel : editor === 'new' ? assessmentLabel : 'Edit time assessment'}
    >
      <header>
        <h3>{entity.type === 'claim' ? assessmentLabel : editor === 'new' ? assessmentLabel : 'Edit time assessment'}</h3>
        <button class="btn btn-ghost btn-sm" aria-label="Close editor" onclick={() => (editor = null)}>
          <Icon name="x" size={13} />
        </button>
      </header>
      <!-- Keyed on what is being edited: the editor seeds itself once, so
           reusing the instance would open a new assessment already holding the
           statement, date and connectors of the one edited before it. -->
      {#key editor}
        <TemporalClaimEditor
          {caseId}
          item={editor === 'new' ? null : editor}
          subject={editor === 'new' ? entity : null}
          initialStatement={entity.type === 'media' ? 'This media was captured' : ''}
          initialRole={entity.type === 'media' ? 'observed' : ''}
          onsaved={saved}
          oncancel={() => (editor = null)}
        />
      {/key}
    </section>
  {/if}

  {#if loading && !items.length}
    <div class="time-empty">Loading time history…</div>
  {:else}
    {#if ownStatement?.raw}
      <section><h3>Statement date <span>1</span></h3>{@render row(ownStatement, true)}</section>
    {:else if entity.type === 'claim'}
      <div class="time-empty compact"><Icon name="clock" size={18} /><p>This statement has no date yet.</p></div>
    {/if}
    {#if about.length}
      <section><h3>Statements about this <span>{about.length}</span></h3>{#each about as item (item.id)}{@render row(item, true)}{/each}</section>
    {/if}
    {#if placed.length}
      <section><h3>Statements placed here <span>{placed.length}</span></h3>{#each placed as item (item.id)}{@render row(item, true)}{/each}</section>
    {/if}
    {#if evidence.length}
      <section>
        <h3>Evidence for <span>{evidence.length}</span></h3>
        <p class="section-note">These dates belong to statements this item supports.</p>
        {#each evidence as item (item.id)}{@render row(item, true)}{/each}
      </section>
    {/if}
    {#if media.length}
      <section><h3>Media dates <span>{media.length}</span></h3>{#each media as item (item.id)}{@render row(item)}{/each}</section>
    {/if}
    {#if activity.length}
      <details class="activity"><summary>Case activity <span>{activity.length}</span></summary>{#each activity as item (item.id)}{@render row(item)}{/each}</details>
    {/if}
    {#if visibleUnplaced.length}
      <section class="unplaced"><h3>Not on UTC axis <span>{visibleUnplaced.length}</span></h3><p class="section-note">Add a timezone or correct the value.</p>{#each visibleUnplaced as item (item.id)}{@render row(item, item.category === 'statement')}{/each}</section>
    {/if}
    {#if visibleUndated.length}
      <section class="undated"><h3>Undated <span>{visibleUndated.length}</span></h3>{#each visibleUndated as item (item.id)}{@render row(item, item.category === 'statement')}{/each}</section>
    {/if}
    {#if !visibleCount && entity.type !== 'claim'}
      <div class="time-empty"><Icon name="clock" size={18} /><p>No dates or time assessments yet.</p></div>
    {/if}
    {#if cursor}<button class="btn btn-ghost btn-sm more" disabled={loading} onclick={() => load({ more: true })}>{loading ? 'Loading…' : 'Show more'}</button>{/if}
  {/if}
</div>

<style>
  .entity-time { display: grid; gap: 14px; padding-top: 2px; }
  .time-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .claim-time-rule { margin: -7px 0 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.4; }
  section { display: grid; gap: 5px; }
  h3 { display: flex; justify-content: space-between; gap: 8px; margin: 0 0 2px; font-size: var(--fs-sm); color: var(--text-2); }
  h3 span { color: var(--text-3); font-size: var(--fs-xs); font-weight: 400; }
  .section-note { margin: -1px 0 3px; color: var(--text-3); font-size: var(--fs-xs); }
  .time-row {
    width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto;
    align-items: stretch; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-2); overflow: hidden;
  }
  .time-row:hover { border-color: var(--border-strong); background: var(--bg-3); }
  .time-row-main {
    min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center; gap: 8px; padding: 8px 7px 8px 9px; border: 0;
    background: none; color: inherit; text-align: left; cursor: pointer;
  }
  .time-row-action {
    width: 34px; display: grid; place-items: center; border: 0; border-left: 1px solid var(--border);
    background: none; color: var(--text-3); cursor: pointer;
  }
  .time-row-action:hover { background: color-mix(in srgb, var(--accent) 9%, transparent); color: var(--accent); }
  .time-mark { width: 8px; height: 8px; border-radius: 50%; background: var(--timeline-media); box-shadow: 0 0 0 3px color-mix(in srgb, var(--timeline-media) 14%, transparent); }
  .time-mark.statement { background: var(--timeline-statement); box-shadow: 0 0 0 3px color-mix(in srgb, var(--timeline-statement) 14%, transparent); }
  .time-mark.media { border-radius: 2px; }
  .time-mark.case_activity { background: var(--timeline-activity); box-shadow: 0 0 0 3px color-mix(in srgb, var(--timeline-activity) 14%, transparent); }
  .time-copy { display: grid; min-width: 0; }
  .time-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-sm); }
  .time-copy small { color: var(--text-3); text-transform: capitalize; }
  .time-value { max-width: 210px; overflow: hidden; color: var(--text-2); font-size: var(--fs-xs); text-overflow: ellipsis; white-space: nowrap; }
  .time-value.undated { color: var(--warn); }
  .time-editor { padding: 10px; border: 1px solid var(--border-strong); border-radius: var(--r-md); background: var(--bg-1); }
  .time-editor > header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; }
  .time-editor > header h3 { margin: 0; color: var(--text-1); }
  .activity { border-top: 1px solid var(--border); padding-top: 9px; }
  .activity summary { cursor: pointer; color: var(--text-3); font-weight: 600; }
  .activity summary span { margin-left: 4px; font-weight: 400; }
  .activity[open] { display: grid; gap: 5px; }
  .unplaced, .undated { padding-top: 9px; border-top: 1px solid var(--border); }
  .time-empty { display: grid; justify-items: center; gap: 5px; padding: 20px 10px; color: var(--text-3); text-align: center; }
  .time-empty p { margin: 0; }
  .time-empty.compact { padding: 13px 10px; border: 1px dashed var(--border); border-radius: var(--r-sm); }
  .more { justify-self: center; }
  @media (max-width: 520px) {
    .time-row-main { grid-template-columns: auto minmax(0, 1fr); }
    .time-value { grid-column: 2; }
  }
</style>
