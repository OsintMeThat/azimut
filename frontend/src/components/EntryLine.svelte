<script module>
  import { entityFamily } from '../lib/entityTypes.svelte.js';
  import { relationOptions } from '../lib/relations.svelte.js';
  import { SEAT_ORDER, quickClaimSeat } from '../lib/quickClaim.js';

  /**
   * Where this entity sits on a Claim filed from it, or null when it has no seat.
   * Read off the relation registry, so a host shows its button exactly where this
   * line can file something. Null until both registries have landed.
   */
  export function claimSeat(entity) {
    if (!entity || entity.type === 'claim') return null;
    return quickClaimSeat(entityFamily(entity.type), (verb) =>
      relationOptions('claim', entity, 'claim').some((o) => o.type === verb && o.direction === 'out')
    );
  }

  /** Every seat the vocabulary gives an entity on a Claim, most specific first. A
   *  Claim is only ever cited: `about` a Claim is a second date for the same event. */
  export function seatsFor(entity) {
    if (!entity) return [];
    if (entity.type === 'claim') return ['cites'];
    return SEAT_ORDER.filter((verb) =>
      relationOptions('claim', entity, 'claim').some((o) => o.type === verb && o.direction === 'out'));
  }

  /** Unsaved lines, per case and per host, for this session only. Never on disk. */
  const DRAFTS = new Map();
</script>

