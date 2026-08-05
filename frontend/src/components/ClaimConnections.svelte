<script>
  import { api } from '../lib/api.js';
  import { saveRelation } from '../lib/relations.svelte.js';
  import { toast } from '../lib/state.svelte.js';
  import { entityIcon } from '../lib/entityIcon.js';
  import Icon from './Icon.svelte';
  import RelationPicker from './RelationPicker.svelte';

  let {
    caseId,
    claim,
    relations = [],
    onwalk = null,
    onchanged = null,
  } = $props();

  const GROUPS = [
    { type: 'about', label: 'Subjects', add: 'Add subject' },
    { type: 'at', label: 'Location', add: 'Add location' },
    { type: 'cites', label: 'Sources', add: 'Add source' },
  ];

  let adding = $state(null);
  let busy = $state(false);
  let busyId = $state(null);

  const rows = (type) => relations.filter((row) => row.link.type === type);

  async function add(choice) {
    if (busy) return;
    busy = true;
    try {
      await saveRelation(caseId, claim.id, choice);
      adding = null;
      await onchanged?.();
    } catch (error) {
      toast(error.message, 'danger');
      throw error;
    } finally {
      busy = false;
    }
  }

  async function remove(link) {
    if (busyId) return;
    busyId = link.id;
    try {
      await api.del(`/api/cases/${caseId}/links/${link.id}`);
      await onchanged?.();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      busyId = null;
    }
  }
</script>

<div class="claim-connections">
  {#each GROUPS as group (group.type)}
    {@const items = rows(group.type)}
    <section class="claim-group">
      <div class="claim-head">
        <h4>{group.label}</h4>
        <button
          class="btn btn-ghost btn-sm add"
          class:on={adding === group.type}
          onclick={() => (adding = adding === group.type ? null : group.type)}
        >{group.add}</button>
      </div>
      {#if items.length}
        <div class="claim-items">
          {#each items as row (row.link.id)}
            <div class="claim-item">
              <button class="claim-target" onclick={() => onwalk?.(row.entity)}>
                <Icon name={entityIcon(row.entity)} size={12} />
                <span>{row.entity.label}</span>
              </button>
              <button
                class="btn btn-ghost btn-sm remove"
                title="Remove"
                disabled={busyId === row.link.id}
                onclick={() => remove(row.link)}
              ><Icon name="x" size={12} /></button>
            </div>
          {/each}
        </div>
      {/if}
      {#if adding === group.type}
        <RelationPicker
          subjectType="claim"
          subject={claim}
          subjectId={claim.id}
          action="claim"
          relationType={group.type}
          expanded
          {busy}
          oncommit={add}
          oncancel={() => (adding = null)}
        />
      {/if}
    </section>
  {/each}
</div>

<style>
  .claim-connections {
    display: grid;
    gap: 10px;
  }
  .claim-group {
    min-width: 0;
  }
  .claim-head,
  .claim-item,
  .claim-target {
    display: flex;
    align-items: center;
  }
  .claim-head {
    justify-content: space-between;
    gap: 8px;
    min-height: 28px;
  }
  h4 {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .add {
    color: var(--text-3);
  }
  .add.on {
    color: var(--accent);
  }
  .claim-items {
    display: grid;
    gap: 2px;
  }
  .claim-item {
    gap: 2px;
    min-width: 0;
  }
  .claim-target {
    flex: 1;
    gap: 7px;
    min-width: 0;
    padding: 5px 6px;
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }
  .claim-target:hover {
    background: var(--bg-2);
    color: var(--text-1);
  }
  .claim-target span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .remove {
    color: var(--text-3);
  }
  .remove:hover {
    color: var(--danger);
  }
</style>
