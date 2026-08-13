<script>
  /**
   * Filing a hand-made entity, wherever the analyst is standing.
   *
   * One dialog for two surfaces, and that is the whole point: a `claim` is created
   * with the same words, the same field names and the same duplicate warning whether
   * it was started from a row in the Board or from a right-click on the drawing. Two
   * copies of this form would be two vocabularies inside a week.
   *
   * Everything it renders comes from the registry (`engine/entities.py`): which types
   * an analyst may create, what the primary value is called for each one — **IP
   * address**, **Full name**, **Handle**, never a generic *Name* — and whatever else
   * the type declares. Adding a type is an edit there, not a panel here.
   */
  import { api } from '../lib/api.js';
  import { caseState, reloadCase, toast } from '../lib/state.svelte.js';
  import {
    creatableTypes,
    entityFamily,
    entityHint,
    entityIdentityLabel,
    entityIdentityPlaceholder,
    hasImageGallery,
  } from '../lib/entityTypes.svelte.js';
  import Modal from './Modal.svelte';
  import AttrFields from './AttrFields.svelte';
  import EntityPhotoDraft from './EntityPhotoDraft.svelte';

  let {
    /** The type to open on: what the analyst is already looking at. */
    startType = '',
    /** Types this surface will not show once they exist, with the reason. A graph lens
     *  draws some types and not others, and creating something invisible is worse than
     *  being told beforehand. */
    hidden = [],
    hiddenNote = '',
    /** The row this case already holds under the same identifier, offered instead. */
    ontwin = () => {},
    oncreated = () => {},
    onclose = () => {},
  } = $props();

  // Captured once on purpose: `startType` is where the dialog *opens*, and the analyst
  // picks from there. Tracked, the select would snap back under them whenever the
  // surface behind re-rendered with its own idea of the type.
  // svelte-ignore state_referenced_locally
  let draft = $state({ type: startType || creatableTypes()[0]?.type || '', label: '', notes: '', attrs: {} });
  let saving = $state(false);
  let photos = $state([]);
  let primaryPhotoId = $state(null);

  const identityLabel = $derived(entityIdentityLabel(draft.type));
  const identityPlaceholder = $derived(entityIdentityPlaceholder(draft.type));
  const unseen = $derived(hidden.includes(draft.type));

  $effect(() => {
    if (!hasImageGallery(draft.type)) {
      photos = [];
      primaryPhotoId = null;
    }
  });

  /**
   * An entity of the same type already carrying this value.
   *
   * Only a warning, and only where it means something: in the `identifier` family the
   * value *is* the identity, so two `email` rows holding one address are two records
   * of one thing (ONTOLOGY §2). It does not block — merging is not shipped, and
   * refusing the second entry would leave nowhere to put it — it offers the existing
   * row instead, which is what the analyst almost always wanted.
   *
   * **What counts as the same value is the registry's** (`entities.identity_key`),
   * asked for rather than worked out here. Comparing the lowercased label in the
   * browser is what let `@handle` and `handle`, or one phone number spaced two ways,
   * sit side by side as two records.
   */
  let twin = $state(null);
  $effect(() => {
    const label = draft.label.trim();
    const kind = draft.type;
    const caseId = caseState.current?.id;
    // The family test is the same one the route applies, kept here to spare the
    // request: nothing outside `identifier` has an identity a label can duplicate.
    if (!label || !caseId || entityFamily(kind) !== 'identifier') {
      twin = null;
      return;
    }
    // debounced like every other search here: an address is typed one character at a
    // time and none of the first fifteen is a question worth asking
    let live = true;
    const timer = setTimeout(() => {
      api
        .get(
          `/api/cases/${caseId}/entities/twin?${new URLSearchParams({ type: kind, label })}`
        )
        .then((body) => {
          if (live) twin = body.entity ?? null;
        })
        .catch(() => {
          if (live) twin = null;
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  });

  async function addPhotos(entityId) {
    const imageIds = new Map();
    const knownIds = new Set();
    let images = [];
    let failed = 0;
    for (const photo of photos) {
      try {
        let result;
        if (photo.source === 'computer') {
          const form = new FormData();
          form.append('file', photo.file);
          result = await api.post(
            `/api/cases/${caseState.current.id}/entities/${entityId}/images/upload`,
            form
          );
          const added = result.images.find((image) => !knownIds.has(image.id));
          if (added) imageIds.set(photo.draftId, added.id);
        } else {
          result = await api.post(
            `/api/cases/${caseState.current.id}/entities/${entityId}/images`,
            { media_ids: [photo.mediaId] }
          );
          if (result.images.some((image) => image.id === photo.mediaId)) {
            imageIds.set(photo.draftId, photo.mediaId);
          }
        }
        images = result.images;
        for (const image of images) knownIds.add(image.id);
      } catch {
        failed += 1;
      }
    }
    const primaryImageId = imageIds.get(primaryPhotoId);
    if (primaryImageId && !images.find((image) => image.id === primaryImageId)?.primary) {
      try {
        await api.put(
          `/api/cases/${caseState.current.id}/entities/${entityId}/images/${primaryImageId}/primary`
        );
      } catch {
        toast('Primary photo could not be set.', 'danger');
      }
    }
    return failed;
  }

  async function create() {
    if (saving) return;
    const label = draft.label.trim();
    if (!draft.type || !label) return;
    saving = true;
    try {
      const entity = await api.post(`/api/cases/${caseState.current.id}/entities`, {
        type: draft.type,
        label,
        attrs: {
          ...draft.attrs,
          ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
        },
      });
      const failedPhotos = hasImageGallery(draft.type) ? await addPhotos(entity.id) : 0;
      await reloadCase();
      if (failedPhotos) {
        toast(
          failedPhotos === 1 ? 'One photo could not be added.' : `${failedPhotos} photos could not be added.`,
          'danger'
        );
      }
      oncreated(entity);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      saving = false;
    }
  }
</script>

<Modal title="New entity" {onclose} width="620px">
  <label class="modal-label" for="create-type">Type</label>
  <!-- the menu says what each type is for: `claim` and `capture` are terse words
       nobody can look up, and choosing the wrong one is a filing mistake -->
  <select id="create-type" class="select" bind:value={draft.type} title={entityHint(draft.type)}>
    {#each creatableTypes() as entry (entry.type)}
      <option value={entry.type}>{entry.label}</option>
    {/each}
  </select>
  {#if entityHint(draft.type)}
    <p class="field-help">{entityHint(draft.type)}</p>
  {/if}
  {#if unseen && hiddenNote}
    <!-- Said before the act, not after it: creating something this surface will not
         draw looks exactly like creating nothing at all. -->
    <p class="field-help warn">{hiddenNote}</p>
  {/if}

  <section class="create-card">
    <label class="modal-label" for="create-label">{identityLabel}</label>
    <input
      id="create-label"
      class="input"
      placeholder={identityPlaceholder}
      bind:value={draft.label}
      onkeydown={(e) => e.key === 'Enter' && create()}
    />

    {#if twin}
      <p class="twin">
        This case already holds
        <button class="twin-open" onclick={() => ontwin(twin)}>{twin.label}</button>. On an
        identifier the value is the identity, so this would be a second record of one thing.
      </p>
    {/if}

    <!-- whatever else this type declares, generated from the registry -->
    <AttrFields type={draft.type} bind:values={draft.attrs} />

    <label class="modal-label" for="create-notes">Notes</label>
    <textarea
      id="create-notes"
      class="textarea"
      rows="3"
      placeholder="Add context or observations"
      bind:value={draft.notes}
    ></textarea>

    {#if hasImageGallery(draft.type)}
      <EntityPhotoDraft bind:photos bind:primaryId={primaryPhotoId} disabled={saving} />
    {/if}
  </section>

  <div class="modal-row">
    <div style="flex:1"></div>
    <button class="btn" onclick={onclose}>Cancel</button>
    <button
      class="btn btn-primary"
      onclick={create}
      disabled={saving || !draft.type || !draft.label.trim()}
    >
      {saving ? 'Creating…' : 'Create'}
    </button>
  </div>
</Modal>

<style>
  .field-help {
    margin: 5px 0 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .field-help.warn {
    color: var(--warn);
  }
  .create-card {
    margin-top: 14px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--r);
    background: var(--bg-2);
  }
  .create-card .modal-label:first-child {
    margin-top: 0;
  }
  .create-card .textarea {
    width: 100%;
    resize: vertical;
  }
  .twin {
    margin: 8px 0 0;
    color: var(--warn);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }
  .twin-open {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
