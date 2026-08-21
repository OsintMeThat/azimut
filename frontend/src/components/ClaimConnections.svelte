<script>
  import { api } from '../lib/api.js';
  import { retractionWarning, saveRelation } from '../lib/relations.svelte.js';
  import { toast } from '../lib/state.svelte.js';
  import { entityIcon } from '../lib/entityIcon.js';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import Icon from './Icon.svelte';
  import RelationPicker from './RelationPicker.svelte';

  let {
    caseId,
    claim,
    relations = [],
    onwalk = null,
    onchanged = null,
  } = $props();

  /**
   * What a statement is made of, in the order it is built: what it is about, where
   * it puts it, what it rests on, what rests on it, and what stands against it.
   *
   * **`cites` is read by direction, and `contradicts` is not.** A citation is not
   * symmetric — this statement resting on that one is a different fact from that one
   * resting on this — so the two readings are two groups, and only the outgoing one
   * takes a source: what rests on this statement is stated from *there*, where the
   * reasoning is being written. Two claims that cannot both hold say so whichever end
   * they were filed from, which is why that group deliberately ignores `direction`
   * the way an ordinary relation list does not.
   */
  const GROUPS = [
    { type: 'about', label: 'Subjects', add: 'Add subject' },
    { type: 'at', label: 'Location', add: 'Add location' },
    { type: 'cites', way: 'out', label: 'Sources', add: 'Add source' },
    {
      type: 'cites',
      way: 'in',
      label: 'Supports',
      hint: 'statements that rest on this one',
    },
    { type: 'contradicts', label: 'Contradictions', add: 'Add contradiction' },
  ];

  let adding = $state(null);
  let busy = $state(false);
  let busyId = $state(null);
  //: The connector waiting on an answer before it is taken back: `{ link, words }`.
  let retracting = $state(null);

  /** A group's rows. `way` narrows to one reading; without it both are listed, which
   *  is what a symmetric verb wants. */
  const rows = (group) =>
    relations.filter(
      (row) => row.link.type === group.type && (!group.way || row.direction === group.way)
    );

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

  /** A connector is a statement too: `about`, `at` and `cites` are what the Claim rests
   *  on, and dropping one is not held anywhere. Asked for in the same words the Details
   *  relations and the Graph's edge use (`retractionWarning`). */
  function askRemove(link) {
    if (busyId) return;
    const words = retractionWarning(link);
    if (words) retracting = { link, words };
    else remove(link);
  }

  async function remove(link) {
    if (busyId) return;
    busyId = link.id;
    retracting = null;
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
  {#each GROUPS as group (`${group.type}:${group.way ?? 'both'}`)}
    {@const items = rows(group)}
    <!-- A reading nobody can add to is worth a heading only once it holds something:
         an empty "Supports" on every statement would be a permanent blank. -->
    {#if group.add || items.length}
    <section class="claim-group">
      <div class="claim-head">
        <h4 title={group.hint ?? ''}>{group.label}</h4>
        {#if group.add}
        <button
          class="btn btn-ghost btn-sm add"
          class:on={adding === group.type}
          onclick={() => (adding = adding === group.type ? null : group.type)}
        >{group.add}</button>
        {/if}
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
                onclick={() => askRemove(row.link)}
              ><Icon name="x" size={12} /></button>
            </div>
          {/each}
        </div>
      {/if}
      {#if group.add && adding === group.type}
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
    {/if}
  {/each}
</div>

{#if retracting}
  <ConfirmDialog
    title={retracting.words.title}
    message={retracting.words.message}
    detail={retracting.words.detail}
    confirmLabel={retracting.words.confirmLabel}
    tone="danger"
    busy={busyId === retracting.link.id}
    onconfirm={() => remove(retracting.link)}
    oncancel={() => (retracting = null)}
  />
{/if}

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
