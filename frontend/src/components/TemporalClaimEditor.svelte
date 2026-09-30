<script>
  /** One editor for creating or revising a Temporal Claim from Time or Timeline. */
  import { api } from '../lib/api.js';
  import { toast } from '../lib/state.svelte.js';
  import TemporalInput from './TemporalInput.svelte';
  import TemporalTargetPicker from './TemporalTargetPicker.svelte';

  let {
    caseId,
    item = null,
    subject = null,
    initialWhen = '',
    initialStatement = '',
    initialRole = '',
    /** Evidence a new claim cites from the start, such as the picture it was read on. */
    initialCites = [],
    initialConfidence = '',
    initialAbout = [],
    initialAt = [],
    /** A count and a state carried over from the entry line, which asks them there. */
    initialFacts = null,
    /** Subjects the entry line named for the first time, created with the claim. */
    initialCreate = [],
    /** Whether the editor says it saved. The entry line says it itself, with an Undo. */
    announce = true,
    onsaved,
    oncancel,
  } = $props();

  let statement = $state('');
  let when = $state('');
  let timeRole = $state('');
  let confidence = $state('');
  let method = $state('');
  let verbatim = $state('');
  let about = $state([]);
  let places = $state([]);
  let cites = $state([]);
  let loading = $state(false);
  let saving = $state(false);
  let whenValid = $state(true);
  let seeded = false;

  const lockedAbout = $derived(subject ? [subject] : []);

  /** What the date is of, in a line. */
  const ROLE_HELP = {
    '': 'what the date is of, which can wait',
    occurred: 'when it happened',
    observed: 'when it was seen, filmed or reported',
    valid: 'the span during which it held',
  };
  /** How strongly the claim is supported, in the words the confidence scale is
   *  served with (`engine/links.py` CONFIDENCE_LEVELS). */
  const CONFIDENCE_HELP = {
    '': 'how strongly the claim is supported, once it is weighed',
    certain: 'established and corroborated',
    probable: 'more likely than not, and short of established',
    possible: 'roughly even odds, and it cannot be excluded',
    refuted: 'checked and eliminated, which is a finding rather than a deletion',
  };

  $effect(() => {
    if (seeded) return;
    seeded = true;
    statement = item?.label ?? initialStatement;
    when = item?.raw ?? initialWhen;
    timeRole = item?.time_role ?? initialRole;
    confidence = item?.confidence ?? initialConfidence;
    if (!item) {
      const keep = (entry) => ({ id: entry.id, label: entry.label, type: entry.type, attrs: entry.attrs });
      cites = initialCites.map(keep);
      about = initialAbout.map(keep);
      places = initialAt.map(keep);
    }
  });

  $effect(() => {
    if (!item?.owner_id || !caseId) return;
    let live = true;
    loading = true;
    api
      .get(`/api/cases/${caseId}/entities/${item.owner_id}/chain`)
      .then((chain) => {
        if (!live) return;
        statement = chain.entity.label ?? item.label;
        when = chain.entity.attrs?.when ?? item.raw ?? '';
        timeRole = chain.entity.attrs?.time_role ?? item.time_role ?? '';
        confidence = chain.entity.attrs?.confidence ?? item.confidence ?? '';
        method = chain.entity.attrs?.method ?? '';
        verbatim = chain.entity.attrs?.verbatim ?? '';
        const choices = (type) =>
          (chain.relations ?? [])
            .filter((row) => row.direction === 'out' && row.link.type === type)
            .map((row) => ({ id: row.entity.id, label: row.entity.label, type: row.entity.type, attrs: row.entity.attrs }));
        about = choices('about').filter((choice) => choice.id !== subject?.id);
        places = choices('at');
        cites = choices('cites');
      })
      .catch((error) => toast(error.message, 'danger'))
      .finally(() => { if (live) loading = false; });
    return () => { live = false; };
  });

  async function save() {
    const text = statement.trim();
    if (!text || !whenValid || saving) return;
    saving = true;
    const body = {
      statement: text,
      when: when || null,
      time_role: timeRole || null,
      confidence: confidence || null,
      method: method.trim() || null,
      verbatim: verbatim.trim() || null,
      about: [...new Set([...lockedAbout.map((entry) => entry.id), ...about.map((entry) => entry.id)])],
      at: places.map((entry) => entry.id),
      cites: cites.map((entry) => entry.id),
    };
    if (!item) {
      if (initialFacts?.count != null) body.count = initialFacts.count;
      if (initialFacts?.condition) body.condition = initialFacts.condition;
      if (initialCreate.length) body.create = initialCreate;
    }
    try {
      const saved = item
        ? await api.patch(`/api/cases/${caseId}/timeline/claims/${item.owner_id}`, body)
        : await api.post(`/api/cases/${caseId}/timeline/claims`, body);
      if (announce) toast(item ? 'Claim updated' : 'Claim added', 'ok', 1800);
      onsaved?.(saved);
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      saving = false;
    }
  }