<script>
  /**
   * One line to note what happened: a date, a sentence with `@` mentions, sources.
   *
   * Nothing is required but one thing to say (D1): a sentence, a mention or a source.
   * The sentence is kept as typed (D2) and, left empty, is written from the mentions.
   * The date is empty until the analyst gives one (D3); a date the line cannot read
   * holds the line back, and an empty one does not (D4). A name the case has never
   * held becomes a new subject with a guessed type, created only when the line is
   * added (D16). Each mention takes its seat from its family (D17).
   *
   * Used by the Timeline under its axis, and by Board, Graph and Details with their
   * entity already seated.
   */
  import { onDestroy, untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { reloadCase, toast } from '../lib/state.svelte.js';
  import {
    creatableTypes,
    entityFields,
    entityTypes,
    entityLabel as typeLabel,
    loadEntityTypes,
  } from '../lib/entityTypes.svelte.js';
  import { loadRelationTypes } from '../lib/relations.svelte.js';
  import { buildCatalogQuery } from '../lib/catalog.js';
  import { entityIcon } from '../lib/entityIcon.js';
  import { composeClaimStatement, quickClaimBody } from '../lib/quickClaim.js';
  import {
    guessSubjectType,
    insertMention,
    mentionAt,
    mostUsedType,
    rankMentions,
    typeMenu,
  } from '../lib/entryLine.js';
  import { isUnzonedTime, withZone, zoneReading, zonesOf } from '../lib/localZone.js';
  import { formatTemporalValue } from '../lib/timeline.js';
  import DateField from './DateField.svelte';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import TemporalClaimEditor from './TemporalClaimEditor.svelte';

  let {
    caseId,
    /** The entity the line was opened from, already in its seat. */
    entity = null,
    /** Where an unsaved line is kept for the session, or '' to keep nothing. */
    draftKey = '',
    /** Whether the line says `Added · Undo` itself. A host with more to say turns
     *  it off and uses the `undo` handed to `onsaved`. */
    announce = true,
    onsaved,
    oncancel,
  } = $props();

  const uid = $props.id();
  loadEntityTypes();
  loadRelationTypes();

  const seat = $derived(entity ? claimSeat(entity) : null);
  const seated = $derived(
    entity && seat
      ? [{ key: `seat:${entity.id}`, id: entity.id, label: entity.label, type: entity.type,
          attrs: entity.attrs, slot: seat.slot, locked: true }]
      : []
  );

  let when = $state('');
  let text = $state('');
  let edited = $state(false);
  let mentions = $state([]);
  let count = $state(null);
  let condition = $state('');
  let confidence = $state('');
  let more = $state(false);
  let saving = $state(false);
  let error = $state('');
  let refused = $state({});
  let zoneChoice = $state('');
  let zones = $state({ zones: [], only: null });
  let full = $state(null);
  let dragging = $state(false);

  let sentence = $state();
  let lineElement = $state();

  // A host whose entity calls for a count or a state opens on them: a model is
  // filed to say how many were seen and in what condition.
  $effect(() => {
    if (seat?.count || seat?.condition) untrack(() => (more = true));
  });

  // -- the session draft ------------------------------------------------------

  const storeKey = $derived(caseId && draftKey ? `${caseId}:${draftKey}` : '');
  $effect(() => {
    const key = storeKey;
    if (!key) return;
    untrack(() => {
      const held = DRAFTS.get(key);
      if (!held) return;
      ({ when, text, edited, mentions, count, condition, confidence } = held);
    });
  });
  const blank = $derived(!when && !text.trim() && !mentions.length && count == null && !condition && !confidence);
  function keepDraft() {
    if (!storeKey) return;
    if (blank) DRAFTS.delete(storeKey);
    else DRAFTS.set(storeKey, $state.snapshot({ when, text, edited, mentions, count, condition, confidence }));
  }
  onDestroy(keepDraft);

  // -- what the line adds up to -----------------------------------------------

  const all = $derived([...seated, ...mentions]);
  const inSeat = (slot) => all.filter((item) => item.slot === slot);
  const claimFields = $derived(entityFields('claim'));
  const countField = $derived(claimFields.find((field) => field.key === 'count'));
  const conditions = $derived(claimFields.find((field) => field.key === 'condition')?.options ?? []);
  const confidences = $derived(claimFields.find((field) => field.key === 'confidence')?.options ?? []);
  /** A count is of a model, and a state is of a model or a named object: asked when
   *  something `about` the line is one. */
  const facts = $derived.by(() => {
    const families = inSeat('about').map((item) => entityFamily(item.type));
    return {
      count: families.includes('class'),
      condition: families.some((family) => family === 'class' || family === 'asset'),
    };
  });

  const composed = $derived(
    composeClaimStatement({
      count: facts.count && Number.isInteger(count) ? count : null,
      condition: facts.condition ? conditions.find((option) => option.value === condition)?.label ?? '' : '',
      subjects: inSeat('about').map((item) => item.label),
      places: inSeat('at').map((item) => item.label),
      sources: inSeat('cites').map((item) => item.label),
    })
  );
  // The fields write the sentence until the analyst writes one; a sentence of their
  // own is never overwritten by a field changing under it.
  $effect(() => {
    if (!edited) text = composed;
  });
  const statement = $derived(text.trim() || composed);

  // -- the date, and the clock of the place it happened at --------------------

  const points = $derived([...inSeat('at'), ...inSeat('cites')].filter((item) => item.type === 'place' || item.type === 'proof'));
  $effect(() => {
    const placed = points.map((item) => ({ type: item.type, label: item.label, attrs: item.attrs }));
    let live = true;
    zonesOf(placed).then((found) => { if (live) zones = found; });
    return () => { live = false; };
  });
  /** The zone the typed hour is read in: the one the analyst picked among several,
   *  or the only one the draft's places agree on. Never when they turned it down. */
  const zone = $derived.by(() => {
    if (zoneChoice === 'none') return null;
    return zones.zones.find((entry) => entry.zone === zoneChoice) ?? zones.only;
  });
  const zoned = $derived(isUnzonedTime(when) && zones.zones.length > 0);
  const stored = $derived(zoned && zone ? withZone(when, zone.zone) : when);
  const whenValid = $derived(!when || formatTemporalValue(when).valid);

  // -- sending ---------------------------------------------------------------

  const ready = $derived(Boolean(statement) && whenValid && !saving);
  const refusal = $derived(
    !whenValid ? 'Correct the date or clear it'
      : !statement ? 'Write what happened, mention a subject or cite a source'
        : ''
  );

  function body() {
    const ids = (slot) => inSeat(slot).filter((item) => !item.isNew).map((item) => item.id);
    return quickClaimBody({
      statement,
      when: stored,
      confidence,
      count,
      condition,
      seat: facts,
      about: ids('about'),
      at: ids('at'),
      cites: ids('cites'),
      create: mentions.filter((item) => item.isNew).map((item) => ({ slot: item.slot, type: item.type, label: item.label })),
    });
  }

  function clear() {
    when = '';
    text = '';
    edited = false;
    mentions = [];
    count = null;
    condition = '';
    confidence = '';
    zoneChoice = '';
    error = '';
    refused = {};
    if (storeKey) DRAFTS.delete(storeKey);
  }

  async function undo(saved) {
    const ids = [saved.entity.id, ...(saved.created ?? []).map((entry) => entry.id)];
    try {
      await api.post(`/api/cases/${caseId}/entities/delete`, { ids });
      toast('Removed. It is in the Trash', 'ok', 2400);
      await reloadCase();
    } catch (failure) {
      toast(failure.message, 'danger');
    }
  }

  async function save() {
    if (!ready) return;
    saving = true;
    error = '';
    refused = {};
    try {
      const saved = await api.post(`/api/cases/${caseId}/timeline/claims`, body());
      clear();
      if (announce) toast('Added', 'ok', 8000, { label: 'Undo', onClick: () => undo(saved) });
      sentence?.focus();
      await reloadCase();
      onsaved?.(saved, { undo: () => undo(saved) });
    } catch (failure) {
      error = failure.message;
      // A mention the case lost since it was picked is marked where it sits.
      const gone = /entity '([^']+)' not found/.exec(failure.message)?.[1];
      if (gone) refused = { [gone]: 'no longer in the case' };
    } finally {
      saving = false;
    }
  }

  /** Put a date on the line, as a click on the axis does, and go to the sentence. */
  export function offer(value) {
    when = value ?? '';
    zoneChoice = '';
    queueMicrotask(() => sentence?.focus());
  }

  /** Go to the sentence. */
  export function focus() {
    sentence?.focus();
  }

  // -- mentions ---------------------------------------------------------------

  const seatableTypes = $derived(entityTypes().filter((entry) => seatsFor(entry).length).map((entry) => entry.type));
  const sourceTypes = $derived(entityTypes().filter((entry) => seatsFor(entry).includes('cites')).map((entry) => entry.type));

  /** The list under the sentence: `@` typed, or the paperclip pressed. */
  let suggest = $state(null); // { mode: 'mention' | 'source', mention?, term, rows, active, loading }
  let seq = 0;
  let summary = null;

  async function caseSummary() {
    summary ??= api.get(`/api/cases/${caseId}/catalog/summary`).catch(() => null);
    return summary;
  }

  function search(mode, term, mention = null) {
    const types = mode === 'source' ? sourceTypes : seatableTypes;
    const mine = ++seq;
    suggest = { ...(suggest?.mode === mode ? suggest : { active: 0, rows: [] }), mode, term, mention, loading: true };
    if (!types.length) return;
    api
      .get(buildCatalogQuery(caseId, { types, query: term.trim() || undefined, limit: 20 }))
      .then((page) => {
        if (mine !== seq || !suggest) return;
        const mentioned = new Set(all.map((item) => item.id));
        const rows = rankMentions(page.items ?? [], term, mentioned)
          .filter((row) => !mentioned.has(row.entity.id) && seatsFor(row.entity).length);
        suggest = { ...suggest, rows, active: 0, loading: false };
      })
      .catch(() => {
        if (mine === seq && suggest) suggest = { ...suggest, rows: [], loading: false };
      });
  }

  /** What `New · <name>` would create, guessed, or null when there is no name. */
  let guess = $state(null);
  /** The subject type this case holds most of, once the summary has been read. */
  let favourite = $state('');
  $effect(() => {
    const name = suggest?.mode === 'mention' ? suggest.term.trim() : '';
    if (!name) {
      guess = null;
      return;
    }
    let live = true;
    caseSummary().then((held) => {
      if (!live) return;
      favourite = mostUsedType(held, creatableTypes());
      guess = { label: name, ...guessSubjectType(name, { mostUsed: favourite }) };
    });
    return () => { live = false; };
  });
  const options = $derived([
    ...(suggest?.rows ?? []).map((row) => ({ kind: 'entity', ...row })),
    ...(guess && suggest?.mode === 'mention' ? [{ kind: 'new', ...guess }] : []),
  ]);

  function readCaret() {
    if (!sentence) return;
    const mention = mentionAt(text, sentence.selectionStart ?? text.length);
    if (mention) search('mention', mention.term, mention);
    else if (suggest?.mode === 'mention') suggest = null;
  }

  function onSentenceInput(event) {
    text = event.currentTarget.value;
    edited = true;
    readCaret();
  }

  function seatOf(item) {
    return seatsFor(item)[0] ?? 'about';
  }

  function pick(option) {
    if (!option) return;
    const label = option.kind === 'new' ? option.label : option.entity.label;
    if (suggest?.mode === 'mention' && suggest.mention) {
      const next = insertMention(text, suggest.mention, label);
      text = next.text;
      edited = true;
      queueMicrotask(() => sentence?.setSelectionRange(next.caret, next.caret));
    }
    if (option.kind === 'new') {
      const item = {
        key: `new:${Date.now()}:${label}`, label, type: option.type, rule: option.rule,
        isNew: true, slot: seatOf({ type: option.type }),
      };
      mentions = [...mentions, item];
      checkTwin(item);
    } else {
      const { entity: found } = option;
      mentions = [...mentions, {
        key: found.id, id: found.id, label: found.label, type: found.type,
        attrs: found.attrs, slot: seatOf(found),
      }];
    }
    suggest = null;
    sentence?.focus();
  }

  function remove(item) {
    if (item.locked) return;
    mentions = mentions.filter((entry) => entry.key !== item.key);
  }

  /** `Alt+↓` on a chip moves it to its next seat, when the vocabulary gives it one. */
  function chipKey(event, item) {
    if (event.key === 'ArrowDown' && event.altKey && !item.locked) {
      event.preventDefault();
      const seats = seatsFor(item);
      const next = seats[(seats.indexOf(item.slot) + 1) % seats.length];
      if (next && next !== item.slot) {
        mentions = mentions.map((entry) => (entry.key === item.key ? { ...entry, slot: next } : entry));
      }
    }
  }

  function retype(item, type) {
    const next = { ...item, type, rule: 'chosen', twin: null, slot: seatOf({ type }) };
    mentions = mentions.map((entry) => (entry.key === item.key ? next : entry));
    checkTwin(next);
  }

  /** An identifier the case already holds is offered in place of the new one. It
   *  warns and never refuses: the analyst can still keep the new subject. */
  async function checkTwin(item) {
    const params = new URLSearchParams({ type: item.type, label: item.label });
    try {
      const { entity: twin } = await api.get(`/api/cases/${caseId}/entities/twin?${params}`);
      mentions = mentions.map((entry) => (entry.key === item.key && entry.type === item.type ? { ...entry, twin } : entry));
    } catch {
      /* the warning is a courtesy; its absence blocks nothing */
    }
  }

  function useTwin(item) {
    const twin = item.twin;
    mentions = mentions.map((entry) => (entry.key === item.key
      ? { key: twin.id, id: twin.id, label: twin.label, type: twin.type, attrs: twin.attrs, slot: seatOf(twin) }
      : entry));
  }

  function toggleSources() {
    if (suggest?.mode === 'source') {
      suggest = null;
      return;
    }
    search('source', '');
  }

  function onSentenceKey(event) {
    if (suggest && options.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        suggest = { ...suggest, active: (suggest.active + step + options.length) % options.length };
        return;
      }
      if ((event.key === 'Enter' && !event.ctrlKey && !event.metaKey) || event.key === 'Tab') {
        event.preventDefault();
        pick(options[suggest.active]);
        return;
      }
    }
    if (event.key === 'Escape') {
      if (suggest) {
        // The `@` stays as typed: an address or a handle is text.
        event.stopPropagation();
        suggest = null;
        return;
      }
      if (!oncancel) sentence?.blur();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      save();
    }
  }

  function onLineKey(event) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      save();
    }
  }

  // -- files dropped from the system ------------------------------------------

  function onDragOver(event) {
    if (![...(event.dataTransfer?.types ?? [])].includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
  }

  /** A file dropped on the line is imported the way the Media Library imports it,
   *  then cited. The import stands even if the line is abandoned. */
  async function onDrop(event) {
    const files = [...(event.dataTransfer?.files ?? [])];
    dragging = false;
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      try {
        const result = await api.post(`/api/cases/${caseId}/media/upload`, form);
        const item = result.entity;
        if (item && !all.some((entry) => entry.id === item.id)) {
          mentions = [...mentions, { key: item.id, id: item.id, label: item.label, type: item.type, attrs: item.attrs, slot: 'cites' }];
        }
      } catch (failure) {
        toast(`${file.name}: ${failure.message}`, 'danger');
      }
    }
  }

  // -- the full editor --------------------------------------------------------

  function openFull() {
    const pick = (slot) => inSeat(slot).filter((item) => !item.isNew)
      .map(({ id, label, type, attrs }) => ({ id, label, type, attrs }));
    full = {
      statement,
      when: stored,
      confidence,
      about: pick('about').filter((item) => item.id !== entity?.id || seat?.slot !== 'about'),
      at: pick('at'),
      cites: pick('cites'),
      facts: {
        count: facts.count && Number.isInteger(count) ? count : null,
        condition: facts.condition && condition ? condition : null,
      },
      create: mentions.filter((item) => item.isNew).map(({ slot, type, label }) => ({ slot, type, label })),
      subject: seat?.slot === 'about' ? { id: entity.id, label: entity.label, type: entity.type } : null,
    };
  }

  async function fullSaved(saved) {
    full = null;
    clear();
    await reloadCase();
    onsaved?.(saved, { undo: () => undo(saved) });
  }

  const SEAT_WORDS = { about: 'about', at: 'at', cites: 'source' };
  const counter = $derived(text.length >= 250 ? `${text.length}/300` : '');
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="entry-line"
  class:dragging
  bind:this={lineElement}
  onkeydown={onLineKey}
  ondragover={onDragOver}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
