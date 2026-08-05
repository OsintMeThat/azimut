<script>
  /**
   * The selection editor for any artifact (docs/UI.md §4): preview, provenance,
   * the derivation chain, and an inline title/notes/folder editor with the
   * open/delete actions. One body, two homes — the case sidebar's Details
   * section and the Media Library's info modal both render this, so the two can
   * never drift apart again.
   *
   * Driven by an entity id: the live entity is derived from the open case, so a
   * reload after Save (or a folder move) shows the fresh object with no prop
   * juggling. Clicking a chain row walks the details to that entity in place.
   */
  import { api } from '../lib/api.js';
  import { caseState, reloadCase, toast } from '../lib/state.svelte.js';
  import { buildTree, flattenPaths, folderOf } from '../lib/folderTree.js';
  import { assignFolder as fileEntity } from '../lib/filing.js';
  import {
    entityFields,
    entityIdentityLabel,
    entityIdentityPlaceholder,
    entityLabel,
    isManualEntityType,
    loadEntityTypes,
  } from '../lib/entityTypes.svelte.js';
  import { entityIcon } from '../lib/entityIcon.js';
  import {
    loadRelationTypes,
    relatableTypes,
    relationAction,
    saveRelation,
  } from '../lib/relations.svelte.js';
  import {
    openEntity,
    opensInFileManager,
    showInFolder,
    gotoCapture,
    gotoPoint,
    ENTITY_TOOL,
  } from '../lib/navigate.js';
  import { pollWhile } from '../lib/poll.js';
  import { deletedToast, RESTORABLE } from '../lib/trash.js';
  import Icon from './Icon.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import FolderSelect from './FolderSelect.svelte';
  import AttrFields from './AttrFields.svelte';
  import ClaimConnections from './ClaimConnections.svelte';
  import ClaimReferences from './ClaimReferences.svelte';
  import RelationList from './RelationList.svelte';
  import RelationPicker from './RelationPicker.svelte';

  let {
    entityId,
    onclose,
    ondeleted,
    previewActions,
    // Whether the fields hold edits Save has not taken. Read by the hosts that can
    // be closed out from under the panel — a modal answers Escape and its backdrop,
    // and throwing a half-typed field away without a word is not a close.
    dirty = $bindable(false),
  } = $props();

  // Chain rows walk the details to another entity in place; that override sticks
  // until the host selects a different entity, when it clears back to the prop.
  let walkedId = $state(null);
  let lastProp; // seeded on the first effect run
  $effect(() => {
    if (entityId !== lastProp) {
      lastProp = entityId;
      walkedId = null;
    }
  });
  const currentId = $derived(walkedId ?? entityId);

  // The entity and its derivation chain come from the bounded chain endpoint
  // (Step 5), not the whole graph: fetched for the selected/walked id and
  // refetched after a reload, guarded so a stale response can't overwrite a
  // newer selection.
  let chainData = $state(null); // { entity, sources, lost, dependents, empty }
  let chainSeq = 0;
  const entity = $derived(chainData?.entity ?? null);
  const chain = $derived(chainData);

  $effect(() => {
    const id = currentId;
    const cid = caseState.current?.id;
    caseState.rev; // refetch after a save / delete / folder move
    const mySeq = ++chainSeq;
    if (!id || !cid) {
      chainData = null;
      return;
    }
    api
      .get(`/api/cases/${cid}/entities/${id}/chain`)
      .then((c) => { if (mySeq === chainSeq) chainData = c; })
      .catch(() => { if (mySeq === chainSeq) chainData = null; });
  });

  const allFolders = $derived(flattenPaths(buildTree(caseState.current?.folders ?? [], [])));

  // Entity types backed by a file on disk — deleting them drops the file.
  const FILE_BACKED = new Set(['media', 'capture', 'proof', 'post', 'inspect-session', 'note']);
  // Every type gets the title/notes editor — a list of which ones did was a list
  // that drifted: none of the hand-made types were on it, so a claim created on the
  // board opened with a title nobody could correct. A capture and a media commit
  // through their own tool's route, which writes the sidecar; everything else
  // patches the entity.

  // ── resolved listing item (media/satellite) + editable fields ──────────────
  let infoData = $state(null);
  let infoLoading = $state(false);
  let infoTitle = $state('');
  let infoNotes = $state('');
  let infoFolder = $state('');
  let infoSaving = $state(false);
  let seededId = null; // the id whose fields are currently loaded
  let seededFields = 0; // declared fields the registry knew when they were loaded

  // The declared fields of this type (ONTOLOGY §2), edited through AttrFields and
  // committed with Save like the title and the notes. Only declared keys are held
  // here, so a save can never disturb the geometry or sidecar keys a tool wrote.
  let infoAttrs = $state({});

  // What was on screen when the fields were last seeded or saved. Everything above
  // waits for Save while the connections file themselves, so the panel has to be
  // able to say whether closing it would lose anything.
  let baseline = $state(null);

  function snapshot() {
    baseline = {
      title: infoTitle,
      notes: infoNotes,
      folder: infoFolder,
      attrs: { ...infoAttrs },
    };
  }

  function changed() {
    if (!baseline) return false;
    if (infoTitle !== baseline.title) return true;
    if (infoNotes !== baseline.notes) return true;
    if (infoFolder !== baseline.folder) return true;
    const keys = new Set([...Object.keys(baseline.attrs), ...Object.keys(infoAttrs)]);
    for (const key of keys) {
      if ((baseline.attrs[key] ?? null) !== (infoAttrs[key] ?? null)) return true;
    }
    return false;
  }

  // Plain (untracked) mirror of the same answer: the seeding effect below has to
  // ask "has anything been typed" without subscribing to every keystroke.
  let dirtyNow = false;

  $effect(() => {
    dirty = changed();
    dirtyNow = dirty;
  });

  // Two tabs, cut where the model cuts: what the file or the save says about
  // itself, against what the analyst states — precision, the chain, relations, and
  // later confidence. Piling all of it into one scroll is what made this panel
  // long, and four editable fields dropped among read-only rows read as a bug.
  let tab = $state('info');
  $effect(() => {
    currentId; // a different entity opens on its own terms
    tab = 'info';
  });


  // The resolved item when there is one, and the entity's own pointer otherwise: a
  // file action must not disappear because the browse index read came back empty.
  const detailsFilePath = $derived(
    infoData?.path ??
      (entity?.type === 'capture' || entity?.type === 'media' ? entity.attrs?.path : null)
  );
  // A document, a scan, a spreadsheet: no preview above, no tool to reopen it in,
  // so the one action that helps is the folder it sits in.
  const inFileManager = $derived(opensInFileManager(entity));

  $effect(() => {
    const e = entity;
    caseState.rev; // re-resolve preview/metadata after a reload…
    if (!e) {
      infoData = null;
      seededId = null;
      return;
    }
    const firstSeed = seededId !== e.id; // …but only re-seed fields on a new selection
    const fields = entityFields(e.type);
    // The vocabulary is fetched, so it can land *after* this panel opened — most
    // visibly when the first request failed and the retry this component fires lands
    // a moment later. Seeding is keyed on the entity, so without this the declared
    // fields would render "Unknown" over an entity that holds a radius, a plate or a
    // grade. Only when none were seeded yet, and only over an untouched panel: a
    // late registry must never land on top of what the analyst has already typed.
    const lateRegistry = !firstSeed && seededFields === 0 && fields.length > 0 && !dirtyNow;
    if (firstSeed || lateRegistry) {
      seededId = e.id;
      seededFields = fields.length;
      if (firstSeed) {
        infoTitle = e.label ?? '';
        infoNotes = e.attrs?.notes ?? '';
        infoFolder = folderOf(e) ?? '';
        infoData = null;
      }
      infoAttrs = Object.fromEntries(fields.map((f) => [f.key, e.attrs?.[f.key] ?? null]));
      snapshot();
    }
    resolve(e, firstSeed);
  });

  /** The file behind an entity, with everything the sidecar holds.
   *
   *  A media file is read one at a time: the metadata dumps this panel shows
   *  (EXIF, video fields) are hundreds of rows each and are deliberately kept out
   *  of the browse index, so asking for the whole list would neither carry them
   *  nor be cheap. A capture still comes off the satellite list, which is small
   *  and has no per-item read.
   *
   *  ``quiet`` re-reads without the loading banner: the enrichment poll below
   *  calls this every 1.5s, and flashing "Loading…" at someone reading the panel
   *  would look like a fault rather than a background job finishing. */
  async function resolve(e, seedFields, quiet = false) {
    const path = e.attrs?.path;
    if (!path || (e.type !== 'media' && e.type !== 'capture')) {
      infoData = null;
      return;
    }
    const cid = caseState.current.id;
    if (!quiet) infoLoading = true;
    try {
      const found =
        e.type === 'media'
          ? await api.get(`/api/cases/${cid}/media/item?path=${encodeURIComponent(path)}`)
          : (await api.get(`/api/cases/${cid}/satellite`)).find((m) => m.path === path);
      if (seededId !== e.id) return; // selection moved on mid-fetch
      infoData = found ?? null;
      if (infoData && seedFields) {
        infoTitle = infoData.title ?? e.label ?? '';
        infoNotes = infoData.notes ?? infoNotes;
        // the sidecar is what the fields now hold, so it is what they are compared
        // against — otherwise the panel would open already reading as edited
        snapshot();
      }
    } catch {
      // a failed quiet re-read keeps what is on screen: the panel is being read,
      // and blanking it because one poll missed would lose the analyst's place
      if (!quiet) infoData = null;
    } finally {
      infoLoading = false;
    }
  }

  // Enrichment runs in a job, so a file opened moments after its import has no
  // metadata to show yet. The Media Library's own poll covers the modal it hosts,
  // but this body also lives in the case sidebar, where nothing else is watching:
  // import, switch to Satellite, open the file from the sidebar, and the EXIF
  // section would sit empty until something unrelated reloaded the case. The file
  // itself reports the job's state, so poll on that and stop when it settles.
  const enriching = $derived(
    infoData?.enrich_state === 'queued' || infoData?.enrich_state === 'running'
  );

  $effect(() => {
    if (!enriching || !entity) return;
    return pollWhile(() => enriching, () => resolve(entity, false, true), 1500);
  });

  // Connections have their own explicit composer. They are graph statements, not
  // unsaved text fields, so waiting on the panel-wide Save made the Add action feel
  // broken and let a mention masquerade as a relation.
  let connectionComposer = $state(null); // 'relation' | 'mention' | null
  let connectionSaving = $state(false);
  loadRelationTypes();
  loadEntityTypes();
  const relationTargetTypes = $derived(
    entity ? relatableTypes(entity, 'relation') : []
  );
  const mentionTargetTypes = $derived(
    entity ? relatableTypes(entity, 'mention') : []
  );
  const canRelate = $derived(relationTargetTypes.length > 0);
  const canMention = $derived(mentionTargetTypes.length > 0);
  const relationTargetHint = $derived(
    `Relate this to: ${relationTargetTypes.map(entityLabel).join(', ')}.`
  );
  const mentionTargetHint = $derived(
    `Mentions connect this with: ${mentionTargetTypes.map(entityLabel).join(', ')}.`
  );
  const declaredFields = $derived(entity ? entityFields(entity.type) : []);
  const identityLabel = $derived(entity ? entityIdentityLabel(entity.type) : 'Title');
  const identityPlaceholder = $derived(
    entity ? entityIdentityPlaceholder(entity.type) : 'What to call it'
  );
  const ordinaryRelations = $derived(
    (chain?.relations ?? []).filter((row) => relationAction(row.link.type) === 'relation')
  );
  const mentionRelations = $derived(
    (chain?.relations ?? []).filter((row) => relationAction(row.link.type) === 'mention')
  );
  const claimRelations = $derived(
    (chain?.relations ?? []).filter((row) => relationAction(row.link.type) === 'claim')
  );
  const hasRelations = $derived(Boolean(chain?.relations?.length));
  const unifiedDetails = $derived(Boolean(entity && isManualEntityType(entity.type)));
  const lineageCount = $derived(
    (chain?.sources?.length ?? 0) +
      (chain?.lost?.length ?? 0) +
      (chain?.dependents?.length ?? 0)
  );
  const lineageLabel = $derived(
    entity?.type === 'inspect-session' ? 'Depends on & used by' : 'Made from & used by'
  );

  // Where the chain puts this entity (ONTOLOGY §3). Its own request, and only once
  // the Case tab is on screen: the walk reaches further than the chain's one hop,
  // and the panel opens on Info, so clicking through a list of rows never pays for it.
  let placement = $state(null); // { points, truncated }
  let placeSeq = 0;
  const placedPoints = $derived(placement?.points ?? []);

  $effect(() => {
    const id = currentId;
    const cid = caseState.current?.id;
    const wanted = tab === 'case' || unifiedDetails;
    caseState.rev; // a save can add or drop a panel, and with it a point
    const mySeq = ++placeSeq;
    if (!id || !cid || !wanted) {
      placement = null;
      return;
    }
    api
      .get(`/api/cases/${cid}/entities/${id}/placement`)
      .then((p) => { if (mySeq === placeSeq) placement = p; })
      .catch(() => { if (mySeq === placeSeq) placement = null; });
  });

  /** One point, written the way every other coordinate row in this panel writes one. */
  function pointText(point) {
    return `${Number(point.lat).toFixed(6)}, ${Number(point.lon).toFixed(6)}`;
  }

  $effect(() => {
    currentId; // a different entity means a different subject
    connectionComposer = null;
  });

  /** Follow a connection or a lineage row, keeping unsaved fields.
   *
   *  Walking replaces what the panel is showing, so it loses a half-typed field
   *  exactly the way closing does — and this one used to happen on a single click
   *  with nothing said. */
  let pendingWalk = $state(null);

  function walkTo(id) {
    if (dirty) pendingWalk = id;
    else walkedId = id;
  }

  /** Accept a proposal from here as well as from the board: a suggestion is often
   *  read before it is settled, and the panel is where it is read. Its suggested
   *  relations are confirmed with it, which is the API's own invariant. */
  let confirming = $state(false);

  async function confirmEntity() {
    if (!entity || confirming) return;
    confirming = true;
    try {
      await api.patch(`/api/cases/${caseState.current.id}/entities/${entity.id}`, {
        status: 'confirmed',
      });
      await reloadCase();
      toast('Confirmed', 'ok', 1600);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      confirming = false;
    }
  }

  async function addConnection(choice) {
    if (!entity || connectionSaving) return;
    connectionSaving = true;
    try {
      await saveRelation(caseState.current.id, entity.id, choice);
      await reloadCase();
      toast(connectionComposer === 'mention' ? 'Mention added' : 'Relation added', 'ok', 1600);
      connectionComposer = null;
    } catch (e) {
      toast(e.message, 'danger');
      throw e; // keep the composer open so the selection is not lost
    } finally {
      connectionSaving = false;
    }
  }

  async function saveInfo() {
    if (!entity || infoSaving) return;
    infoSaving = true;
    const cid = caseState.current.id;
    try {
      // A capture and a media are saved through their own tool's route, which
      // writes the sidecar and carries the title and the notes only. Neither type
      // declares fields, so nothing is dropped here — and `tests/test_entities.py`
      // fails the day one does, rather than letting a typed field vanish on Save.
      if (entity.type === 'capture') {
        await api.patch(`/api/cases/${cid}/satellite`, {
          path: entity.attrs.path, title: infoTitle, notes: infoNotes,
        });
      } else if (entity.type === 'media') {
        await api.patch(`/api/cases/${cid}/media`, {
          path: entity.attrs.path, title: infoTitle.trim(), notes: infoNotes,
        });
      } else {
        await api.patch(`/api/cases/${cid}/entities/${entity.id}`, {
          label: infoTitle.trim() || entity.label,
          // The backend merges attrs, so sending the declared fields beside the
          // notes leaves every other key the tool wrote exactly where it was.
          attrs: { notes: infoNotes.trim(), ...infoAttrs },
        });
      }
      if ((infoFolder.trim() || '') !== (folderOf(entity) ?? '')) {
        await fileEntity(cid, entity, infoFolder.trim());
      }
      await reloadCase();
      snapshot(); // what is on screen is now what the case holds
      toast('Saved', 'ok', 1600);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      infoSaving = false;
    }
  }

  // ── delete everywhere (recoverable from the case trash) ───────────────────
  let confirmState = $state(null);
  let confirmBusy = $state(false);

  async function askDeleteEverywhere() {
    const e = entity;
    if (!e) return;
    // The authoritative plan is the backend's; the preview reads its dependents
    // endpoint rather than mirroring the whole graph client-side.
    let consequences = { cascade: [], tombstone: [] };
    try {
      consequences = await api.get(
        `/api/cases/${caseState.current.id}/entities/${e.id}/dependents`
      );
    } catch {
      /* no preview — the delete still enforces the plan server-side */
    }
    confirmState = {
      title: 'Delete everywhere?',
      message: `“${e.label}” will be removed from the case and its tool.`,
      detail: FILE_BACKED.has(e.type)
        ? 'Moves the item and its files to the case trash.'
        : 'Moves the item to the case trash.',
      consequences,
      restorable: RESTORABLE,
      action: async () => {
        const caseId = caseState.current.id;
        const result = await api.del(`/api/cases/${caseId}/entities/${e.id}`);
        await reloadCase();
        deletedToast(caseId, result, e.label);
        ondeleted?.();
      },
    };
  }

  async function runConfirm() {
    const s = confirmState;
    if (!s) return;
    confirmBusy = true;
    try {
      await s.action();
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      confirmBusy = false;
      confirmState = null;
    }
  }

  function fmtSize(bytes) {
    if (bytes == null) return '';
    if (bytes >= 1 << 30) return (bytes / (1 << 30)).toFixed(1) + ' GB';
    if (bytes >= 1 << 20) return (bytes / (1 << 20)).toFixed(1) + ' MB';
    if (bytes >= 1 << 10) return (bytes / (1 << 10)).toFixed(0) + ' KB';
    return bytes + ' B';
  }

  function formatCoords(gps) {
    if (gps?.lat == null || gps?.lon == null) return '';
    return `${Number(gps.lat).toFixed(6)}, ${Number(gps.lon).toFixed(6)}`;
  }