</script>

<div class="claim-editor">
  {#if loading}
    <div class="loading">Loading claim…</div>
  {/if}

  <label class="modal-label" for="temporal-statement">Claim</label>
  <textarea
    id="temporal-statement"
    class="textarea"
    dir="auto"
    rows="2"
    bind:value={statement}
    maxlength="300"
    placeholder="What happened or was observed?"
  ></textarea>
  <p class="help">One sentence, in your words. Who, where and the sources go below; the source's own wording goes under Reasoning.</p>

  <label class="modal-label" for="temporal-when">When</label>
  <TemporalInput
    id="temporal-when"
    value={when}
    places={[...places, ...cites]}
    onchange={(value) => (when = value)}
    onvaliditychange={(reading) => (whenValid = reading.valid)}
  />

  <div class="two-cols">
    <label>
      <span class="modal-label">Time role</span>
      <select class="select" bind:value={timeRole}>
        <option value="">Not specified</option>
        <option value="occurred">Occurred</option>
        <option value="observed">Observed</option>
        <option value="valid">Valid during</option>
      </select>
    </label>
    <label>
      <span class="modal-label">Confidence</span>
      <select class="select" bind:value={confidence}>
        <option value="">Not assessed</option>
        <option value="certain">Certain</option>
        <option value="probable">Probable</option>
        <option value="possible">Possible</option>
        <option value="refuted">Refuted</option>
      </select>
    </label>
    <!-- Beside the labels rather than in them: a label is the field's name, and
         a line inside it would be read as part of that name. -->
    <small class="help">{ROLE_HELP[timeRole]}</small>
    <small class="help">{CONFIDENCE_HELP[confidence]}</small>
  </div>

  {#if !item && (initialFacts?.count != null || initialFacts?.condition || initialCreate.length)}
    <p class="carried">
      Filed with it:
      {[
        initialFacts?.count != null ? `${initialFacts.count} counted` : '',
        initialFacts?.condition ? initialFacts.condition : '',
        ...initialCreate.map((entry) => `${entry.label} (new)`),
      ].filter(Boolean).join(' · ')}
    </p>
  {/if}

  <section class="connections">
    <TemporalTargetPicker
      {caseId}
      relationType="about"
      label="About"
      hint="Who or what this claim concerns"
      bind:selected={about}
      locked={lockedAbout}
    />
    <TemporalTargetPicker
      {caseId}
      relationType="at"
      label="Place"
      hint="Where this happened or was observed"
      bind:selected={places}
    />
    <TemporalTargetPicker
      {caseId}
      relationType="cites"
      label="Evidence"
      hint="Files, notes or claims supporting this date"
      bind:selected={cites}
    />
  </section>

  <details class="reasoning">
    <summary>Reasoning and source wording</summary>
    <label class="modal-label" for="temporal-method">How this was worked out</label>
    <textarea id="temporal-method" class="textarea" rows="3" dir="auto" bind:value={method}></textarea>
    <label class="modal-label" for="temporal-verbatim">As the source put it</label>
    <textarea id="temporal-verbatim" class="textarea" rows="3" dir="auto" bind:value={verbatim}></textarea>
  </details>

  <div class="actions">
    <button class="btn btn-ghost" onclick={oncancel}>Cancel</button>
    <button class="btn btn-primary" disabled={!statement.trim() || !whenValid || saving || loading} onclick={save}>
      {saving ? 'Saving…' : item ? 'Update claim' : 'Add event'}
    </button>
  </div>
</div>

<style>
  .claim-editor { display: grid; gap: 8px; min-width: 0; }
  .carried { margin: 0; color: var(--text-3); font-size: var(--fs-xs); }
  .help { margin: -3px 0 2px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.4; }
  .two-cols .help { margin: -6px 0 0; }
  .loading { padding: 7px 9px; border-radius: var(--r-sm); background: var(--bg-2); color: var(--text-3); }
  .two-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .two-cols label { display: grid; gap: 4px; }
  .connections { display: grid; gap: 12px; margin-top: 5px; padding-top: 12px; border-top: 1px solid var(--border); }
  .reasoning { margin-top: 4px; border: 1px solid var(--border); border-radius: var(--r-sm); }
  .reasoning summary { padding: 8px 10px; cursor: pointer; color: var(--text-2); font-weight: 600; }
  .reasoning[open] { padding: 0 10px 10px; }
  .reasoning[open] summary { margin: 0 -10px 8px; }
  .actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 7px; }
  @media (max-width: 560px) { .two-cols { grid-template-columns: 1fr; } }
</style>
