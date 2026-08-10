<script>
  /**
   * The non-chain edges of one entity (ONTOLOGY §3), one row each.
   *
   * A relation says something about the world — this photo was recorded there, these
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
  import {
    confidenceHint,
    confidenceLabel,
    confidenceLevels,
    isRatable,
    isCurrentConnection,
    loadRelationTypes,
    relationAction,
    relationGroup,
    relationHint,
    relationOptions,
    relationQualifier,
    relationReading,
  } from '../lib/relations.svelte.js';
  import { loadEntityTypes, reliabilityOf } from '../lib/entityTypes.svelte.js';
  import { entityIcon } from '../lib/entityIcon.js';
  import { openEntity } from '../lib/navigate.js';
  import Icon from './Icon.svelte';

  let {
    caseId,
    relations = [],
    subjectType = null, // the type these relations are about; enables restating
    subject = null,
    actionFilter = null,
    onwalk = null, // given, a row walks the host to that entity in place
    onchanged, // a relation was settled or restated: the host reloads what it reads
    max = 6, // rows past this hide behind one "+ n more" click
  } = $props();

  /** Where a row leads. Hosts that can show the entity in place say so; the rest
   *  open it in its own tool. Either way the row says "Open …" before the click,
   *  because a click that silently swaps the whole workspace reads as a bug. */
  const walk = (entity) => (onwalk ? onwalk(entity) : openEntity(entity));

  loadRelationTypes();
  // Also the entity registry: a row reads its neighbour's reliability out of it, and
  // this component has three homes, only one of which loads it for its own reasons.
  loadEntityTypes();

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
  // with forty confirmed relations must not bury the three awaiting review. Inside
  // each section once the list is split — a heading the analyst reads on the way
  // past is not a hiding place, and interleaving the two kinds to surface a
  // proposal would undo the split it is being shown through.
  const scoped = $derived(
    actionFilter
      ? relations.filter((relation) => relationAction(relation.link.type) === actionFilter)
      : relations
  );
  const ordered = $derived(
    [...scoped].sort(
      (a, b) => Number(isSuggested(b)) - Number(isSuggested(a))
    )
  );
  const shown = $derived(expanded ? ordered : ordered.slice(0, max));
  const hidden = $derived(Math.max(0, ordered.length - shown.length));

  /**
   * The rows split under the headings their verbs declare, ungrouped ones first.
   *
   * A pointer is not a finding: "this note mentions that quay" says nothing about
   * where the quay is, where "was recorded at" does. Run together in one list they read
   * as the same kind of statement, and the weaker one quietly borrows the weight of
   * the others. Which verbs head their own section is the registry's call
   * (`links.RelationType.group`), never this component's.
   */
  const sections = $derived.by(() => {
    const groups = new Map([['', []]]);
    for (const relation of shown) {
      // A host that already asked for one action has named it above the list — the
      // Mentions section drawing a "Mentions" heading over its own rows said the
      // word twice and looked like two lists. The heading is for a list that runs
      // several actions together.
      const group = actionFilter ? '' : relationGroup(relation.link.type);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(relation);
    }
    return [...groups]
      .filter(([, rows]) => rows.length)
      .map(([group, rows]) => ({ group, rows }));
  });

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
    const options = relationOptions(
      subject ?? subjectType,
      relation.entity,
      relationAction(relation.link.type)
    ).filter(
      (option) => option.direction === relation.direction
    );
    return options.length > 1 ? options : [];
  }

  const legacy = (relation) => !isCurrentConnection(subject ?? subjectType, relation);

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

  /**
   * Rate how sure the analyst is, or clear the rating.
   *
   * `''` in the select means *not assessed*, and it sends `null` rather than being
   * left out: absent is a state to be able to return to, so a level picked by mistake
   * is not a hole. A suggestion is not offered the control at all — reviewing a
   * machine's claim and rating it are two different gestures, and the API refuses the
   * second before the first.
   */
  async function rate(link, raw) {
    if (busyId) return;
    const value = raw === '' ? null : Number(raw);
    busyId = link.id;
    try {
      await api.patch(`/api/cases/${caseId}/links/${link.id}`, { confidence: value });
      await onchanged?.();
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      busyId = null;
    }
  }

  /**
   * Say what kind of tie this edge states, or clear it.
   *
   * On `change` rather than on every keystroke: the value is a word, and a request
   * per letter would file "s", "si", "sis" before reaching "sister". Empty sends
   * `null`, so a word typed by mistake is taken back rather than stored blank.
   */
  async function qualify(link, raw) {
    if (busyId) return;
    const value = raw.trim();
    if (value === (link.nature ?? '')) return;
    busyId = link.id;
    try {
      await api.patch(`/api/cases/${caseId}/links/${link.id}`, { nature: value || null });
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
  async function remove(link, suggested, action) {
    if (busyId) return;
    busyId = link.id;
    try {
      await api.del(`/api/cases/${caseId}/links/${link.id}`);
      const noun = action === 'mention' ? 'Mention' : 'Relation';
      toast(suggested ? `${noun} dismissed` : `${noun} removed`, 'info', 1600);
      await onchanged?.();
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      busyId = null;
    }
  }
</script>

{#snippet row(relation)}
  {@const point = placePoint(relation.entity)}
  {@const suggested = isSuggested(relation)}
  {@const verbs = verbOptions(relation)}
  {@const rating = relation.link.confidence ?? null}
  {@const source = reliabilityOf(relation.entity)}
  {@const action = relationAction(relation.link.type)}
  {@const older = legacy(relation)}
  <div
    class="relation"
    class:mention={action === 'mention'}
    class:suggested
    class:refuted={rating === -1}
    class:legacy={older}
    class:busy={busyId === relation.link.id}
  >
    <div class="head">
      <button
        class="subject"
        onclick={own(() => walk(relation.entity))}
        title={`Open ${relation.entity.label}${point ? ` · ${point}` : ''}`}
      >
        <Icon name={entityIcon(relation.entity)} size={12} />
        <span class="name">{relation.entity.label}</span>
      </button>
      <!-- What the source is worth, on the line that carries its name, because
           that is whose property it is. The edge's own rating stays on the line
           below: the two axes are never read as one number, and putting them on
           one line is the first step to doing exactly that. -->
      {#if source}
        <span class="grade" title={`Source reliability: ${source.label}`}>
          {source.grade}
        </span>
      {/if}
      <div class="acts">
        {#if point}
          <button
            class="btn btn-ghost btn-sm act"
            title={`Show ${point} on the map`}
            onclick={own(() => openEntity(relation.entity))}
          >
            <Icon name="crosshair" size={12} />
          </button>
        {/if}
        {#if suggested && !older}
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
          title={suggested ? `Dismiss this ${action}` : `Remove this ${action}`}
          disabled={busyId === relation.link.id}
          onclick={own(() => remove(relation.link, suggested, action))}
        >
          <Icon name="x" size={12} />
        </button>
      </div>
    </div>
    <!-- What the edge states and how sure of it, on their own line under the
         name. A 300px panel cannot fit both beside a filename, and the name is
         what the analyst reads first. -->
    <div class="says">
      {#if older}
        <span class="chip verb">{relationReading(relation.link.type, relation.direction)}</span>
        <span class="older">Older connection</span>
      {:else if action === 'mention'}
        <span class="chip verb">{relationReading(relation.link.type, relation.direction)}</span>
      {:else if verbs.length}
        <!-- the reading is corrected in place: same edge, same id, right verb -->
        <select
          class="select chip verb-select"
          value={relation.link.type}
          title={relationHint(relation.link.type) || 'What this relation states'}
          disabled={busyId === relation.link.id}
          onchange={(event) => restate(relation.link, event.currentTarget.value)}
        >
          {#each verbs as option (option.type)}
            <option value={option.type}>{option.label}</option>
          {/each}
        </select>
      {:else}
        <span class="chip verb" title={relationHint(relation.link.type)}>
          {relationReading(relation.link.type, relation.direction)}
        </span>
      {/if}
      <!-- How sure of this one. Only on a reviewed relation the vocabulary allows
           to carry a rating, so no control ever offers what the API refuses. -->
      {#if !older && !suggested && isRatable(relation.link.type) && confidenceLevels().length}
        <select
          class="select chip rate"
          class:set={rating !== null}
          class:out={rating === -1}
          value={rating ?? ''}
          title={rating === null
            ? 'How sure of this'
            : confidenceHint(rating) || confidenceLabel(rating)}
          disabled={busyId === relation.link.id}
          onchange={(event) => rate(relation.link, event.currentTarget.value)}
        >
          <!-- clearing, not a fifth level: this is the absence of a rating -->
          <option value="">Not assessed</option>
          {#each confidenceLevels() as level (level.value)}
            <option value={level.value}>{level.label}</option>
          {/each}
        </select>
      {/if}
      <!-- What kind of tie, where the verb alone cannot say it. Drawn because the
           **verb** declares a qualifier, never because this edge happens to carry
           one — the same rule the rating follows, and what keeps a free note off
           every other edge in the vocabulary. -->
      {#if !older && !suggested && relationQualifier(relation.link.type)}
        <input
          class="input chip nature"
          class:set={Boolean(relation.link.nature)}
          value={relation.link.nature ?? ''}
          placeholder={relationQualifier(relation.link.type)}
          title={relationQualifier(relation.link.type)}
          maxlength="120"
          disabled={busyId === relation.link.id}
          onchange={(event) => qualify(relation.link, event.currentTarget.value)}
        />
      {/if}
    </div>
  </div>
{/snippet}

{#if ordered.length}
  <div class="relations">
    {#each sections as section (section.group)}
      {#if section.group}
        <p class="group">{section.group}</p>
      {/if}
      {#each section.rows as relation (relation.link.id)}
        {@render row(relation)}
      {/each}
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
    gap: 5px;
    min-width: 0;
  }
  /* Quiet enough to read as a divider rather than as a row: it separates two kinds
     of statement, it is not one itself. */
  .group {
    margin: 4px 0 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  /* Two lines, always the same two: the name, then what it states. Rows that
     changed shape depending on what they carried made a list of six unreadable. */
  .relation {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    padding: 1px 0 2px;
    border-left: 2px solid transparent;
    border-radius: var(--r-sm);
  }
  .relation:hover {
    background: color-mix(in srgb, var(--bg-2) 55%, transparent);
  }
  .relation.mention {
    padding-block: 0;
  }
  .relation.busy {
    opacity: 0.5;
  }
  /* a machine's reading, not a finding: one hairline is enough to say so */
  .relation.suggested {
    border-left-color: color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .relation.legacy {
    border-left-color: var(--border-strong);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
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
  /* not `.label`: that one is the app's form-label utility, and it was upper-casing
     the filenames in every relation row */
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The source's grade: one letter, stated not offered. Drawn flat rather than as a
     `.chip` so it cannot be mistaken for the rating dropdown two lines of code away —
     it is read here and edited in that source's own panel. */
  .grade {
    flex: 0 0 auto;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    color: var(--text-3);
    font-size: 10px;
    line-height: 14px;
    letter-spacing: 0.04em;
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
  /* hangs under the label, not under the icon: the line reads as the row's caption */
  .says {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding-left: 25px;
  }
  /*
   * The row's controls are the app's own select, one size down: same fill, border,
   * radius and focus ring as every other dropdown. Drawn rather than left native
   * because an OS-rendered select brings its own font and metrics, which is how the
   * rating came out bigger than the verb beside it.
   */
  .chip {
    display: inline-flex;
    align-items: center;
    flex: 0 1 auto;
    width: auto;
    max-width: 100%;
    padding: 3px 9px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background-color: var(--bg-2);
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-xs);
    line-height: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  select.chip {
    /* a select laid out as a flex box is a browser lottery; same box, drawn plainly */
    display: inline-block;
    appearance: none;
    padding-right: 22px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237d7d7d' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 5px center;
    background-size: 10px 10px;
    cursor: pointer;
  }
  select.chip:hover:not(:disabled) {
    color: var(--text-1);
    border-color: var(--text-3);
  }
  select.chip:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
  /* The dropdown itself is the browser's, and it takes the control's own colours —
     left to a transparent chip it opened white-on-white in dark mode. */
  .chip option {
    background-color: var(--bg-1);
    color: var(--text-1);
  }
  /* a verb with no alternative states the same thing without pretending to open */
  .verb {
    border-color: transparent;
    background-color: transparent;
    color: var(--text-3);
    padding-inline: 0;
  }
  .verb-select {
    max-width: 170px;
  }
  .older {
    color: var(--text-3);
    font-size: 10px;
  }
  /* Quiet until it says something. An unrated edge is the common case and must not
     read as a gap someone left, so the control only takes colour once it holds a
     level — and a ruled-out one is the state worth spotting across a list of twelve. */
  .rate {
    color: var(--text-3);
  }
  .rate.set {
    color: var(--text-1);
  }
  .rate.out {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 45%, transparent);
    background-color: color-mix(in srgb, var(--danger) 12%, transparent);
  }
  /* Sized to a word, because a word is what it holds: wide enough for "business
     partner", narrow enough that nobody mistakes it for a notes box. */
  .nature {
    width: 11ch;
    min-width: 0;
    color: var(--text-3);
  }
  .nature.set {
    color: var(--text-1);
  }
  /* A ruled-out candidate stays legible and stays in the list: the elimination is the
     finding, so it is dimmed rather than struck through or hidden. */
  .relation.refuted .subject .name {
    opacity: 0.6;
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
