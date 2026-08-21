<script>
  /** Named, case-owned readings. Board and Graph share a family of views; the
   *  Timeline has its own — see `lib/analysisSearch.svelte.js`. */
  import { api } from '../lib/api.js';
  import {
    activateAnalysisView,
    adoptSavedAnalysisView,
    leaveAnalysisView,
    renameAnalysisView,
    viewFamily,
    viewSlot,
  } from '../lib/analysisSearch.svelte.js';
  import {
    copyName,
    exactStamp,
    readViewOrder,
    sortViews,
    timeAgo,
    viewOrders,
    writeViewOrder,
  } from '../lib/analysisViews.js';
  import { closeOnOutsidePointer } from '../lib/dismiss.js';
  import { restoreGroup } from '../lib/trash.js';
  import { caseState, registerCaseChangeGuard, toast } from '../lib/state.svelte.js';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';

  let {
    surface = 'board',
    capture = () => ({}),
    onopen = () => {},
    onleave = () => {},
  } = $props();

  /**
   * The views this surface can open, and the slot it reads.
   *
   * Board and Graph draw one question, so they share both. The Timeline asks about
   * time and shares with neither: a list mixing the two offered readings that the
   * surface underneath could not draw.
   */
  const family = $derived(viewFamily(surface));
  const slot = $derived(viewSlot(surface));
  let stored = $state([]);
  const views = $derived(stored.filter((view) => viewFamily(view.surface) === family));
  let menu = $state(false);
  let anchor = $state(null);
  let saving = $state(false);
  let name = $state('');
  let mode = $state('live');
  let busy = $state(false);
  let loadedFor = null;
  /** The chosen ordering, remembered per family. */
  let order = $state('recent');
  let orderedFor = null;
  const orders = $derived(viewOrders(family));
  const rows = $derived(sortViews(views, order));
  /** Read when the menu opens: a popover is not open long enough for "5 min ago"
   *  to drift, and a ticking clock would redraw the list under the pointer. */
  let now = $state(Date.now());
  /** The row being relabelled, and the name being typed into it. */
  let renaming = $state(null);
  let draft = $state('');
  let readRun = 0;
  let autoTimer = 0;
  let activeSave = null;
  const AUTO_SAVE_AFTER = 650;
  const snapshotNote = $derived(
    surface === 'timeline'
      ? 'Freezes up to 5,000 timeline entries.'
      : 'Freezes up to 2,000 entities and their relations.'
  );

  const activeStatus = $derived.by(() => {
    if (slot.activeView?.mode !== 'live') return 'snapshot';
    if (slot.saveState === 'error') return 'live · save failed';
    if (slot.modified || slot.saveState === 'saving') {
      return 'live · saving…';
    }
    return 'live · saved';
  });

  async function read() {
    const caseId = caseState.current?.id;
    const run = ++readRun;
    if (!caseId) {
      stored = [];
      return;
    }
    try {
      const body = await api.get(`/api/cases/${caseId}/analysis-views`);
      if (run === readRun && caseState.current?.id === caseId) stored = body.views ?? [];
    } catch {
      if (run === readRun) stored = [];
    }
  }

  $effect(() => {
    const caseId = caseState.current?.id ?? null;
    if (caseId === loadedFor) return;
    loadedFor = caseId;
    menu = false;
    saving = false;
    renaming = null;
    void read();
  });

  $effect(() => {
    if (family === orderedFor) return;
    orderedFor = family;
    order = readViewOrder(family);
  });

  function chooseOrder(value) {
    order = value;
    writeViewOrder(family, value);
  }

  function openMenu() {
    now = Date.now();
    renaming = null;
    menu = !menu;
  }

  function updateSummary(view) {
    stored = stored.map((row) => row.id === view.id
      ? {
          ...row,
          name: view.name,
          mode: view.mode,
          surface: view.surface,
          updated_at: view.updated_at,
        }
      : row);
  }

  /** Save the active recipe without reopening it over edits made while the request
   *  was in flight. Concurrent requests queue behind the same promise. */
  async function persistActive() {
    while (activeSave) await activeSave;
    const caseId = caseState.current?.id;
    const current = slot.activeView;
    if (
      !caseId || !current || current.mode !== 'live' || current.surface !== surface ||
      !slot.modified
    ) return true;

    const viewId = current.id;
    const version = slot.changeVersion;
    slot.saveState = 'saving';
    const request = (async () => {
      try {
        const spec = await capture('live');
        const view = await api.put(`/api/cases/${caseId}/analysis-views/${viewId}`, {
          name: current.name,
          mode: 'live',
          surface: current.surface,
          spec,
        });
        if (!adoptSavedAnalysisView(caseId, view)) return true;
        updateSummary(view);
        if (slot.changeVersion === version) {
          slot.modified = false;
          slot.saveState = 'saved';
        }
        return true;
      } catch (error) {
        if (
          caseState.current?.id === caseId &&
          slot.activeView?.id === viewId
        ) slot.saveState = 'error';
        toast(error.message || 'The live view could not be saved.', 'danger');
        return false;
      }
    })();
    activeSave = request;
    try {
      return await request;
    } finally {
      if (activeSave === request) activeSave = null;
    }
  }

  $effect(() => {
    const caseId = caseState.current?.id;
    const current = slot.activeView;
    // Read every edit revision even while `modified` was already true, so typing,
    // repeated drags and consecutive folds restart one quiet-period timer.
    void slot.changeVersion;
    clearTimeout(autoTimer);
    autoTimer = 0;
    if (!caseId || !current || current.mode !== 'live' || current.surface !== surface) return;
    if (!slot.modified) {
      if (!activeSave && slot.saveState !== 'saved') {
        slot.saveState = 'saved';
      }
      return;
    }
    slot.saveState = 'saving';
    autoTimer = setTimeout(() => {
      autoTimer = 0;
      void persistActive();
    }, AUTO_SAVE_AFTER);
    return () => {
      clearTimeout(autoTimer);
      autoTimer = 0;
    };
  });

  // A case switch is allowed only after this surface has filed its last live edit.
  // `openCase` runs the guard while the old case is still current, so the request
  // can never be sent to the case being opened.
  $effect(() => registerCaseChangeGuard(() => persistActive()));

  // A fast tool switch must not strand the last edit inside the debounce window.
  $effect(() => () => {
    clearTimeout(autoTimer);
    autoTimer = 0;
    if (
      slot.activeView?.mode === 'live' &&
      slot.activeView?.surface === surface &&
      slot.modified
    ) void persistActive();
  });

  // A menu is dismissed by pressing somewhere else, like every other popover here.
  $effect(() => menu ? closeOnOutsidePointer(anchor, () => (menu = false)) : undefined);

  async function open(viewId) {
    const caseId = caseState.current?.id;
    if (!caseId || busy) return;
    if (!(await persistActive())) return;
    busy = true;
    try {
      const view = await api.get(`/api/cases/${caseId}/analysis-views/${viewId}`);
      activateAnalysisView(caseId, view);
      await onopen(view);
      menu = false;
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      busy = false;
    }
  }

  async function save() {
    const caseId = caseState.current?.id;
    if (!caseId || !name.trim() || busy) return;
    busy = true;
    try {
      const spec = await capture(mode);
      const view = await api.post(`/api/cases/${caseId}/analysis-views`, {
        name: name.trim(), mode, surface, spec,
      });
      activateAnalysisView(caseId, view);
      await onopen(view);
      saving = false;
      name = '';
      await read();
      toast(`Saved view “${view.name}”`, 'ok');
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      busy = false;
    }
  }

  function startRename(view) {
    renaming = view.id;
    draft = view.name;
  }

  /** Relabel one reading. Both modes accept it: a snapshot's capture is evidence,
   *  its name is not, so `PATCH` never touches the spec. */
  async function rename(view) {
    const caseId = caseState.current?.id;
    const next = draft.trim();
    if (!caseId || !next || busy) return;
    if (next === view.name) {
      renaming = null;
      return;
    }
    busy = true;
    try {
      const saved = await api.patch(
        `/api/cases/${caseId}/analysis-views/${view.id}`, { name: next }
      );
      updateSummary(saved);
      renameAnalysisView(caseId, view.id, saved.name);
      renaming = null;
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      busy = false;
    }
  }

  function focusInput(node) {
    node.focus();
    node.select();
  }

  async function duplicate(viewId) {
    const caseId = caseState.current?.id;
    if (!caseId) return;
    try {
      const source = views.find((view) => view.id === viewId);
      if (!source) return;
      await api.post(`/api/cases/${caseId}/analysis-views/${viewId}/duplicate`, {
        name: copyName(source.name, views.map((view) => view.name)),
      });
      await read();
    } catch (error) {
      toast(error.message, 'danger');
    }
  }

  async function remove(view) {
    const caseId = caseState.current?.id;
    if (!caseId) return;
    if (renaming === view.id) renaming = null;
    try {
      const result = await api.del(`/api/cases/${caseId}/analysis-views/${view.id}`);
      if (slot.activeView?.id === view.id) {
        leaveAnalysisView(caseId, surface);
        await onleave();
      }
      await read();
      toast(`Deleted “${view.name}”`, 'info', 7000, {
        label: 'Undo',
        onClick: async () => {
          try {
            await restoreGroup(caseId, result.trash);
            await read();
            toast('Restored', 'ok');
          } catch (error) {
            toast(error.message, 'danger');
          }
        },
      });
    } catch (error) {
      toast(error.message, 'danger');
    }
  }

  async function leave() {
    const caseId = caseState.current?.id;
    if (!(await persistActive())) return;
    leaveAnalysisView(caseId, surface, { clear: true });
    await onleave();
  }
