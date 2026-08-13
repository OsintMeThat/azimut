<script>
  import { entityIcon } from '../lib/entityIcon.js';
  import { relationReading } from '../lib/relations.svelte.js';
  import Icon from './Icon.svelte';

  let { relations = [], onwalk = null } = $props();
</script>

{#if relations.length}
  <div class="claims">
    {#each relations as row (row.link.id)}
      <button class="claim" onclick={() => onwalk?.(row.entity)}>
        <Icon name={entityIcon(row.entity)} size={12} />
        <span class="name">{row.entity.label}</span>
        <small>{relationReading(row.link.type, row.direction)}</small>
      </button>
    {/each}
  </div>
{/if}

<style>
  .claims {
    display: grid;
    gap: 2px;
  }
  .claim {
    display: flex;
    align-items: center;
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
  .claim:hover {
    background: var(--bg-2);
    color: var(--text-1);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small {
    color: var(--text-3);
    font-size: 10px;
  }
</style>
