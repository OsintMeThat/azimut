<script>
  /** Named, case-owned Search+ and graph readings. */
  import { api } from '../lib/api.js';
  import {
    activateAnalysisView,
    adoptSavedAnalysisView,
    analysisSearch,
    leaveAnalysisView,
  } from '../lib/analysisSearch.svelte.js';
  import { copyName } from '../lib/analysisViews.js';
  import { restoreGroup } from '../lib/trash.js';
  import { caseState, toast } from '../lib/state.svelte.js';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';

  let {
    surface = 'board',
    capture = () => ({}),
    onopen = () => {},
    onleave = () => {},
  } = $props();

  let views = $state([]);
  let menu = $state(false);
  let saving = $state(false);
  let name = $state('');
  let mode = $state('live');
  let busy = $state(false);
  let loadedFor = null;
  let readRun = 0;
  let autoTimer = 0;
  let activeSave = null;
  const AUTO_SAVE_AFTER = 650;

  const activeStatus = $derived.by(() => {
    if (analysisSearch.activeView?.mode !== 'live') return 'snapshot';
    if (analysisSearch.saveState === 'error') return 'live · save failed';
    if (analysisSearch.modified || analysisSearch.saveState === 'saving') {
      return 'live · saving…';
    }
    return 'live · saved';
  });

  async function read() {
    const caseId = caseState.current?.id;
    const run = ++readRun;
    if (!caseId) {
      views = [];
      return;
    }
    try {
      const body = await api.get(`/api/cases/${caseId}/analysis-views`);
      if (run === readRun && caseState.current?.id === caseId) views = body.views ?? [];
    } catch {
      if (run === readRun) views = [];
    }
  }

  $effect(() => {
    const caseId = caseState.current?.id ?? null;
    if (caseId === loadedFor) return;
    loadedFor = caseId;
    menu = false;
    saving = false;
    void read();
  });

  function updateSummary(view) {
    views = views.map((row) => row.id === view.id
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
    const current = analysisSearch.activeView;
    if (
      !caseId || !current || current.mode !== 'live' || current.surface !== surface ||
      !analysisSearch.modified
    ) return true;

    const viewId = current.id;
    const version = analysisSearch.changeVersion;
    analysisSearch.saveState = 'saving';
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
        if (analysisSearch.changeVersion === version) {
          analysisSearch.modified = false;
          analysisSearch.saveState = 'saved';
        }
        return true;
      } catch (error) {
        if (
          caseState.current?.id === caseId &&
          analysisSearch.activeView?.id === viewId
        ) analysisSearch.saveState = 'error';
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
    const current = analysisSearch.activeView;
    // Read every edit revision even while `modified` was already true, so typing,
    // repeated drags and consecutive folds restart one quiet-period timer.
    void analysisSearch.changeVersion;
    clearTimeout(autoTimer);
    autoTimer = 0;
    if (!caseId || !current || current.mode !== 'live' || current.surface !== surface) return;
    if (!analysisSearch.modified) {
      if (!activeSave && analysisSearch.saveState !== 'saved') {
        analysisSearch.saveState = 'saved';
      }
      return;
    }
    analysisSearch.saveState = 'saving';
    autoTimer = setTimeout(() => {
      autoTimer = 0;
      void persistActive();
    }, AUTO_SAVE_AFTER);
    return () => {
      clearTimeout(autoTimer);
      autoTimer = 0;
    };
  });

  // A fast tool switch must not strand the last edit inside the debounce window.
  $effect(() => () => {
    clearTimeout(autoTimer);
    autoTimer = 0;
    if (
      analysisSearch.activeView?.mode === 'live' &&
      analysisSearch.activeView?.surface === surface &&
      analysisSearch.modified
    ) void persistActive();
  });

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
    try {
      const result = await api.del(`/api/cases/${caseId}/analysis-views/${view.id}`);
      if (analysisSearch.activeView?.id === view.id) {
        leaveAnalysisView(caseId);
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
    leaveAnalysisView(caseId, { clear: true });
    await onleave();
  }
</script>

<div class="views">
  {#if analysisSearch.activeView}
    <span class="active" title={analysisSearch.activeView.mode === 'snapshot'
      ? `Captured ${analysisSearch.activeView.spec?.snapshot?.captured_at ?? ''}`
      : 'Recomputed from the current case'}>
      <Icon name={analysisSearch.activeView.mode === 'snapshot' ? 'clock' : 'layers'} size={12} />
      {analysisSearch.activeView.name}
      <em aria-live="polite">{activeStatus}</em>
      <button aria-label="Leave saved view" title="Leave this view" onclick={leave}>
        <Icon name="x" size={10} />
      </button>
    </span>
  {/if}

  <div class="anchor">
    <button
      class="btn btn-sm"
      aria-expanded={menu}
      disabled={!caseState.current}
      onclick={() => (menu = !menu)}
    >
      <Icon name="layers" size={13} /> Views{views.length ? ` ${views.length}` : ''}
    </button>
    {#if menu}
      <div class="menu">
        <div class="menu-actions">
          <button
            class="btn btn-sm btn-primary"
            disabled={analysisSearch.activeView?.mode === 'snapshot'}
            title={analysisSearch.activeView?.mode === 'snapshot'
              ? 'Duplicate the snapshot to keep another copy.'
              : 'Save the current question as a named view.'}
            onclick={() => ((saving = true), (menu = false))}
          >
            <Icon name="save" size={12} /> Save view
          </button>
        </div>
        {#if views.length}
          <ul>
            {#each views as view (view.id)}
              <li>
                <button class="open" disabled={busy} onclick={() => open(view.id)}>
                  <strong>{view.name}</strong>
                  <span>{view.mode === 'snapshot' ? `${view.snapshot_count} captured` : 'live'} · {view.surface}</span>
                </button>
                <button title="Duplicate view" aria-label="Duplicate {view.name}" onclick={() => duplicate(view.id)}>
                  <Icon name="copy" size={12} />
                </button>
                <button title="Delete view" aria-label="Delete {view.name}" onclick={() => remove(view)}>
                  <Icon name="trash" size={12} />
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty">No saved views yet.</p>
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
        <span><strong>Snapshot</strong><small>Freezes up to 2,000 entities and their relations.</small></span>
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
  .menu-actions { display: flex; gap: 6px; padding-bottom: 7px; border-bottom: 1px solid var(--border); }
  ul { max-height: 310px; margin-top: 6px; overflow: auto; }
  li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 2px; }
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