>
  <div class="row">
    <div class="when">
      <DateField
        id="{uid}-when"
        label="When"
        placeholder="date · optional"
        value={when}
        reading={false}
        onchange={(value) => { when = value; zoneChoice = ''; }}
      />
    </div>
    <div class="say">
      <input
        bind:this={sentence}
        id="{uid}-say"
        class="input sentence"
        type="text"
        dir="auto"
        maxlength="300"
        autocomplete="off"
        placeholder="What happened? Type @ to mention"
        aria-label="What happened"
        role="combobox"
        aria-expanded={Boolean(suggest)}
        aria-controls="{uid}-options"
        aria-autocomplete="list"
        aria-activedescendant={suggest && options.length ? `${uid}-option-${suggest.active}` : undefined}
        value={text}
        oninput={onSentenceInput}
        onkeydown={onSentenceKey}
        onclick={readCaret}
      />
      {#if counter}<small class="counter" class:full={text.length >= 300}>{counter}</small>{/if}
      {#if suggest}
        <ul class="options" id="{uid}-options" role="listbox" aria-label={suggest.mode === 'source' ? 'Sources' : 'Mentions'}>
          {#if suggest.mode === 'source'}
            <li class="finder">
              <input
                class="input input-sm"
                type="search"
                placeholder="Find a source…"
                aria-label="Find a source"
                value={suggest.term}
                oninput={(event) => search('source', event.currentTarget.value)}
                onkeydown={(event) => {
                  // Enter here picks a source; with none offered it is not an Add.
                  if (event.key === 'Enter' && !options.length) event.preventDefault();
                  else onSentenceKey(event);
                }}
              />
            </li>
          {/if}
          {#each options as option, index (option.kind === 'new' ? 'new' : option.entity.id)}
            <li
              id="{uid}-option-{index}"
              role="option"
              aria-selected={index === suggest.active}
              class:active={index === suggest.active}
              onpointerdown={(event) => { event.preventDefault(); pick(option); }}
            >
              {#if option.kind === 'new'}
                <Icon name="plus" size={12} />
                <span class="name" dir="auto">New · {option.label}</span>
                <small>{typeLabel(option.type)} · {option.rule}</small>
              {:else}
                <Icon name={entityIcon(option.entity)} size={12} />
                <span class="name" dir="auto">{option.entity.label}</span>
                <small>
                  {#if option.reason}<span dir="auto">{option.reason.label}: {option.reason.value}</span> · {/if}{typeLabel(option.entity.type)}
                </small>
              {/if}
            </li>
          {:else}
            <li class="none">{suggest.loading ? 'Searching…' : 'Nothing in the case by that name'}</li>
          {/each}
        </ul>
      {/if}
    </div>
    <button
      class="btn btn-ghost attach"
      class:on={suggest?.mode === 'source'}
      aria-label="Cite a source"
      title="Cite a source, or drop a file on the line"
      onclick={toggleSources}
    >
      <Icon name="paperclip" size={14} />
    </button>
    {#if oncancel}<button class="btn btn-ghost" onclick={oncancel}>Cancel</button>{/if}
    <button class="btn btn-primary" disabled={!ready} title={refusal || 'Enter · Ctrl+Enter from any field'} onclick={save}>
      {saving ? 'Adding…' : 'Add'}
    </button>
  </div>

  {#if all.length}
    <div class="chips" aria-label="Mentioned">
      {#each all as item (item.key)}
        <span class="chip" class:locked={item.locked} class:new={item.isNew} class:refused={refused[item.id]}>
          <button
            class="chip-name"
            title={item.locked ? `${item.label} · where this line was opened` : refused[item.id] ? `${item.label} is ${refused[item.id]}` : `Remove ${item.label} · Alt+↓ changes its seat`}
            disabled={item.locked}
            onclick={() => remove(item)}
            onkeydown={(event) => chipKey(event, item)}
          >
            <Icon name={entityIcon(item)} size={11} />
            <span dir="auto">{item.label}</span>
            <small>{SEAT_WORDS[item.slot]}</small>
            {#if !item.locked}<Icon name="x" size={10} />{/if}
          </button>
          {#if item.isNew}
            {@const menu = typeMenu(creatableTypes(), favourite)}
            <select
              class="retype"
              aria-label={`What ${item.label} is`}
              value={item.type}
              onchange={(event) => retype(item, event.currentTarget.value)}
            >
              {#each menu.quick as type (type)}<option value={type}>{typeLabel(type)}</option>{/each}
              {#if !menu.quick.includes(item.type)}<option value={item.type}>{typeLabel(item.type)}</option>{/if}
              <optgroup label="Other">
                {#each menu.other.filter((type) => type !== item.type) as type (type)}<option value={type}>{typeLabel(type)}</option>{/each}
              </optgroup>
            </select>
            <small class="rule">{item.rule === 'chosen' ? 'new' : `new · ${item.rule}`}</small>
            {#if item.twin}
              <button class="btn btn-ghost btn-sm twin" title="The case already holds this value" onclick={() => useTwin(item)}>
                Use the one in the case
              </button>
            {/if}
          {/if}
        </span>
      {/each}
    </div>
  {/if}

  <div class="under">
    {#if when && whenValid}
      {@const reading = formatTemporalValue(stored)}
      <!-- A date it cannot read is said under the field itself, by DateField. -->
      <span class="said" aria-live="polite">
        {#if zoned && zone}Reads: {zoneReading(when, zone.zone, zone.place)}
        {:else}Reads: {[reading.label, ...reading.qualifiers].join(' · ')}{/if}
      </span>
      {#if zoned}
        <span class="zones">
          {#each zones.zones as entry (entry.zone)}
            {#if zone?.zone !== entry.zone}
              <button class="btn btn-ghost btn-sm" onclick={() => (zoneChoice = entry.zone)}>Local at {entry.place}</button>
            {/if}
          {/each}
          {#if zone}<button class="btn btn-ghost btn-sm" title="Keep the time with no zone, off the UTC axis" onclick={() => (zoneChoice = 'none')}>No zone</button>{/if}
        </span>
      {/if}
    {/if}
    {#if error}<span class="error" role="alert">{error}</span>{/if}
    <button class="btn btn-ghost btn-sm more" aria-expanded={more} onclick={() => (more = !more)}>
      <Icon name={more ? 'minus' : 'plus'} size={10} /> More
    </button>
  </div>

  {#if more}
    <div class="details">
      {#if facts.count}
        <label>
          <span class="modal-label">How many</span>
          <input class="input input-sm" type="number" min={countField?.minimum ?? 1} max={countField?.maximum} step="1" placeholder="Not counted" bind:value={count} />
        </label>
      {/if}
      {#if facts.condition}
        <label>
          <span class="modal-label">Condition</span>
          <select class="select input-sm" value={condition} onchange={(event) => (condition = event.currentTarget.value)}>
            <option value="">Not stated</option>
            {#each conditions as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
          </select>
        </label>
      {/if}
      <label>
        <span class="modal-label">Confidence</span>
        <select class="select input-sm" value={confidence} onchange={(event) => (confidence = event.currentTarget.value)}>
          <option value="">Not assessed</option>
          {#each confidences as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
        </select>
      </label>
      {#if edited && text.trim() !== composed && composed}
        <button class="btn btn-ghost btn-sm" title="Write the sentence from the mentions again" onclick={() => (edited = false)}>
          Rewrite from the mentions
        </button>
      {/if}
      <button class="btn btn-ghost btn-sm" title="Role, method and the source's own wording" onclick={openFull}>Full editor</button>
    </div>
  {/if}
</div>

{#if full}
  <Modal title="Add claim" onclose={() => (full = null)} width="660px">
    <TemporalClaimEditor
      {caseId}
      subject={full.subject}
      initialWhen={full.when}
      initialStatement={full.statement}
      initialRole={full.when ? 'observed' : ''}
      initialConfidence={full.confidence}
      initialAbout={full.about}
      initialAt={full.at}
      initialCites={full.cites}
      initialFacts={full.facts}
      initialCreate={full.create}
      onsaved={fullSaved}
      oncancel={() => (full = null)}
    />
  </Modal>
{/if}

<style>
  .entry-line { position: relative; display: grid; gap: 5px; min-width: 0; }
  .entry-line.dragging { outline: 1px dashed var(--accent); outline-offset: 3px; border-radius: var(--r-sm); }
  .row { display: flex; align-items: start; gap: 6px; min-width: 0; }
  .when { flex: 0 0 150px; min-width: 0; }
  .say { position: relative; flex: 1; min-width: 0; }
  .sentence { width: 100%; }
  .counter { position: absolute; right: 8px; top: 6px; color: var(--text-3); font-size: 10px; pointer-events: none; }
  .counter.full { color: var(--warn); }
  .options {
    position: absolute; z-index: 40; top: calc(100% + 3px); left: 0; right: 0;
    max-height: 240px; overflow: auto; margin: 0; padding: 3px; list-style: none;
    border: 1px solid var(--border-strong); border-radius: var(--r-sm);
    background: var(--bg-1); box-shadow: var(--shadow-2);
  }
  .options li {
    display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 7px;
    padding: 6px 8px; border-radius: var(--r-sm); color: var(--text-2); cursor: pointer;
  }
  .options li.active, .options li:hover { background: var(--bg-3); color: var(--text-1); }
  .options li.none, .options li.finder { display: block; cursor: default; color: var(--text-3); font-size: var(--fs-xs); }
  .options li.finder:hover { background: none; }
  .options li.finder input { width: 100%; }
  .options .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .options small { color: var(--text-3); font-size: 10px; white-space: nowrap; }
  .attach.on { color: var(--accent); }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip {
    display: inline-flex; align-items: center; gap: 4px; min-width: 0;
    padding: 1px 3px 1px 1px; border: 1px solid var(--border); border-radius: 999px;
    background: var(--bg-2); color: var(--text-2); font-size: var(--fs-xs);
  }
  .chip.locked { border-style: dashed; }
  .chip.new { border-color: var(--accent); }
  .chip.refused { border-color: var(--danger); color: var(--danger); }
  .chip-name {
    display: inline-flex; align-items: center; gap: 5px; min-width: 0; padding: 3px 6px;
    border: 0; border-radius: 999px; background: none; color: inherit; font: inherit; cursor: pointer;
  }
  .chip-name:disabled { cursor: default; }
  .chip-name small, .rule { color: var(--text-3); font-size: 10px; }
  .retype { padding: 1px 4px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-1); color: var(--text-2); font-size: 10px; }
  .twin { color: var(--warn); }
  .under { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-height: 18px; }
  .said { color: var(--text-3); font-size: var(--fs-xs); }
  .error { color: var(--warn); font-size: var(--fs-xs); }
  .zones { display: inline-flex; flex-wrap: wrap; gap: 4px; }
  .more { margin-left: auto; }
  .details { display: flex; flex-wrap: wrap; align-items: end; gap: 8px 12px; padding-top: 6px; border-top: 1px solid var(--border); }
  .details label { display: grid; gap: 3px; min-width: 120px; }
  .input-sm { padding: 4px 7px; font-size: var(--fs-xs); }
  @media (max-width: 620px) {
    .row { flex-wrap: wrap; }
    .when { flex-basis: 100%; }
  }
</style>
