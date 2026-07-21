<script>
  import {
    caseState,
    refreshCaseList,
    openCase,
    createCase,
    promoteCase,
    renameCase,
    closeCase,
    deleteCase,
    toast,
  } from '../lib/state.svelte.js';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';

  let open = $state(false);
  let modal = $state(null); // 'create' | 'promote' | 'rename' | null
  let nameInput = $state('');
  let busy = $state(false);
  let renameId = $state(null); // id of the case being renamed (modal === 'rename')

  function askRename(c) {
    open = false;
    modal = 'rename';
    renameId = c.id;
    nameInput = c.name ?? c.id;
  }

  // Delete flow: the whole case folder is wiped, so we make the user type
  // DELETE (uppercase) to confirm. `delTarget` holds the case being deleted.
  let delTarget = $state(null); // { id, name } | null
  let delConfirm = $state('');
  let delBusy = $state(false);
  const delReady = $derived(delConfirm === 'DELETE');

  function askDelete(c) {
    open = false;
    delTarget = { id: c.id, name: c.name ?? c.id };
    delConfirm = '';
  }

  async function confirmDelete() {
    if (!delReady || delBusy || !delTarget) return;
    delBusy = true;
    try {
      await deleteCase(delTarget.id);
      toast(`Case “${delTarget.name}” deleted`, 'ok');
      delTarget = null;
      delConfirm = '';
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      delBusy = false;
    }
  }

  async function toggle() {
    open = !open;
    if (open) await refreshCaseList();
  }

  async function pick(id) {
    open = false;
    await openCase(id);
  }

  async function submit() {
    const name = nameInput.trim();
    if (!name || busy || nameTaken) return;
    busy = true;
    try {
      if (modal === 'create') {
        await createCase(name);
        toast(`Case “${name}” created`, 'ok');
      } else if (modal === 'promote') {
        await promoteCase(name);
      } else if (modal === 'rename') {
        await renameCase(renameId, name);
        toast(`Renamed to “${name}”`, 'ok');
      }
      modal = null;
      nameInput = '';
      renameId = null;
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      busy = false;
    }
  }

  const named = $derived(caseState.list.filter((c) => !c.scratch));
  const scratches = $derived(caseState.list.filter((c) => c.scratch));

  // Guard against duplicate names (case-insensitive) — the backend enforces
  // this too, but flag it early so the button disables instead of erroring.
  const nameTaken = $derived(
    !!nameInput.trim() &&
      named.some(
        (c) =>
          c.id !== renameId &&
          c.name.trim().toLowerCase() === nameInput.trim().toLowerCase()
      )
  );
</script>

