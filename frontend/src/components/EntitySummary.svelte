<script>
  /**
   * The top of Details: what this is, and what the case's events say about it.
   *
   * The tabs below hold everything, and reading a subject used to mean opening
   * Connections to count its Claims, then Time to see when they fell. This says it in
   * one line above the tabs: how many events name it, the sources and places they
   * reach, and when they fall across the case's own span. It is also where the next
   * event is added, already about this entity, because that is the question an
   * entity's page most often raises.
   *
   * One read per entity shown (`/catalog/events`), refreshed with the case.
   */
  import { tick } from 'svelte';
  import { caseState } from '../lib/state.svelte.js';
  import { openInTimeline } from '../lib/navigate.js';
  import { fetchEventRows } from '../lib/catalog.js';
  import { entityFamily, entityLabel } from '../lib/entityTypes.svelte.js';
  import { entityIcon } from '../lib/entityIcon.js';
  import { eventWords, spanWords } from '../lib/boardGroups.js';
  import { claimActionTitle } from '../lib/quickClaim.js';
  import EntryLine, { claimSeat } from './EntryLine.svelte';
  import Icon from './Icon.svelte';
  import Sparkline from './Sparkline.svelte';

  let { caseId, entity, onclose } = $props();

  let events = $state(null);
  let composing = $state(false);
  let line = $state(null);
  let seq = 0;

  /** Open the line on the sentence, since that is what the press was for. */
  async function compose() {
    composing = !composing;
    if (!composing) return;
    await tick();
    line?.focus?.();
  }

  const seat = $derived(claimSeat(entity));
  const isClaim = $derived(entity?.type === 'claim');
  const family = $derived(entityFamily(entity?.type) ?? 'other');
  /** Other names, as the analyst wrote them: the field is one text, split on the
   *  separators people use for a list. Two at most, the rest is in Info. */
  const aliases = $derived(
    String(entity?.attrs?.aliases ?? '')
      .split(/[;,\n]/)
      .map((name) => name.trim())
      .filter(Boolean)
  );

  $effect(() => {
    const id = entity?.id;
    caseState.rev; // an event added, moved or deleted changes every number here
    const mine = ++seq;
    if (!id || !caseId || isClaim) {
      events = null;
      return;
    }
    fetchEventRows(caseId, [id])
      .then((body) => {
        if (mine === seq) events = body?.rows?.[id] ?? null;
      })
      .catch(() => {
        if (mine === seq) events = null;
      });
  });

  // A composer belongs to the entity it was opened on.
  let composedFor = null;
  $effect(() => {
    if (entity?.id !== composedFor) {
      composedFor = entity?.id ?? null;
      composing = false;
    }
  });

  const span = $derived(events ? spanWords(events.first, events.last) : '');
  const facts = $derived.by(() => {
    if (!events) return [];
    const out = [eventWords(events.events)];
    if (events.sources) out.push(`${events.sources} source${events.sources === 1 ? '' : 's'}`);
    if (events.places) out.push(`${events.places} place${events.places === 1 ? '' : 's'}`);
    return out;
  });

  function openTimeline() {
    openInTimeline(entity);
    onclose?.();
  }
</script>

{#if entity}
  <header class="summary" style="--tone: var(--graph-{family}, var(--text-3))">
    <div class="who">
      <span class="badge" aria-hidden="true"><Icon name={entityIcon(entity)} size={15} /></span>
      <div class="names">
        <h3 dir="auto" title={entity.label}>{entity.label}</h3>
        <p class="kind">
          <span>{entityLabel(entity.type)}</span>
          {#if aliases.length}
            <span class="also" title={aliases.join(' · ')}>
              also <bdi>{aliases.slice(0, 2).join(', ')}</bdi>{aliases.length > 2 ? '…' : ''}
            </span>
          {/if}
          {#if entity.provenance?.status === 'suggested'}<span class="tag">suggested</span>{/if}
        </p>
      </div>
      {#if seat}
        <button
          class="btn btn-sm add"
          class:on={composing}
          aria-expanded={composing}
          title={claimActionTitle(seat.slot)}
          onclick={compose}
        >
          <Icon name="plus" size={12} /> Add event
        </button>
      {/if}
    </div>

    {#if events && (events.events || seat)}
      <div class="strip">
        {#if events.events}
          <span class="facts">{facts.join(' · ')}</span>
          {#if span}
            <Sparkline buckets={events.buckets} label="When its events fall across the case" />
            <span class="span">{span}</span>
          {/if}
          <button class="as-link" title="Read its events in the Timeline" onclick={openTimeline}>
            Timeline <Icon name="chevronRight" size={11} />
          </button>
        {:else}
          <span class="facts none">No events yet</span>
        {/if}
      </div>
    {/if}

    {#if composing && seat}
      <div class="compose">
        <EntryLine
          bind:this={line}
          {caseId}
          {entity}
          draftKey={`details:${entity.id}`}
          onsaved={() => (composing = false)}
          oncancel={() => (composing = false)}
        />
      </div>
    {/if}
  </header>
{/if}

<style>
  .summary {
    display: grid;
    gap: 8px;
    padding: 2px 0 10px;
    margin-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }
  .who {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  /* The family's own colour, the one its nodes wear in the Graph, so the same thing
     reads as the same thing on both screens. */
  .badge {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    border-radius: 50%;
    background: color-mix(in srgb, var(--tone) 22%, transparent);
    color: var(--tone);
  }
  .names {
    flex: 1;
    min-width: 0;
  }
  h3 {
    margin: 0;
    overflow: hidden;
    color: var(--text-1);
    font-size: var(--fs-lg);
    font-weight: 600;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kind {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 2px 0 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .also {
    overflow: hidden;
    max-width: 260px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .also::before {
    content: '·';
    margin-right: 6px;
  }
  .tag {
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 10px;
  }
  .add {
    flex-shrink: 0;
  }
  .add.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .strip {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 22px;
    padding: 5px 10px;
    border-radius: var(--r-md);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .facts {
    margin-right: auto;
    color: var(--text-1);
    white-space: nowrap;
  }
  .facts.none {
    color: var(--text-3);
  }
  .span {
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .as-link {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  .as-link:hover {
    text-decoration: underline;
  }
  .compose {
    padding-top: 2px;
  }
</style>
