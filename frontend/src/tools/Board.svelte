<script>
  /**
   * The case as its graph: every entity the case holds, filtered, sorted and opened.
   *
   * Until this existed the vocabulary was reachable only through the API. A case
   * could hold a `person`, a `claim` or an `account` — the registry declared them,
   * the relation verbs accepted them — but no screen created one, so a bookmark had
   * nothing to be related *to* and a statement had nowhere to be read. That is what
   * this tool is: create the hand-made types, list what the case holds, and open any
   * row in the same Details panel every other surface uses.
   *
   * Bounded like every other list here (docs/STORAGE_AND_PERFORMANCE.md): one page
   * off the catalog endpoint, filters applied server-side, "Show more" for the rest.
   * A case that fits one page filters in memory, so typing costs no request.
   *
   * One view, a table. Two views of the same rows only asked which one was the real
   * one. The graph is what comes next, and that is a different question, not a
   * different rendering of this list.
   */
  import { api } from '../lib/api.js';
  import { caseState, reloadCase, toast, uiState } from '../lib/state.svelte.js';
  import { buildCatalogQuery } from '../lib/catalog.js';
  import { createPagedList } from '../lib/pagedList.svelte.js';
  import { matchesEntity } from '../lib/entitySearch.js';
  import { entityIcon } from '../lib/entityIcon.js';
  import { folderOf } from '../lib/folderTree.js';
  import { deletedToast } from '../lib/trash.js';
  import {
    creatableTypes,
    entityFamilies,
    entityFamily,
    entityFields,
    entityHint,
    entityIdentityLabel,
    entityIdentityPlaceholder,
    entityLabel,
    entityTypes,
    familyReads,
    loadEntityTypes,
  } from '../lib/entityTypes.svelte.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import SearchInput from '../components/SearchInput.svelte';
  import AttrFields from '../components/AttrFields.svelte';
  import EntityDetails from '../components/EntityDetails.svelte';

  const PAGE = 100;

  loadEntityTypes();

  let family = $state(''); // '' = every family
  let type = $state(''); // '' = every type in the chosen family
  let status = $state(''); // '' = stated and suggested alike
  let query = $state('');
  let sortKey = $state(''); // '' = the catalog's own stable order
  let sortDesc = $state(false);
  let summary = $state(null); // { total, by_type, by_status }
  let openId = $state(null); // the row whose Details are open
  let draft = $state(null); // the entity being created, or null
  let saving = $state(false);
  let busyId = $state(null); // the row whose review action is in flight
  let discarding = $state(false); // Details closing with unsaved fields on screen
  let dirty = $state(false); // Details has edits the panel's Save has not taken

  const families = $derived(entityFamilies());
  /** The type menu follows the family filter: picking "actor" leaves two types to
   *  choose between rather than seventeen. */
  const typesInFamily = $derived(
    entityTypes().filter((entry) => !family || entry.family === family)
  );

  /** What the request asks for. One type when one is picked, the family's whole set
   *  when only a family is, nothing at all when neither — the family layer is server
   *  vocabulary, so it resolves to types here rather than needing a route of its own. */
  const wantedTypes = $derived(
    type ? [type] : family ? typesInFamily.map((entry) => entry.type) : []
  );

  const pl = createPagedList({
    fetchPage: ({ query: q, cursor }) =>
      api.get(
        buildCatalogQuery(caseState.current.id, {
          cursor,
          limit: PAGE,
          types: wantedTypes,
          status: status || undefined,
          query: q || undefined,
        })
      ),
  });

  // Hand the term to the list, which records it on a small case and debounces a
  // server search on a large one. Without this the box would go quiet at exactly
  // the size that needs it: past one page, the rows are the server's answer and
  // filtering them here would search the page rather than the case.
  $effect(() => {
    pl.setQuery(query);
  });

  // A small case never reaches the server for a keystroke, so the term is applied
  // here; a large one is already searching server-side and the rows are the answer.
  // Same predicate either way (`lib/entitySearch.js`), or the box would answer one
  // way under a hundred rows and another way over.
  const matching = $derived(
    pl.serverMode || !query.trim()
      ? pl.items
      : pl.items.filter((e) => matchesEntity(e, query))
  );
  const filtering = $derived(Boolean(family || type || status || query.trim()));
  // What the loaded rows are a part of. Under a filter that is the filtered count
  // the page itself reports, never the case-wide summary: "40 of 5000" while
  // showing places is a denominator from a different question.
  const total = $derived(filtering ? pl.total : summary?.total ?? pl.total);

  /** The columns a table shows beyond the ones every entity has. Only when a single
   *  type is picked: a mixed list has no shared attributes, and a column that is
   *  blank for four rows out of five is noise. Read-only here — editing cells and
   *  CSV are the Case Sheet's, not this list's. */
  const columns = $derived(type ? entityFields(type) : []);

  /** What the first column is called. Once a single type is picked it holds that
   *  type's own identity — an IP address, a handle — and the create form already
   *  says so; "Name" over a column of addresses is the same lie this vocabulary
   *  went to the trouble of avoiding. Mixed rows have no such reading. */
  const identityColumn = $derived(type ? entityIdentityLabel(type) : 'Name');

  /** Sorted over what is loaded, which is what the row count beside "Show more"
   *  says. The catalog's own order is a stable cursor order rather than an
   *  alphabet, so sorting server-side would mean paging by a second key; over one
   *  bounded page there is nothing to gain from it. */
  const rows = $derived.by(() => {
    if (!sortKey) return matching;
    const direction = sortDesc ? -1 : 1;
    return [...matching].sort((a, b) => {
      const left = sortValue(a, sortKey);
      const right = sortValue(b, sortKey);
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
      return String(left).localeCompare(String(right)) * direction;
    });
  });

  function sortValue(entity, key) {
    if (key === 'label') return (entity.label ?? '').toLowerCase();
    if (key === 'type') return entityLabel(entity.type).toLowerCase();
    if (key === 'folder') return folderName(entity).toLowerCase();
    if (key === 'created') return entity.provenance?.at ?? '';
    const field = columns.find((column) => column.key === key);
    if (!field) return '';
    // a number sorts as one: "100" before "25" is the classic table bug
    if (field.kind === 'number') {
      const value = Number(entity.attrs?.[field.key]);
      return Number.isFinite(value) ? value : -Infinity;
    }
    return cell(entity, field).toLowerCase();
  }

  /** Click a heading to sort by it, click it again to reverse. A third click is not
   *  a third state: the catalog's order is what the empty sort already is. */
  function sortBy(key) {
    if (sortKey === key) sortDesc = !sortDesc;
    else {
      sortKey = key;
      sortDesc = false;
    }
  }

  let loadedFor = null;
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev; // a save, a delete or a relation stated in the panel
    if (!id) {
      pl.clear();
      summary = null;
      loadedFor = null;
      return;
    }
    if (loadedFor !== id) {
      loadedFor = id;
      pl.clear();
    }
    void pl.reload();
    api
      .get(`/api/cases/${id}/catalog/summary`)
      .then((s) => {
        if (caseState.current?.id === id) summary = s;
      })
      .catch(() => {});
  });

  // A filter is a different request, so the baseline is re-established rather than
  // filtered out of what is already loaded — page two of "every type" is not page
  // two of "places".
  // Seeded with the filters' own initial value, so opening the board is one request
  // rather than this effect and the case effect above both asking for page one.
  let lastFilter = '||';
  $effect(() => {
    const key = `${family}|${type}|${status}`;
    if (key === lastFilter) return;
    lastFilter = key;
    if (caseState.current?.id) void pl.reload();
  });

  // A column that is no longer on screen cannot go on ordering the table.
  $effect(() => {
    const keys = ['label', 'type', 'folder', 'created', ...columns.map((c) => c.key)];
    if (sortKey && !keys.includes(sortKey)) sortKey = '';
  });

  function setFamily(value) {
    family = value;
    // a type from the family being left would filter to nothing
    if (type && !entityTypes().some((e) => e.type === type && (!value || e.family === value))) {
      type = '';
    }
  }

  /** Start from what the analyst is already looking at: the chosen type, or the
   *  first type of the chosen family. Opening on "Person" while the family filter
   *  says Identifier is the menu ignoring the question just asked. */
  function startCreate() {
    const inFamily = creatableTypes().filter((entry) => !family || entry.family === family);
    draft = {
      type: type || inFamily[0]?.type || creatableTypes()[0]?.type || '',
      label: '',
      notes: '',
      attrs: {},
    };
  }

  /**
   * An entity of the same type already carrying this exact value.
   *
   * Only a warning, and only where it means something: in the `identifier` family
   * the value *is* the identity, so two `email` rows holding one address are two
   * records of one thing (ONTOLOGY §2). It does not block — merging is not shipped,
   * and refusing the second entry would leave nowhere to put it — it offers the
   * existing row instead, which is what the analyst almost always wanted.
   */
  let twin = $state(null);
  $effect(() => {
    const label = draft?.label.trim();
    const kind = draft?.type;
    const caseId = caseState.current?.id;
    if (!label || !caseId || entityFamily(kind) !== 'identifier') {
      twin = null;
      return;
    }
    // debounced like every other search here: an address is typed one character at
    // a time and none of the first fifteen is a question worth asking
    let live = true;
    const timer = setTimeout(() => {
      api
        .get(buildCatalogQuery(caseId, { types: [kind], query: label, limit: 20 }))
        .then((page) => {
          if (!live) return;
          const wanted = label.toLowerCase();
          twin = (page.items ?? []).find((e) => (e.label ?? '').toLowerCase() === wanted) ?? null;
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

  /** Accept a machine's proposal. The far end of its suggested relations comes with
   *  it, which is the invariant the API keeps: an edge is confirmed together with
   *  the entity it hangs off, or neither is. */
  async function confirmEntity(entity) {
    if (busyId) return;
    busyId = entity.id;
    try {
      await api.patch(`/api/cases/${caseState.current.id}/entities/${entity.id}`, {
        status: 'confirmed',
      });
      await reloadCase();
      toast('Confirmed', 'ok', 1600);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      busyId = null;
    }
  }

  /** Drop a proposal. The standard delete, so it lands in the case trash with the
   *  same Undo as every other one — dismissing a machine's reading is not a reason
   *  to make it unrecoverable. */
  async function dismissEntity(entity) {
    if (busyId) return;
    busyId = entity.id;
    const caseId = caseState.current.id;
    try {
      const result = await api.del(`/api/cases/${caseId}/entities/${entity.id}`);
      await reloadCase();
      deletedToast(caseId, result, entity.label);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      busyId = null;
    }
  }

  const draftIdentityLabel = $derived(entityIdentityLabel(draft?.type));
  const draftIdentityPlaceholder = $derived(entityIdentityPlaceholder(draft?.type));

  /** Create it, then open it. A claim exists in order to be pointed at things, so
   *  landing on its own Details with the relation picker is the next gesture, not a
   *  detour. */
  async function create() {
    if (!draft || saving) return;
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
      draft = null;
      await reloadCase();
      openId = entity.id;
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      saving = false;
    }
  }

  /**
   * Take a file into the case: a PDF, a scan, a plan, an exported mail.
   *
   * The same import the Media Library runs, offered where the case is read rather
   * than only under "Media" — a word that says nothing about a scanned plan. The
   * file lands as a `media` of whatever kind its bytes are (ONTOLOGY §2), hashed,
   * deduped on that hash, and relatable like everything else here.
   */
  let fileInput = $state();
  let importing = $state(false);
  let dragOver = $state(false);

  async function importFiles(fileList) {
    const files = [...(fileList ?? [])];
    if (!files.length || !caseState.current || importing) return;
    const caseId = caseState.current.id;
    importing = true;
    let added = 0;
    let duplicates = 0;
    let last = null;
    try {
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        try {
          const result = await api.post(`/api/cases/${caseId}/media/upload`, form);
          if (result.duplicate) duplicates++;
          else added++;
          last = result.entity?.id ?? last;
        } catch (e) {
          toast(`${file.name}: ${e.message}`, 'danger');
        }
      }
      await reloadCase();
      if (added) toast(`${added} file${added > 1 ? 's' : ''} added to the case`, 'ok');
      // The same bytes twice is not an error and not a second item: the case keeps
      // the one it has, and saying so is what stops the analyst importing again.
      if (duplicates) {
        toast(
          `${duplicates} duplicate${duplicates > 1 ? 's' : ''} skipped (same SHA-256)`,
          'warn'
        );
      }
      // One file opens where the analyst can say what it is; a batch does not, since
      // a panel over the list would be about whichever one happened to land last.
      if (files.length === 1 && last) openId = last;
    } finally {
      importing = false;
    }
  }

  function closeDetails() {
    if (dirty) discarding = true;
    else openId = null;
  }

  // Following a relation to a person, an account or a claim lands here: those types
  // have no tool of their own, so `navigate.openEntity` hands the id over instead.
  $effect(() => {
    const id = uiState.openBoardEntity;
    if (!id) return;
    uiState.openBoardEntity = null;
    openId = id;
  });

  const folderName = (entity) => folderOf(entity) || '';
  const created = (entity) => (entity.provenance?.at ?? '').slice(0, 10);
  const isSuggested = (entity) => entity.provenance?.status === 'suggested';
  /** Declared fields hold text, a number or a closed grade. A shape is not
   *  a cell, so it says what it is rather than spilling coordinates across a row. */
  const cell = (entity, field) => {
    const value = entity.attrs?.[field.key];
    if (value == null || value === '') return '';
    if (field.kind === 'geojson') return 'traced area';
    return String(value);
  };
</script>

<div class="tool">
  <div class="tool-header">
    <h2>Board</h2>
    <span class="sub">Everything this case holds</span>
    <div class="spacer"></div>
    <button
      class="btn"
      title="Take a file into the case: a document, a scan, a plan, an image"
      disabled={!caseState.current || importing}
      onclick={() => fileInput?.click()}
    >
      <Icon name="upload" size={14} /> {importing ? 'Adding…' : 'Add file'}
    </button>
    <input
      type="file"
      multiple
      hidden
      bind:this={fileInput}
      onchange={(e) => {
        importFiles(e.currentTarget.files);
        e.currentTarget.value = '';
      }}
    />
    <button class="btn btn-primary" onclick={startCreate} disabled={!caseState.current}>
      <Icon name="plus" size={14} /> New entity
    </button>
  </div>

  <div class="toolbar">
    <SearchInput
      bind:value={query}
      placeholder="Search the case…"
      count={filtering ? `${rows.length} shown` : null}
      width="200px"
    />

    <select
      class="select filter"
      value={family}
      onchange={(e) => setFamily(e.currentTarget.value)}
      title={familyReads(family) || 'Filter by family'}
    >
      <option value="">Every family</option>
      {#each families as name (name)}
        <!-- the slug with a capital, not a second vocabulary: the families are
             code, and inventing readings for them here is how two lists start.
             Each option carries its own clause: a reading only visible once the
             family is chosen explains it to whoever already knew. -->
        <option value={name} title={familyReads(name)}>
          {name.charAt(0).toUpperCase() + name.slice(1)}
        </option>
      {/each}
    </select>

    <select
      class="select filter"
      bind:value={type}
      title={entityHint(type) || 'Filter by type'}
    >
      <option value="">Every type</option>
      {#each typesInFamily as entry (entry.type)}
        <option value={entry.type}>
          {entry.label}{summary?.by_type?.[entry.type] ? ` (${summary.by_type[entry.type]})` : ''}
        </option>
      {/each}
    </select>

    <!-- The two words the rest of the app already uses for these statuses: a row is
         suggested until someone confirms it, and the Confirm button is what moves it.
         Inventing a third pair of words here would make the same click read two ways. -->
    <select class="select filter" title="Show what a tool proposed, or what was confirmed"
      bind:value={status}>
      <option value="">Confirmed and suggested</option>
      <option value="confirmed">Confirmed</option>
      <option value="suggested">Suggested</option>
    </select>
  </div>

  <!-- Dropping a file onto the list files it, the way the Media Library takes one.
       `dragleave` is guarded on the container itself: the event fires for every
       child the pointer crosses, so an unguarded handler flickers the overlay off
       halfway across the table. -->
  <div
    class="body"
    role="presentation"
    ondragover={(e) => {
      if (!caseState.current) return;
      e.preventDefault();
      dragOver = true;
    }}
    ondragleave={(e) => {
      if (e.target === e.currentTarget) dragOver = false;
    }}
    ondrop={(e) => {
      e.preventDefault();
      dragOver = false;
      importFiles(e.dataTransfer?.files);
    }}
  >
    {#if dragOver}
      <div class="drop-overlay">
        <div class="drop-box">
          <Icon name="upload" size={28} />
          <span>Drop to file it in this case</span>
        </div>
      </div>
    {/if}
    {#if !caseState.current}
      <p class="empty">Open a case to see what it holds.</p>
    {:else if !rows.length && !pl.loading}
      <p class="empty">{filtering ? 'Nothing matches.' : 'Nothing filed in this case yet.'}</p>
    {:else}
      <table class="table">
        <thead>
          <tr>
            {#each [
              { key: 'label', label: identityColumn },
              { key: 'type', label: 'Type' },
              { key: 'folder', label: 'Folder', hint: 'the My-work folder it is filed in' },
              { key: 'created', label: 'Created', hint: 'when it was filed into the case' },
              ...columns,
            ] as column (column.key)}
              <th aria-sort={sortKey === column.key ? (sortDesc ? 'descending' : 'ascending') : 'none'}>
                <button class="sorter" title={column.hint ?? ''} onclick={() => sortBy(column.key)}>
                  {column.label}
                  {#if sortKey === column.key}
                    <Icon name={sortDesc ? 'chevronDown' : 'chevronUp'} size={11} />
                  {/if}
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each rows as entity (entity.id)}
            <!-- A row is a control: focusable and answering Enter, because a table
                 nobody can walk with the keyboard is a table half the analysts
                 cannot use. -->
            <tr
              class:suggested={isSuggested(entity)}
              class:busy={busyId === entity.id}
              tabindex="0"
              onclick={() => (openId = entity.id)}
              onkeydown={(e) => {
                // only the row's own key press: Enter on the confirm button inside
                // it is that button's, and would otherwise open Details as well
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openId = entity.id;
                }
              }}
            >
              <td>
                <Icon name={entityIcon(entity)} size={12} />
                <span class="name">{entity.label}</span>
                {#if isSuggested(entity)}
                  <span class="tag" title="a tool proposed this, and nobody has confirmed it">
                    suggested
                  </span>
                  <!-- Settled where it is read. Filtering to the proposals and then
                       having to open each one to accept it made the filter a list
                       nobody could act on. -->
                  <span class="review">
                    <button
                      class="btn btn-ghost btn-sm act ok"
                      title="Confirm this item"
                      disabled={busyId === entity.id}
                      onclick={(e) => { e.stopPropagation(); confirmEntity(entity); }}
                    >
                      <Icon name="check" size={12} />
                    </button>
                    <button
                      class="btn btn-ghost btn-sm act no"
                      title="Dismiss this item, recoverable from the trash"
                      disabled={busyId === entity.id}
                      onclick={(e) => { e.stopPropagation(); dismissEntity(entity); }}
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </span>
                {/if}
              </td>
              <td title={entityHint(entity.type)}>{entityLabel(entity.type)}</td>
              <td class="dim">{folderName(entity)}</td>
              <td class="dim mono">{created(entity)}</td>
              {#each columns as column (column.key)}<td class="dim">{cell(entity, column)}</td>{/each}
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    {#if pl.hasMore}
      <div class="more">
        <!-- The sort runs over what is loaded, so it says so while there is more:
             an alphabet over the first hundred of eight hundred rows looks exactly
             like an alphabet over the case. -->
        <span class="dim">
          Showing {rows.length} of {total}{sortKey ? ', sorted over the rows loaded' : ''}
        </span>
        <button class="btn btn-ghost btn-sm" onclick={() => pl.loadMore()} disabled={pl.loading}>
          {pl.loading ? 'Loading…' : 'Show more'}
        </button>
      </div>
    {/if}
  </div>
</div>

{#if draft}
  <Modal title="New entity" onclose={() => (draft = null)} width="560px">
    <label class="modal-label" for="board-type">Type</label>
    <!-- the menu says what each type is for: `claim` and `capture` are terse words
         nobody can look up, and choosing the wrong one is a filing mistake -->
    <select id="board-type" class="select" bind:value={draft.type} title={entityHint(draft.type)}>
      {#each creatableTypes() as entry (entry.type)}
        <option value={entry.type}>{entry.label}</option>
      {/each}
    </select>
    {#if entityHint(draft.type)}
      <p class="field-help">{entityHint(draft.type)}</p>
    {/if}

    <section class="create-card">
      <label class="modal-label" for="board-label">{draftIdentityLabel}</label>
      <input
        id="board-label"
        class="input"
        placeholder={draftIdentityPlaceholder}
        bind:value={draft.label}
        onkeydown={(e) => e.key === 'Enter' && create()}
      />

      {#if twin}
        <p class="twin">
          This case already holds
          <button
            class="twin-open"
            onclick={() => { const id = twin.id; draft = null; openId = id; }}
          >{twin.label}</button>. On an identifier the value is the identity, so
          this would be a second record of one thing.
        </p>
      {/if}

      <!-- whatever else this type declares, generated from the registry -->
      <AttrFields type={draft.type} bind:values={draft.attrs} />

      <label class="modal-label" for="board-notes">Notes</label>
      <textarea
        id="board-notes"
        class="textarea"
        rows="3"
        placeholder="Add context or observations"
        bind:value={draft.notes}
      ></textarea>
    </section>

    <div class="modal-row">
      <div style="flex:1"></div>
      <button class="btn" onclick={() => (draft = null)}>Cancel</button>
      <button
        class="btn btn-primary"
        onclick={create}
        disabled={saving || !draft.type || !draft.label.trim()}
      >
        {saving ? 'Creating…' : 'Create'}
      </button>
    </div>
  </Modal>
{/if}

{#if openId}
  <!-- Escape and the backdrop both close a modal, and the panel's fields wait for
       Save: closing over unsaved edits threw them away without a word. The ask is
       only raised when there is something to lose. -->
  <Modal title="Details" onclose={closeDetails} width="640px">
    <!-- The panel's own `onclose` is its hand-off to another tool — it has already
         navigated by the time it fires, so it closes rather than asking. -->
    <EntityDetails
      entityId={openId}
      bind:dirty
      onclose={() => (openId = null)}
      ondeleted={() => (openId = null)}
    />
  </Modal>
{/if}

{#if discarding}
  <ConfirmDialog
    title="Discard changes?"
    message="This item has edits that Save has not taken."
    confirmLabel="Discard"
    icon="alert"
    onconfirm={() => { discarding = false; dirty = false; openId = null; }}
    oncancel={() => (discarding = false)}
  />
{/if}

<style>
  .spacer {
    flex: 1;
  }
  .field-help {
    margin: 5px 0 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
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
  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    padding: 9px 16px;
    border-bottom: 1px solid var(--border);
  }
  .filter {
    width: auto;
    padding: 4px 8px;
    font-size: var(--fs-xs);
  }
  /* The one scrolling region. `.tool` is a full-height flex column, so the body
     needs min-height:0 or the table pushes the column taller than the viewport and
     nothing scrolls at all. */
  .body {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 16px 16px;
  }
  .drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--bg-1) 82%, transparent);
    backdrop-filter: blur(2px);
    pointer-events: none;
  }
  .drop-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 22px 30px;
    border: 1px dashed var(--accent);
    border-radius: var(--r);
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .empty {
    color: var(--text-3);
    font-size: var(--fs-sm);
    padding: 24px 2px;
  }
  .table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
  }
  /* the headings stay put while the rows scroll under them */
  .table th {
    position: sticky;
    top: 0;
    z-index: 1;
    text-align: left;
    padding: 0;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .sorter {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 8px 10px 8px 0;
    border: 0;
    background: none;
    color: var(--text-3);
    font: inherit;
    font-size: var(--fs-xs);
    font-weight: 600;
    cursor: pointer;
  }
  .sorter:hover {
    color: var(--text-1);
  }
  .table td {
    padding: 6px 10px 6px 0;
    border-bottom: 1px solid var(--border);
    color: var(--text-2);
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .table tbody tr {
    cursor: pointer;
    border-left: 2px solid transparent;
  }
  /* a machine's proposal, marked the way the relation rows mark one */
  .table tbody tr.suggested {
    border-left-color: color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .table tbody tr:hover td,
  .table tbody tr:focus-visible td {
    background: var(--bg-2);
    color: var(--text-1);
  }
  .table tbody tr:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .table tbody tr.busy {
    opacity: 0.5;
  }
  /* the two review clicks, quiet until the row is under the pointer or focused */
  .review {
    display: inline-flex;
    gap: 1px;
    margin-left: 4px;
    opacity: 0.55;
    vertical-align: -3px;
  }
  tr:hover .review,
  tr:focus-within .review {
    opacity: 1;
  }
  .act {
    padding-inline: 5px;
  }
  .act.ok:hover {
    color: var(--ok, #46a758);
  }
  .act.no:hover {
    color: var(--danger);
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
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dim {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .tag {
    font-size: 10px;
    padding: 1px 5px;
    margin-left: 6px;
    border-radius: 999px;
    background: var(--bg-2);
    color: var(--text-3);
  }
  .table td :global(svg) {
    display: inline-block;
    vertical-align: -2px;
    margin-right: 6px;
  }
  .more {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 10px;
  }
</style>
