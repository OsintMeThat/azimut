<script>
  /**
   * The non-chain edges of one entity (ONTOLOGY §3), one row each.
   *
   * A relation says something about the world — this photo was shot there, these
   * two files are the same picture — where the derivation chain says how a file
   * was made. Import enrichment proposes them from a file's own metadata, so most
   * rows start `suggested` and carry the two clicks that settle them: confirm
   * turns a machine's reading into a finding, dismiss drops the edge.
   *
   * One body, three homes — the Details panel, the map popup and (next) the case
   * board all render this, so the vocabulary and the gestures stay identical
   * wherever a relation appears.
   */
  import { api } from '../lib/api.js';
  import { toast } from '../lib/state.svelte.js';
  import { loadRelationTypes, relationOptions, relationVerb } from '../lib/relations.svelte.js';
  import { openEntity } from '../lib/navigate.js';
  import Icon from './Icon.svelte';

  let {
    caseId,
    relations = [],
    subjectType = null, // the type these relations are about; enables restating
    onwalk = null, // given, a row walks the host to that entity in place
    onchanged, // a relation was settled or restated: the host reloads what it reads
    max = 6, // rows past this hide behind one "+ n more" click
  } = $props();

  /** Where a row leads. Hosts that can show the entity in place say so; the rest
   *  open it in its own tool. Either way the row says "Open …" before the click,
   *  because a click that silently swaps the whole workspace reads as a bug. */
  const walk = (entity) => (onwalk ? onwalk(entity) : openEntity(entity));

  const ENTITY_ICON = {
    media: 'media', capture: 'satellite', place: 'pin', proof: 'proof',
    post: 'post', 'inspect-session': 'inspect', note: 'note', bookmark: 'link',
  };

  loadRelationTypes();

  let expanded = $state(false);
  let busyId = $state(null);

  /**
   * A row control acts on its own relation, and nothing above it should treat the
   * click as its own. That matters most in a map popup: Leaflet decides a click
   * was "on the map" by walking up from the event target to find the popup
   * container, and these controls replace themselves, so their button can already
   * be detached by the time the event bubbles — the card would close under the
   * analyst. Stopping inside the handler rather than on a wrapper, because Svelte
   * delegates these clicks to the app root: an ancestor that stopped them would
   * silence the buttons instead of protecting them.
   */
  function own(handler) {
    return (event) => {
      event.stopPropagation();
      handler();
    };
  }

  // Suggestions first: they are the only rows that need a decision, and a case
  // with forty confirmed relations must not bury the three awaiting review.
  const ordered = $derived(
    [...relations].sort(
      (a, b) => Number(isSuggested(b)) - Number(isSuggested(a))
    )
  );
  const shown = $derived(expanded ? ordered : ordered.slice(0, max));
  const hidden = $derived(Math.max(0, ordered.length - shown.length));

  function isSuggested(relation) {
    return relation.link?.provenance?.status === 'suggested';
  }

  /** A place carries its own point, so its row can offer the map. */
  function placePoint(entity) {
    const lat = Number(entity?.attrs?.lat);
    const lon = Number(entity?.attrs?.lon);
    if (entity?.type !== 'place' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  }

  /** The other readings the vocabulary allows for this pair, running the same way
   *  round as the edge already does — reversing it would be a different relation,
   *  not a correction. Empty for a machine's claim, which is not the analyst's to
   *  reword, and empty when the pair has only one reading. */
  function verbOptions(relation) {
    if (!subjectType) return [];
    const options = relationOptions(subjectType, relation.entity.type).filter(
      (option) => option.direction === relation.direction
    );
    return options.length > 1 ? options : [];
  }

  async function restate(link, type) {
    if (busyId || type === link.type) return;
    busyId = link.id;
    try {
      await api.patch(`/api/cases/${caseId}/links/${link.id}`, { type });
      toast('Relation updated', 'ok', 1600);
      await onchanged?.();
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      busyId = null;
    }
  }

  async function confirm(link) {
    if (busyId) return;
    busyId = link.id;
    try {
      await api.patch(`/api/cases/${caseId}/links/${link.id}`, { status: 'confirmed' });
      toast('Relation confirmed', 'ok', 1600);
      await onchanged?.();
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      busyId = null;
    }
  }

  /** Drop the edge. The same gesture whichever status it had, because a relation
   *  is a statement and taking it back is the only way to correct one — the
   *  wording differs so it reads as "not that" on a proposal and "no longer
   *  true" on something the analyst had already accepted. */
  async function remove(link, suggested) {
    if (busyId) return;
    busyId = link.id;
    try {
      await api.del(`/api/cases/${caseId}/links/${link.id}`);
      toast(suggested ? 'Relation dismissed' : 'Relation removed', 'info', 1600);
      await onchanged?.();
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      busyId = null;
    }
  }
</script>

{#if ordered.length}
  <div class="relations">
    {#each shown as relation (relation.link.id)}
      {@const point = placePoint(relation.entity)}
      {@const suggested = isSuggested(relation)}
      {@const verbs = verbOptions(relation)}
      <div class="relation" class:suggested class:busy={busyId === relation.link.id}>
        <button
          class="subject"
          onclick={own(() => walk(relation.entity))}
          title={`Open ${relation.entity.label}${point ? ` · ${point}` : ''}`}
        >
          <Icon name={ENTITY_ICON[relation.entity.type] ?? 'file'} size={12} />
          <span class="label">{relation.entity.label}</span>
          {#if !verbs.length}
            <span class="verb">
              {relation.direction === 'in' ? '← ' : ''}{relationVerb(relation.link.type)}
            </span>
          {/if}
        </button>
        <div class="acts">
          {#if verbs.length}
            <!-- the reading is corrected in place: same edge, same id, right verb -->
            <select
              class="select verb-select"
              value={relation.link.type}
              title="What this relation states"
              disabled={busyId === relation.link.id}
              onchange={(event) => restate(relation.link, event.currentTarget.value)}
            >
              {#each verbs as option (option.type)}
                <option value={option.type}>{option.label}</option>
              {/each}
            </select>
          {/if}
          {#if point}
            <button
              class="btn btn-ghost btn-sm act"
              title={`Show ${point} on the map`}
              onclick={own(() => openEntity(relation.entity))}
            >
              <Icon name="crosshair" size={12} />
            </button>
          {/if}
          {#if suggested}
            <button
              class="btn btn-ghost btn-sm act ok"
              title="Confirm this relation"
              disabled={busyId === relation.link.id}
              onclick={own(() => confirm(relation.link))}
            >
              <Icon name="check" size={12} />
            </button>
          {/if}
          <button
            class="btn btn-ghost btn-sm act no"
            title={suggested ? 'Dismiss this relation' : 'Remove this relation'}
            disabled={busyId === relation.link.id}
            onclick={own(() => remove(relation.link, suggested))}
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      </div>
    {/each}
    {#if hidden}
      <button class="more" onclick={own(() => (expanded = true))}>+ {hidden} more</button>
    {/if}
  </div>
{/if}

<style>
  .relations {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .relation {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    border-radius: var(--r-sm);
  }
  .relation.busy {
    opacity: 0.5;
  }
  /* a machine's reading, not a finding: one hairline is enough to say so */
  .relation.suggested .subject {
    border-left: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .subject {
    display: flex;
    align-items: center;
    gap: 7px;
    flex: 1;
    min-width: 0;
    padding: 5px 6px;
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-sm);
    text-align: left;
  }
  button.subject {
    cursor: pointer;
  }
  button.subject:hover {
    background: var(--bg-2);
    color: var(--text-1);
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .verb {
    flex-shrink: 0;
    margin-left: auto;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 999px;
    background: var(--bg-2);
    color: var(--text-3);
    white-space: nowrap;
  }
  /* the row's own actions stay quiet until the row is under the pointer */
  .acts {
    display: flex;
    flex: 0 0 auto;
    gap: 1px;
    opacity: 0.55;
  }
  .relation:hover .acts,
  .relation:focus-within .acts {
    opacity: 1;
  }
  .act {
    padding-inline: 5px;
  }
  .verb-select {
    flex: 0 0 auto;
    width: auto;
    max-width: 128px;
    padding: 1px 4px;
    font-size: 10px;
    color: var(--text-3);
  }
  .act.ok:hover {
    color: var(--ok, #46a758);
  }
  .act.no:hover {
    color: var(--danger, #e5484d);
  }
  .more {
    align-self: flex-start;
    padding: 2px 6px;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .more:hover {
    text-decoration: underline;
  }
</style>