</script>

<div class="views">
  {#if slot.activeView}
    <span class="active" title={slot.activeView.mode === 'snapshot'
      ? `Captured ${slot.activeView.spec?.snapshot?.captured_at ?? ''}`
      : 'Recomputed from the current case'}>
      <Icon name={slot.activeView.mode === 'snapshot' ? 'clock' : 'layers'} size={12} />
      {slot.activeView.name}
      <em aria-live="polite">{activeStatus}</em>
      <button aria-label="Leave saved view" title="Leave this view" onclick={leave}>
        <Icon name="x" size={10} />
      </button>
    </span>
  {/if}

  <div class="anchor" bind:this={anchor}>
    <button
      class="btn btn-sm"
      aria-expanded={menu}
      disabled={!caseState.current}
      onclick={openMenu}
    >
      <Icon name="layers" size={13} /> Views{views.length ? ` ${views.length}` : ''}
    </button>
    {#if menu}
      <div class="menu">
        <div class="menu-actions">
          <button
            class="btn btn-sm btn-primary"
            disabled={slot.activeView?.mode === 'snapshot'}
            title={slot.activeView?.mode === 'snapshot'
              ? 'Duplicate the snapshot to keep another copy.'
              : 'Save the current question as a named view.'}
            onclick={() => ((saving = true), (menu = false))}
          >
            <Icon name="save" size={12} /> Save view
          </button>
          {#if views.length > 1}
            <label class="sort">
              Sort
              <select
                class="input"
                value={order}
                onchange={(event) => chooseOrder(event.currentTarget.value)}
              >
                {#each orders as choice (choice.id)}
                  <option value={choice.id}>{choice.label}</option>
                {/each}
              </select>
            </label>
          {/if}
        </div>
        {#if views.length}
          <ul>
            {#each rows as view (view.id)}
              <li class:editing={renaming === view.id}>
                {#if renaming === view.id}
                  <input
                    class="input"
                    use:focusInput
                    bind:value={draft}
                    maxlength="80"
                    aria-label="New name for {view.name}"
                    onkeydown={(event) => {
                      if (event.key === 'Enter') rename(view);
                      if (event.key === 'Escape') renaming = null;
                    }}
                  />
                  <button
                    title="Save name"
                    aria-label="Save name"
                    disabled={!draft.trim() || busy}
                    onclick={() => rename(view)}
                  >
                    <Icon name="check" size={12} />
                  </button>
                  <button title="Cancel" aria-label="Cancel rename" onclick={() => (renaming = null)}>
                    <Icon name="x" size={12} />
                  </button>
                {:else}
                  <button class="open" disabled={busy} onclick={() => open(view.id)}>
                    <strong>{view.name}</strong>
                    <span>
                      {view.mode === 'snapshot' ? `${view.snapshot_count} captured` : 'live'}
                      {#if family === 'catalog'}· {view.surface}{/if}
                      · <time datetime={view.updated_at} title={exactStamp(view.updated_at)}>
                        {timeAgo(view.updated_at, now)}
                      </time>
                    </span>
                  </button>
                  <button title="Rename view" aria-label="Rename {view.name}" onclick={() => startRename(view)}>
                    <Icon name="edit" size={12} />
                  </button>
                  <button title="Duplicate view" aria-label="Duplicate {view.name}" onclick={() => duplicate(view.id)}>
                    <Icon name="copy" size={12} />
                  </button>
                  <button title="Delete view" aria-label="Delete {view.name}" onclick={() => remove(view)}>
                    <Icon name="trash" size={12} />
                  </button>
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty">
            {family === 'timeline' ? 'No saved timeline views yet.' : 'No saved board or graph views yet.'}
          </p>
        {/if}
      </div>
    {/if}
  </div>
</div>

{#if saving}
  <Modal title="Save analysis view" onclose={() => (saving = false)} width="460px">
    <div class="save-form">
      <label>
        Name
        <input class="input" bind:value={name} maxlength="80" />
      </label>
      <label class="choice">
        <input type="radio" bind:group={mode} value="live" />
        <span><strong>Live</strong><small>Recomputes the question from the current case.</small></span>
      </label>
      <label class="choice">
        <input type="radio" bind:group={mode} value="snapshot" />
        <span><strong>Snapshot</strong><small>{snapshotNote}</small></span>
      </label>
      <div class="save-actions">
        <button class="btn" onclick={() => (saving = false)}>Cancel</button>
        <button class="btn btn-primary" disabled={!name.trim() || busy} onclick={save}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  </Modal>
{/if}

<style>
  .views { display: flex; align-items: center; gap: 8px; }
  .anchor { position: relative; }
  .active {
    display: inline-flex; align-items: center; gap: 5px; max-width: 280px;
    padding: 4px 7px; border: 1px solid var(--border); border-radius: var(--r-sm);
    color: var(--text-2); font-size: var(--fs-xs); background: var(--bg-2);
  }
  .active > :global(svg) { flex: 0 0 auto; color: var(--accent); }
  .active em { color: var(--text-3); font-style: normal; }
  .active button { display: flex; color: var(--text-3); }
  .menu {
    position: absolute; z-index: 80; top: calc(100% + 5px); right: 0; width: 360px;
    padding: 8px; border: 1px solid var(--border-strong); border-radius: var(--r-md);
    background: var(--bg-1); box-shadow: var(--shadow-2);
  }
  .menu-actions {
    display: flex; align-items: center; justify-content: space-between; gap: 6px;
    padding-bottom: 7px; border-bottom: 1px solid var(--border);
  }
  .sort { display: flex; align-items: center; gap: 5px; color: var(--text-3); font-size: var(--fs-xs); }
  .sort select { padding: 3px 5px; font-size: var(--fs-xs); }
  /* The list's own reset: without it the browser's 40px marker gutter left an empty
     column down the left of every row. */
  ul { max-height: 310px; margin: 6px 0 0; padding: 0; list-style: none; overflow: auto; }
  li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; align-items: center; gap: 2px; }
  li.editing { grid-template-columns: minmax(0, 1fr) auto auto; padding: 4px 5px; }
  li.editing input { width: 100%; }
  li:hover { background: var(--bg-2); }
  li > button:not(.open) { display: flex; padding: 7px 5px; color: var(--text-3); }
  .open { min-width: 0; padding: 7px; text-align: left; }
  .open strong, .open span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .open strong { color: var(--text-1); font-size: var(--fs-sm); }
  .open span { margin-top: 2px; color: var(--text-3); font-size: var(--fs-xs); }
  .empty { padding: 18px 8px 10px; text-align: center; color: var(--text-3); font-size: var(--fs-sm); }
  .save-form { display: grid; gap: 12px; }
  .save-form > label:first-child { display: grid; gap: 5px; color: var(--text-2); font-size: var(--fs-sm); }
  .choice { display: flex; align-items: flex-start; gap: 9px; padding: 9px; border: 1px solid var(--border); border-radius: var(--r-sm); }
  .choice span, .choice small { display: block; }
  .choice small { margin-top: 3px; color: var(--text-3); }
  .save-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
</style>
