<script>
  // What a delete touches, asked of the server and drawn the same way in every
  // dialog that deletes (`lib/deleteImpact.js`): what goes with the target, what
  // stays behind scarred, what loses its link to it. `ConfirmDialog` holds it for
  // most tools; a tool with its own dialog places it there.
  //   target: { caseId, ids?: [id], paths?: [path], named?: [{ tool, name }] }
  // `reaching` is true while the answer is on its way, so the dialog can hold its
  // confirm button until the analyst has seen it; `blocked` while the answer says the
  // delete would be refused.
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import {
    fetchImpact,
    impactBlocked,
    impactGroups,
    impactHow,
    impactKey,
    impactLead,
    impactUnknown,
    targetCount,
  } from '../lib/deleteImpact.js';

  let { target = null, reaching = $bindable(false), blocked = $bindable(false) } = $props();

  // Keyed on what the target names rather than on the object, so a parent drawing
  // the same target again does not ask again.
  const askKey = $derived(impactKey(target));
  const it = $derived(targetCount(target) > 1 ? 'them' : 'it');
  let reach = $state(null);
  let failed = $state(false);

  $effect(() => {
    if (!askKey) {
      reach = null;
      failed = false;
      reaching = false;
      return;
    }
    const asked = untrack(() => target);
    let live = true;
    reach = null;
    failed = false;
    reaching = true;
    fetchImpact(asked)
      .then((answer) => {
        if (live) reach = answer;
      })
      .catch(() => {
        // No preview: the delete still enforces its plan, and the dialog says it could not look.
        if (live) failed = true;
      })
      .finally(() => {
        if (live) reaching = false;
      });
    return () => {
      live = false;
    };
  });

  const groups = $derived(reach ? impactGroups(reach, it) : []);
  $effect(() => {
    blocked = impactBlocked(reach);
  });
</script>

{#if askKey}
  {#if reaching}
    <p class="reach">Checking what else {it} touches…</p>
  {:else if failed}
    <p class="reach">{impactUnknown(it)}</p>
  {:else if reach}
    <p class="reach" class:linked={groups.length > 0}>{impactLead(reach, it)}</p>
    {#each groups as group (group.key)}
      <div class="conseq" class:danger={group.tone === 'danger'}>
        <div class="conseq-h">
          <Icon name={group.icon} size={12} />
          <span>{group.heading}</span>
        </div>
        <ul>
          {#each group.items as item, index (item.id ?? `${item.type}:${item.label}:${index}`)}
            <li>
              {item.label}{#if item.how?.length}<span class="how">{` · ${impactHow(item)}`}</span>{/if}
            </li>
          {/each}
          {#if group.more}<li class="more">and {group.more} more</li>{/if}
        </ul>
      </div>
    {/each}
  {/if}
{/if}

<style>
  .reach {
    font-size: var(--fs-xs);
    color: var(--text-3);
    margin: 10px 0 0;
    line-height: 1.4;
  }
  .reach.linked {
    color: var(--text-1);
    font-weight: 600;
  }
  .conseq {
    margin-top: 8px;
    padding: 8px 10px;
    background: var(--bg-2);
    border-radius: var(--r-sm);
    font-size: var(--fs-xs);
  }
  .conseq.danger {
    background: color-mix(in srgb, var(--danger, #e5484d) 9%, transparent);
  }
  .conseq-h {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-3);
    line-height: 1.35;
  }
  .conseq.danger .conseq-h {
    color: color-mix(in srgb, var(--danger, #e5484d) 85%, var(--text-2));
  }
  ul {
    margin: 5px 0 0;
    padding-left: 24px;
    color: var(--text-2);
    max-height: 96px;
    overflow-y: auto;
  }
  li {
    line-height: 1.5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .how { color: var(--text-3); }
  .more { color: var(--text-3); font-style: italic; }
</style>