</script>

{#if entity}
  <div class="ed">
    {#if infoLoading}
      <div class="info-loading">Loading…</div>
    {/if}

    {#if infoData?.kind === 'image' && infoData.thumbnail}
      <div class="info-preview">
        <img src={`/files/${caseState.current.id}/${infoData.path}`} alt={entity.label} />
      </div>
    {:else if infoData?.kind === 'video'}
      <div class="info-preview">
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={`/files/${caseState.current.id}/${infoData.path}`} controls preload="metadata"></video>
      </div>
    {:else if entity.type === 'capture' && entity.attrs?.path}
      <div class="info-preview">
        <img src={`/files/${caseState.current.id}/${entity.attrs.path}`} alt={entity.label} />
      </div>
    {/if}

    {#if previewActions}
      <div class="info-preview-actions">
        {@render previewActions()}
      </div>
    {/if}

    <!-- A proposal says so where it is read, and carries the click that settles it.
         Filtering the board to the suggestions only to have to guess which panel
         accepts one is where this review stopped being a review. -->
    {#if entity.provenance?.status === 'suggested'}
      <div class="suggested-bar">
        <Icon name="info" size={13} />
        <span>A tool proposed this. Nobody has confirmed it.</span>
        <button class="btn btn-sm" disabled={confirming} onclick={confirmEntity}>
          {confirming ? 'Confirming…' : 'Confirm'}
        </button>
      </div>
    {/if}

    <label class="modal-label" for="ed-title">{identityLabel}</label>
    <input
      id="ed-title"
      class="input"
      bind:value={infoTitle}
      placeholder={entity.attrs?.coords ?? identityPlaceholder}
    />

    {#if unifiedDetails && declaredFields.length}
      <AttrFields type={entity.type} bind:values={infoAttrs} />
    {/if}

    <!-- Two tabs on the model's own seam: what the item says about itself, against
         what the analyst states about it. The preview and the title stay above both,
         because you want the picture in front of you while stating a relation. -->
    {#if !unifiedDetails}
    <div class="ed-tabs" role="tablist">
      <button
        class="ed-tab" class:on={tab === 'info'} role="tab" aria-selected={tab === 'info'}
        title="what the file or the save reports about itself"
        onclick={() => (tab = 'info')}
      >Info</button>
      <button
        class="ed-tab" class:on={tab === 'case'} role="tab" aria-selected={tab === 'case'}
        title="what you are stating about it"
        onclick={() => (tab = 'case')}
      >Case</button>
    </div>
    {/if}

    {#if tab === 'info' || unifiedDetails}
    {#if !unifiedDetails}
    <div class="info-rows">
      <div class="info-row"><span class="info-k">Type</span><span>{entity.type}</span></div>
      {#if entity.provenance?.by}
        <div class="info-row"><span class="info-k">Created by</span><span>{entity.provenance.by}</span></div>
      {/if}
      {#if entity.provenance?.at}
        <div class="info-row"><span class="info-k">Created</span><span class="mono">{entity.provenance.at.slice(0, 10)}</span></div>
      {/if}
      {#if entity.type === 'media' && infoData}
        <div class="info-row"><span class="info-k">Kind</span><span>{infoData.kind}</span></div>
        <div class="info-row"><span class="info-k">Size</span><span>{fmtSize(infoData.size)}</span></div>
        {#if infoData.sha256}
          <div class="info-row"><span class="info-k">SHA-256</span><span class="mono hash" title={infoData.sha256}>{infoData.sha256}</span></div>
        {/if}
        {#if infoData.source?.title}
          <div class="info-row"><span class="info-k">Title</span><span>{infoData.source.title}</span></div>
        {/if}
        {#if infoData.source?.uploader}
          <div class="info-row"><span class="info-k">Uploader</span><span>{infoData.source.uploader}</span></div>
        {/if}
        {#if infoData.source?.upload_date}
          <div class="info-row"><span class="info-k">Published</span><span class="mono">{infoData.source.upload_date}</span></div>
        {/if}
        {#if infoData.source?.duration}
          <div class="info-row"><span class="info-k">Duration</span><span>{infoData.source.duration}s</span></div>
        {/if}
        {#if infoData.source?.webpage_url ?? infoData.source?.url}
          <div class="info-row">
            <span class="info-k">Source</span>
            <a class="mono src" href={infoData.source.webpage_url ?? infoData.source.url} target="_blank" rel="noreferrer">
              {infoData.source.webpage_url ?? infoData.source.url}
            </a>
          </div>
        {/if}
        {#if infoData.source?.description}
          <div class="info-row"><span class="info-k">Description</span><span class="description">{infoData.source.description}</span></div>
        {/if}
      {:else if entity.type === 'capture'}
        {#if infoData?.provider_label}
          <div class="info-row"><span class="info-k">Provider</span><span>{infoData.provider_label}</span></div>
        {/if}
        {#if entity.attrs?.zoom != null}
          <div class="info-row"><span class="info-k">Zoom</span><span>z{entity.attrs.zoom}</span></div>
        {/if}
        {#if infoData?.fetched_at}
          <div class="info-row"><span class="info-k">Captured</span><span class="mono">{infoData.fetched_at.slice(0, 10)}</span></div>
        {/if}
        {#if infoData?.imagery_date}
          <div class="info-row"><span class="info-k">Imagery</span><span class="mono">{infoData.imagery_date}</span></div>
        {/if}
        {#if infoData?.source_url}
          <div class="info-row">
            <span class="info-k">Source page</span>
            <a class="mono src" href={infoData.source_url} target="_blank" rel="noreferrer">
              {infoData.source_url}
            </a>
          </div>
        {/if}
      {:else if entity.type === 'bookmark' && entity.attrs?.url}
        <div class="info-row">
          <span class="info-k">URL</span>
          <a class="mono src" href={entity.attrs.url} target="_blank" rel="noreferrer">{entity.attrs.url}</a>
        </div>
        <!-- When the page was seen, stamped by whatever filed it. Under Info because
             it reports the save rather than the analyst's judgement, and absent on a
             bookmark typed by hand — nothing was fetched. -->
        {#if entity.attrs.fetched_at}
          <div class="info-row">
            <span class="info-k">Fetched</span>
            <span class="mono">{entity.attrs.fetched_at.slice(0, 10)}</span>
          </div>
        {/if}
      {/if}
      {#if entity.attrs?.coords}
        <div class="info-row"><span class="info-k">Coords</span><span class="mono">{entity.attrs.coords}</span></div>
      {/if}
    </div>
    {/if}

    {#if infoData?.kind === 'image' && (infoData.taken_at || infoData.gps || Object.keys(infoData.exif ?? {}).length)}
      <details class="metadata-details">
        <summary>EXIF metadata <span>{Object.keys(infoData.exif ?? {}).length}</span></summary>
        <div class="exif-rows">
          {#if infoData.taken_at}
            <div class="info-row"><span class="info-k">Captured</span><span class="mono">{infoData.taken_at}</span></div>
          {/if}
          {#if infoData.gps}
            <div class="info-row"><span class="info-k">GPS</span><span class="mono">{formatCoords(infoData.gps)}</span></div>
          {/if}
          {#each Object.entries(infoData.exif ?? {}) as [key, value] (key)}
            <div class="info-row"><span class="info-k">{key}</span><span class="exif-value">{value}</span></div>
          {/each}
        </div>
      </details>
    {/if}

    {#if infoData?.kind === 'video' && Object.keys(infoData.video_metadata ?? {}).length}
      <details class="metadata-details">
        <summary>Video metadata <span>{Object.keys(infoData.video_metadata).length}</span></summary>
        <div class="exif-rows">
          {#if infoData.taken_at}
            <div class="info-row"><span class="info-k">Captured</span><span class="mono">{infoData.taken_at}</span></div>
          {/if}
          {#if infoData.gps}
            <div class="info-row"><span class="info-k">GPS</span><span class="mono">{formatCoords(infoData.gps)}</span></div>
          {/if}
          {#each Object.entries(infoData.video_metadata) as [key, value] (key)}
            <div class="info-row"><span class="info-k">{key}</span><span class="exif-value">{value}</span></div>
          {/each}
        </div>
      </details>
    {/if}

    <label class="modal-label" for="ed-notes">Notes</label>
    <textarea id="ed-notes" class="textarea" rows="3" bind:value={infoNotes} placeholder="Add observations, links, context…"></textarea>

    <span class="modal-label">Folder (My work)</span>
    <FolderSelect bind:value={infoFolder} folders={allFolders} emptyLabel="None" />
    {/if}

    {#if tab === 'case' || unifiedDetails}
      <div class="case-layout">
        {#if declaredFields.length && !unifiedDetails}
          <section class="case-card profile-card">
            <div class="card-head">
              <span class="card-icon"><Icon name={entityIcon(entity)} size={14} /></span>
              <div>
                <h3>Profile</h3>
                <p>{entity.type}</p>
              </div>
            </div>
            <AttrFields type={entity.type} bind:values={infoAttrs} />
          </section>
        {/if}

        {#if canRelate || canMention || hasRelations || lineageCount || placedPoints.length}
          <section class="connections">
            <div class="card-head connections-head"><h3>Connections</h3></div>

            <!-- Read off the chain rather than stored: the label says what the rows
                 offer, and each row names what placed it, because the relation to the
                 point differs per row — a video was placed there by a proof, a proof
                 by the capture it composes. -->
            {#if placedPoints.length}
              <div class="connection-group">
                <div class="connection-head"><h4>On the map</h4></div>
                <div class="placed-items">
                  {#each placedPoints as point (`${point.lat},${point.lon}`)}
                    <div class="placed-item">
                      <span class="mono placed-point">{pointText(point)}</span>
                      {#if point.via}
                        <button
                          class="placed-via"
                          title={`Open ${point.via.label}`}
                          onclick={() => walkTo(point.via.id)}
                        >
                          <Icon name={entityIcon(point.via)} size={12} />
                          <span>via {point.via.label}</span>
                        </button>
                      {/if}
                      <button
                        class="btn btn-ghost btn-sm act"
                        title={`Show ${pointText(point)} on the map`}
                        aria-label={`Show ${pointText(point)} on the map`}
                        onclick={() => gotoPoint(Number(point.lat), Number(point.lon))}
                      >
                        <Icon name="crosshair" size={12} />
                      </button>
                    </div>
                  {/each}
                  {#if placement?.truncated}
                    <p class="placed-more">More points than this panel lists</p>
                  {/if}
                </div>
              </div>
            {/if}

            {#if canRelate || ordinaryRelations.length}
              <div class="connection-group">
                <div class="connection-head">
                  <h4>Relations</h4>
                  {#if canRelate}
                  <button
                    class="btn btn-ghost btn-sm"
                    class:on={connectionComposer === 'relation'}
                    title={relationTargetHint}
                    onclick={() => (connectionComposer = connectionComposer === 'relation' ? null : 'relation')}
                  >Add relation</button>
                  {/if}
                </div>
                <RelationList
                  caseId={caseState.current.id}
                  relations={ordinaryRelations}
                  subjectType={entity.type}
                  subject={entity}
                  actionFilter="relation"
                  onwalk={(target) => walkTo(target.id)}
                  onchanged={reloadCase}
                />
                {#if connectionComposer === 'relation'}
                  <RelationPicker
                    subjectType={entity.type}
                    subject={entity}
                    subjectId={entity.id}
                    action="relation"
                    expanded
                    busy={connectionSaving}
                    oncommit={addConnection}
                    oncancel={() => (connectionComposer = null)}
                  />
                {/if}
              </div>
            {/if}

            {#if canMention || mentionRelations.length}
              <div class="connection-group">
                <div class="connection-head">
                  <h4>Mentions</h4>
                  {#if canMention}
                  <button
                    class="btn btn-ghost btn-sm"
                    class:on={connectionComposer === 'mention'}
                    title={mentionTargetHint}
                    onclick={() => (connectionComposer = connectionComposer === 'mention' ? null : 'mention')}
                  >Add mention</button>
                  {/if}
                </div>
                <RelationList
                  caseId={caseState.current.id}
                  relations={mentionRelations}
                  subjectType={entity.type}
                  subject={entity}
                  actionFilter="mention"
                  onwalk={(target) => walkTo(target.id)}
                  onchanged={reloadCase}
                />
                {#if connectionComposer === 'mention'}
                <RelationPicker
                  subjectType={entity.type}
                  subject={entity}
                  subjectId={entity.id}
                  action="mention"
                  expanded
                  busy={connectionSaving}
                  oncommit={addConnection}
                  oncancel={() => (connectionComposer = null)}
                />
                {/if}
              </div>
            {/if}

            {#if entity.type === 'claim'}
              <div class="connection-group claim-editor">
                <ClaimConnections
                  caseId={caseState.current.id}
                  claim={entity}
                  relations={claimRelations}
                  onwalk={(target) => walkTo(target.id)}
                  onchanged={reloadCase}
                />
              </div>
            {:else if claimRelations.length}
              <div class="connection-group">
                <div class="connection-head"><h4>Claims</h4></div>
                <ClaimReferences
                  relations={claimRelations}
                  onwalk={(target) => walkTo(target.id)}
                />
              </div>
            {/if}

            {#if lineageCount}
          <details class="lineage-card">
            <summary>
              <span class="card-icon"><Icon name="layers" size={14} /></span>
              <span class="lineage-title">{lineageLabel}</span>
              <span class="lineage-count">{lineageCount}</span>
            </summary>
            <div class="lineage-columns">
              {#if chain.sources.length || chain.lost.length}
                <div class="lineage-group">
                  <h4>{entity.type === 'inspect-session' ? 'Depends on' : 'Made from'}</h4>
                  <div class="lineage-items">
                    {#each chain.sources as { entity: src, type } (src.id)}
                      <button class="lineage-item" onclick={() => walkTo(src.id)}>
                        <Icon name={entityIcon(src)} size={12} />
                        <span>{src.label}</span>
                        {#if type === 'depends-on'}
                          <small title="This view needs that item">needs</small>
                        {/if}
                      </button>
                    {/each}
                    {#each chain.lost as lost (lost.path)}
                      <div class="lineage-item gone" title={`Deleted on ${lost.at?.slice(0, 10) ?? 'an unknown date'}${lost.sha256 ? ` · sha256 ${lost.sha256}` : ''}`}>
                        <Icon name="alert" size={12} />
                        <span>{lost.label ?? lost.path}</span>
                        <small>deleted</small>
                      </div>
                      {#if lost.source_url}
                        <a class="lineage-source mono" href={lost.source_url} target="_blank" rel="noreferrer">{lost.source_url}</a>
                      {/if}
                    {/each}
                  </div>
                </div>
              {/if}
              {#if chain.dependents.length}
                <div class="lineage-group">
                  <h4>Used by</h4>
                  <div class="lineage-items">
                    {#each chain.dependents as { entity: dep, type } (dep.id)}
                      <button class="lineage-item" onclick={() => walkTo(dep.id)}>
                        <Icon name={entityIcon(dep)} size={12} />
                        <span>{dep.label}</span>
                        {#if type === 'depends-on'}
                          <small class="warn" title="Deleting this item also deletes that one">goes with it</small>
                        {/if}
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          </details>
            {/if}
          </section>
        {/if}

        {#if !canRelate && !canMention && !hasRelations && !declaredFields.length && !lineageCount}
          <div class="case-card empty-card">
            <Icon name="link" size={16} />
            <p>No profile details or connections yet.</p>
          </div>
        {/if}
      </div>
    {/if}

    <div class="details-actions">
      {#if detailsFilePath && inFileManager}
        <!-- Nothing here can display it, and the browser's answer is a download:
             a second copy in Downloads, worked on outside the case. -->
        <button
          class="btn btn-ghost btn-sm"
          title="Open the folder this file is in"
          onclick={() => showInFolder(entity)}
        >
          <Icon name="folderOpen" size={13} /> Show in folder
        </button>
      {:else if detailsFilePath}
        <a class="btn btn-ghost btn-sm" href={`/files/${caseState.current.id}/${detailsFilePath}`} target="_blank" rel="noreferrer">
          <Icon name="external" size={13} /> Open file
        </a>
      {/if}
      {#if entity.type === 'bookmark' && entity.attrs?.url}
        <a class="btn btn-ghost btn-sm" href={entity.attrs.url} target="_blank" rel="noreferrer">
          <Icon name="external" size={13} /> Open link
        </a>
      {/if}
      <!-- The archived copy is typed in the Case tab, so it needs somewhere to be
           read: a field only ever written is a field nobody trusts. -->
      {#if entity.type === 'bookmark' && entity.attrs?.archive_url}
        <a class="btn btn-ghost btn-sm" href={entity.attrs.archive_url} target="_blank" rel="noreferrer">
          <Icon name="external" size={13} /> Open archived copy
        </a>
      {/if}
      {#if (ENTITY_TOOL[entity.type] && !inFileManager) || entity.type === 'note'}
        <button class="btn btn-ghost btn-sm" onclick={() => { openEntity(entity); onclose?.(); }}>
          <Icon name="arrowRight" size={13} /> {entity.type === 'note' ? 'Open note' : 'Open in tool'}
        </button>
      {/if}
      {#if entity.type === 'capture' && entity.attrs?.lat != null}
        <button class="btn btn-ghost btn-sm" onclick={() => { gotoCapture(entity); onclose?.(); }}>
          <Icon name="crosshair" size={13} /> Go to coords
        </button>
      {/if}
    </div>
    <div class="details-actions">
      <button
        class="btn btn-ghost btn-sm del"
        title="Delete this item and its case files"
        onclick={askDeleteEverywhere}
      >
        <Icon name="trash" size={13} /> Delete
      </button>
      <div style="flex:1"></div>
      <button class="btn btn-primary btn-sm" onclick={saveInfo} disabled={infoSaving}>
        {infoSaving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </div>
{/if}

{#if pendingWalk}
  <ConfirmDialog
    title="Discard changes?"
    message="This item has edits that Save has not taken."
    detail="Following the connection replaces what is on screen."
    confirmLabel="Discard"
    icon="alert"
    onconfirm={() => { walkedId = pendingWalk; pendingWalk = null; }}
    oncancel={() => (pendingWalk = null)}
  />
{/if}

{#if confirmState}
  <ConfirmDialog
    title={confirmState.title}
    message={confirmState.message}
    detail={confirmState.detail}
    consequences={confirmState.consequences}
    restorable={confirmState.restorable}
    confirmLabel="Delete everywhere"
    tone="default"
    icon="trash"
    busy={confirmBusy}
    onconfirm={runConfirm}
    oncancel={() => (confirmState = null)}
  />
{/if}

<style>
  .ed {
    font-size: var(--fs-sm);
  }
  .ed-tabs {
    display: flex;
    gap: 2px;
    margin: 10px 0 8px;
    border-bottom: 1px solid var(--border);
  }
  .ed-tab {
    padding: 5px 10px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-3);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .ed-tab.on {
    color: var(--text-1);
    border-bottom-color: var(--accent);
  }
  .modal-label {
    display: block;
    font-size: var(--fs-xs);
    color: var(--text-3);
    margin: 8px 0 4px;
  }
  .details-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  .details-actions .del {
    color: var(--danger);
  }
  .info-loading {
    font-size: var(--fs-sm);
    color: var(--text-3);
    padding: 6px 0;
  }
  /* the same hairline the relation rows and the board use for a machine's reading */
  .suggested-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
    padding: 7px 9px;
    border-left: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .suggested-bar span {
    flex: 1;
    min-width: 0;
  }
  .info-preview {
    border-radius: var(--r);
    overflow: hidden;
    background: var(--bg-2);
    margin-bottom: 14px;
    max-height: 240px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .info-preview img,
  .info-preview video {
    max-width: 100%;
    max-height: 240px;
    object-fit: contain;
    display: block;
  }
  .info-preview-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
    margin: -6px 0 14px;
  }
  .info-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .info-row {
    display: flex;
    gap: 10px;
    font-size: var(--fs-sm);
    align-items: baseline;
    min-width: 0;
  }
  .info-k {
    color: var(--text-3);
    font-size: var(--fs-xs);
    min-width: 68px;
    flex-shrink: 0;
  }
  .hash {
    font-size: 11px;
    word-break: break-all;
    color: var(--text-2);
  }
  .src {
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .description {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-xs);
    color: var(--text-2);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 8.5em;
    overflow-y: auto;
  }
  .metadata-details {
    margin-top: 12px;
    border-top: 1px solid var(--border);
    padding-top: 8px;
  }
  .metadata-details summary {
    cursor: pointer;
    color: var(--text-2);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .metadata-details summary span {
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 400;
  }
  .exif-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
  }
  .exif-rows .info-k {
    min-width: 120px;
    overflow-wrap: anywhere;
  }
  .exif-value {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .textarea {
    width: 100%;
    resize: vertical;
  }

  /* Case groups fields, connections and lineage without nesting every row in a card. */
  .case-layout {
    display: grid;
    gap: 10px;
    margin-top: 10px;
  }
  .case-card {
    min-width: 0;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--r);
    background: var(--bg-2);
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-bottom: 8px;
  }
  .card-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex: 0 0 auto;
    border-radius: var(--r-sm);
    background: var(--bg-3);
    color: var(--text-2);
  }
  .card-head h3,
  .card-head p,
  .lineage-group h4,
  .empty-card p {
    margin: 0;
  }
  .card-head h3 {
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .card-head p {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .profile-card :global(.attrs) {
    margin-top: 4px;
  }
  .connections {
    min-width: 0;
    padding-top: 2px;
  }
  .connections-head {
    margin-bottom: 5px;
  }
  .connection-group {
    padding: 7px 0;
    border-top: 1px solid var(--border);
  }
  .connection-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 28px;
  }
  .connection-head h4 {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .connection-head .on {
    color: var(--accent);
  }
  /* One row per point: the coordinate reads first because it is what the row is
     for, the attribution second, the map action last — the same order the relation
     rows put a name, its reading and its controls in. */
  .placed-items {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 4px;
  }
  .placed-item {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .placed-point {
    font-size: var(--fs-xs);
  }
  .placed-via {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-3);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }
  .placed-via:hover {
    color: var(--text-1);
  }
  .placed-via span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .placed-item .act {
    margin-left: auto;
    flex: none;
  }
  .placed-more {
    margin: 2px 0 0;
    color: var(--text-3);
    font-size: 10px;
  }
  .lineage-card {
    padding: 0;
    border-top: 1px solid var(--border);
  }
  .lineage-card summary {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 9px 0;
    color: var(--text-2);
    cursor: pointer;
    list-style: none;
  }
  .lineage-card summary::-webkit-details-marker {
    display: none;
  }
  .lineage-title {
    flex: 1;
    font-weight: 600;
  }
  .lineage-count {
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--bg-3);
    color: var(--text-3);
    font-size: 10px;
  }
  .lineage-columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
    padding: 0 0 8px;
  }
  .lineage-group h4 {
    margin-bottom: 6px;
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .lineage-items {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .lineage-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
    padding: 5px 7px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-1);
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-xs);
    text-align: left;
  }
  button.lineage-item {
    cursor: pointer;
  }
  button.lineage-item:hover {
    border-color: var(--border-strong);
    color: var(--text-1);
  }
  .lineage-item span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lineage-item small {
    color: var(--text-3);
    font-size: 10px;
  }
  .lineage-item small.warn {
    color: var(--danger);
  }
  .lineage-item.gone {
    color: var(--text-3);
  }
  .lineage-source {
    display: block;
    width: 100%;
    overflow: hidden;
    color: var(--text-3);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty-card {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 80px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
</style>
