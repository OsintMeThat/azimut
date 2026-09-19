<script module>
  import { entityFamily } from '../lib/entityTypes.svelte.js';
  import { relationOptions } from '../lib/relations.svelte.js';
  import { quickClaimSeat } from '../lib/quickClaim.js';

  /**
   * Where this entity sits on a Claim filed from it, or null when it has no seat.
   * Read off the relation registry, so a host shows its button exactly where this
   * form can file something. Null until both registries have landed.
   */
  export function claimSeat(entity) {
    if (!entity || entity.type === 'claim') return null;
    return quickClaimSeat(entityFamily(entity.type), (verb) =>
      relationOptions('claim', entity, 'claim').some((o) => o.type === verb && o.direction === 'out')
    );
  }
</script>

<script>
  /**
   * A Claim filed from the entity it is about, in one small form (lib/quickClaim.js).
   *
   * The entity takes its own seat — a model or an object is what the claim is about,
   * a place is where, a file is the evidence — and the form asks only for the rest.
   * The sentence writes itself from the fields until the analyst writes their own.
   * The full editor on the Timeline and the Time tab is still where a claim is
   * reworked; this one files the common observation without going there.
   */
  import { api } from '../lib/api.js';
  import { reloadCase, toast } from '../lib/state.svelte.js';
  import { entityFields, loadEntityTypes } from '../lib/entityTypes.svelte.js';
  import { loadRelationTypes } from '../lib/relations.svelte.js';
  import { composeClaimStatement, quickClaimBody } from '../lib/quickClaim.js';
  import { formatTemporalValue } from '../lib/timeline.js';
  import DateField from './DateField.svelte';
  import TemporalTargetPicker from './TemporalTargetPicker.svelte';

  let { caseId, entity, onsaved, oncancel } = $props();
  // Two of these can be open at once — Details beside a board row's — so the
  // labels point at their own fields.
  const uid = $props.id();

  loadEntityTypes();
  loadRelationTypes();

  const seat = $derived(claimSeat(entity));
  const own = $derived([{ id: entity.id, label: entity.label, type: entity.type }]);
  const lockedAbout = $derived(seat?.slot === 'about' ? own : []);
  const lockedAt = $derived(seat?.slot === 'at' ? own : []);
  const lockedCites = $derived(seat?.slot === 'cites' ? own : []);

  const fields = $derived(entityFields('claim'));
  const countField = $derived(fields.find((field) => field.key === 'count'));
  const conditions = $derived(fields.find((field) => field.key === 'condition')?.options ?? []);
  const confidences = $derived(fields.find((field) => field.key === 'confidence')?.options ?? []);

  let count = $state(null);
  let condition = $state('');
  let about = $state([]);
  let places = $state([]);
  let cites = $state([]);
  let when = $state('');
  let confidence = $state('');
  let statement = $state('');
  let edited = $state(false);
  let saving = $state(false);

  const composed = $derived(
    composeClaimStatement({
      count: Number.isInteger(count) ? count : null,
      condition: conditions.find((option) => option.value === condition)?.label ?? '',
      subjects: [...lockedAbout, ...about].map((item) => item.label),
      places: [...lockedAt, ...places].map((item) => item.label),
    })
  );
  // The fields write the sentence until the analyst writes one; a sentence of
  // their own is never overwritten by a field changing under it.
  $effect(() => {
    if (!edited) statement = composed;
  });

  const whenValid = $derived(!when || formatTemporalValue(when).valid);
  const ready = $derived(Boolean(statement.trim()) && whenValid && !saving && Boolean(seat));

  async function save() {
    if (!ready) return;
    saving = true;
    try {
      const saved = await api.post(
        `/api/cases/${caseId}/timeline/claims`,
        quickClaimBody({
          statement,
          when,
          confidence,
          count,
          condition,
          seat,
          about: [...lockedAbout, ...about].map((item) => item.id),
          at: [...lockedAt, ...places].map((item) => item.id),
          cites: [...lockedCites, ...cites].map((item) => item.id),
        })
      );
      toast('Claim added', 'ok', 1800);
      await reloadCase();
      onsaved?.(saved);
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      saving = false;
    }
  }

  function onkeydown(event) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      save();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="quick-claim" {onkeydown}>
  <div class="statement-head">
    <label class="modal-label" for="{uid}-statement">Claim</label>
    {#if edited && statement !== composed && composed}
      <button class="btn btn-ghost btn-xs" onclick={() => (edited = false)} title="Write the sentence from the fields again">
        Rewrite from the fields
      </button>
    {/if}
  </div>
  <textarea
    id="{uid}-statement"
    class="textarea"
    rows="2"
    maxlength="300"
    placeholder="What was seen?"
    bind:value={statement}
    oninput={() => (edited = true)}
  ></textarea>

  {#if seat?.count || seat?.condition}
    <div class="facts">
      {#if seat.count}
        <label>
          <span class="modal-label">How many</span>
          <input
            class="input"
            type="number"
            min={countField?.minimum ?? 1}
            max={countField?.maximum}
            step="1"
            placeholder="Not counted"
            bind:value={count}
          />
        </label>
      {/if}
      {#if seat.condition}
        <label>
          <span class="modal-label">Condition</span>
          <select class="select" value={condition} onchange={(event) => (condition = event.currentTarget.value)}>
            <option value="">Not stated</option>
            {#each conditions as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>
      {/if}
    </div>
  {/if}

  <section class="connections">
    <TemporalTargetPicker {caseId} relationType="about" label="About" hint="Who or what was seen" bind:selected={about} locked={lockedAbout} />
    <TemporalTargetPicker {caseId} relationType="at" label="Place" hint="Where it was seen" bind:selected={places} locked={lockedAt} />
    <TemporalTargetPicker {caseId} relationType="cites" label="Evidence" hint="What shows it" bind:selected={cites} locked={lockedCites} />
  </section>

  <div class="facts">
    <div class="when">
      <span class="modal-label">When</span>
      <DateField
        id="{uid}-when"
        label="When"
        placeholder="Optional · dd/mm/yyyy"
        calendar
        value={when}
        onchange={(value) => (when = value)}
      />
    </div>
    <label>
      <span class="modal-label">Confidence</span>
      <select class="select" value={confidence} onchange={(event) => (confidence = event.currentTarget.value)}>
        <option value="">Not assessed</option>
        {#each confidences as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>
  </div>

  <div class="actions">
    <button class="btn btn-ghost" onclick={oncancel}>Cancel</button>
    <button class="btn btn-primary" disabled={!ready} onclick={save} title="Ctrl+Enter">
      {saving ? 'Saving…' : 'Add claim'}
    </button>
  </div>
</div>

<style>
  .quick-claim { display: grid; gap: 8px; min-width: 0; }
  .statement-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; align-items: start; }
  .facts label,
  .facts .when { display: grid; gap: 4px; min-width: 0; }
  .connections { display: grid; gap: 12px; margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--border); }
  .actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 4px; }
  @media (max-width: 560px) { .facts { grid-template-columns: 1fr; } }
</style>