<div class="switcher">
  <button class="current" onclick={toggle} title="Switch case">
    <Icon name={caseState.current ? 'folderOpen' : 'folder'} size={16} />
    {#if caseState.current}
      <span class="name">{caseState.current.name}</span>
      {#if caseState.current.scratch}<span class="badge accent">scratch</span>{/if}
    {:else}
      <span class="name none">No case (one-shot mode)</span>
    {/if}
    <Icon name="chevronDown" size={14} />
  </button>

  {#if caseState.current?.scratch}
    <button
      class="btn btn-primary btn-sm"
      onclick={() => {
        modal = 'promote';
        nameInput = '';
      }}
    >
      <Icon name="upload" size={13} /> Keep as case…
    </button>
  {/if}

  {#if open}
    <button class="backdrop" onclick={() => (open = false)} aria-label="Close menu"></button>
    <div class="menu card">
      <button
        class="item new"
        onclick={() => {
          open = false;
          modal = 'create';
          nameInput = '';
        }}
      >
        <Icon name="plus" size={15} /> New case…
      </button>
      {#if caseState.current}
        <button class="item" onclick={() => { closeCase(); open = false; }}>
          <Icon name="x" size={15} /> Close case (one-shot mode)
        </button>
      {/if}
      {#if named.length}
        <div class="section">Cases</div>
        {#each named as c (c.id)}
          <div class="row" class:active={c.id === caseState.current?.id}>
            <button class="item" onclick={() => pick(c.id)}>
              <Icon name="folder" size={15} />
              <span class="grow">{c.name}</span>
              <span class="meta">{c.entity_count} entities</span>
            </button>
            <button class="del rename" title="Rename case" onclick={() => askRename(c)}>
              <Icon name="edit" size={14} />
            </button>
            <button class="del" title="Delete case" onclick={() => askDelete(c)}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        {/each}
      {/if}
      {#if scratches.length}
        <div class="section">Scratch sessions</div>
        {#each scratches as c (c.id)}
          <div class="row" class:active={c.id === caseState.current?.id}>
            <button class="item" onclick={() => pick(c.id)}>
              <Icon name="clock" size={15} />
              <span class="grow">{c.id}</span>
            </button>
            <button class="del" title="Delete session" onclick={() => askDelete(c)}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        {/each}
      {/if}
      {#if !named.length && !scratches.length}
        <div class="hint">No cases yet. Tools work without one.</div>
      {/if}
    </div>
  {/if}
</div>

{#if modal}
  <Modal
    title={modal === 'create'
      ? 'New case'
      : modal === 'rename'
        ? 'Rename case'
        : 'Keep this session as a case'}
    onclose={() => (modal = null)}
  >
    <form
      onsubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label class="label" for="case-name">Case name</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="case-name"
        class="input"
        placeholder="e.g. March 2026 incident"
        bind:value={nameInput}
        autofocus
      />
      {#if nameTaken}
        <p class="err">A case with this name already exists. Pick another.</p>
      {/if}
      <div class="actions">
        <button type="button" class="btn" onclick={() => (modal = null)}>Cancel</button>
        <button
          type="submit"
          class="btn btn-primary"
          disabled={!nameInput.trim() || busy || nameTaken}
        >
          {modal === 'create' ? 'Create' : modal === 'rename' ? 'Rename' : 'Promote'}
        </button>
      </div>
    </form>
  </Modal>
{/if}

{#if delTarget}
  <Modal title="Delete case" onclose={() => (delTarget = null)}>
    <div class="warn">
      <span class="warn-badge"><Icon name="trash" size={18} /></span>
      <div>
        <p class="warn-title">
          You will lose everything in “{delTarget.name}”.
        </p>
        <p class="warn-body">
          This permanently deletes the whole case folder, including its media,
          satellite crops, proofs, exports and notes. It cannot be undone.
        </p>
      </div>
    </div>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        confirmDelete();
      }}
    >
      <label class="label" for="del-confirm">Type <b>DELETE</b> to confirm</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="del-confirm"
        class="input"
        placeholder="DELETE"
        bind:value={delConfirm}
        autocomplete="off"
        autofocus
      />
      <div class="actions">
        <button type="button" class="btn" onclick={() => (delTarget = null)}>Cancel</button>
        <button type="submit" class="btn btn-danger" disabled={!delReady || delBusy}>
          {delBusy ? 'Deleting…' : 'Delete everything'}
        </button>
      </div>
    </form>
  </Modal>
{/if}

<style>
  .switcher {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .current {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: var(--r-sm);
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
    border: 1px solid transparent;
    max-width: 380px;
  }
  .current:hover {
    background: var(--bg-2);
    border-color: var(--border);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name.none {
    color: var(--text-3);
    font-weight: 500;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    cursor: default;
  }
  .menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    min-width: 300px;
    max-height: 420px;
    overflow: auto;
    z-index: 100;
    box-shadow: var(--shadow-2);
    padding: 6px;
  }
  .section {
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-3);
    padding: 10px 10px 4px;
  }
  .row {
    display: flex;
    align-items: center;
    border-radius: var(--r-sm);
  }
  .row:hover {
    background: var(--bg-2);
  }
  .row.active {
    background: var(--bg-3);
  }
  .row.active .item {
    color: var(--text-1);
  }
  .row .item {
    flex: 1;
    min-width: 0;
    background: none;
  }
  .row .item:hover {
    background: none;
  }
  .del {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    padding: 8px 10px;
    color: var(--text-3);
    opacity: 0;
    border-radius: var(--r-sm);
  }
  .row:hover .del {
    opacity: 1;
  }
  .del:hover {
    color: var(--danger, #e5484d);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 8px 10px;
    border-radius: var(--r-sm);
    font-size: var(--fs-sm);
    color: var(--text-1);
    text-align: left;
  }
  .item:hover {
    background: var(--bg-2);
  }
  .warn {
    display: flex;
    gap: 13px;
    align-items: flex-start;
    margin-bottom: 16px;
  }
  .warn-badge {
    flex-shrink: 0;
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: color-mix(in srgb, var(--danger, #e5484d) 16%, transparent);
    color: var(--danger, #e5484d);
  }
  .warn-title {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-1);
    margin-bottom: 4px;
  }
  .warn-body {
    font-size: var(--fs-xs);
    color: var(--text-3);
    line-height: 1.45;
  }
  .btn-danger {
    background: var(--danger, #e5484d);
    color: #fff;
    border-color: transparent;
  }
  .btn-danger:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  .item.new {
    color: var(--accent);
    font-weight: 600;
  }
  .grow {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .hint {
    padding: 14px 10px;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
  .err {
    font-size: var(--fs-xs);
    color: var(--danger, #e5484d);
    margin-top: 8px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
</style>
