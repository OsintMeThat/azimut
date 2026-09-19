<script>
  import { onMount, tick } from 'svelte';
  import { api } from '../../lib/api.js';
  import Icon from '../../components/Icon.svelte';
  import ConfirmDialog from '../../components/ConfirmDialog.svelte';

  let { caseId } = $props();
  let data = $state(null);
  let active = $state('');
  let busy = $state(false);
  let error = $state('');
  let conflict = $state(false);
  let taskText = $state('');
  let naming = $state(null);
  let listName = $state('');
  let nameInput = $state(null);
  let taskInput = $state(null);
  let deleting = $state(null);
  let menu = $state(false);
  const selected = $derived(data?.lists.find((list) => list.id === active));
  const endpoint = $derived(`/api/cases/${encodeURIComponent(caseId)}/todos`);

  onMount(() => { void load(); });

  async function load() {
    busy = true;
    error = '';
    try {
      data = await api.get(endpoint);
      active = data.lists.some((list) => list.id === active) ? active : (data.lists[0]?.id ?? '');
      conflict = false;
    } catch (e) { error = e.message; }
    finally { busy = false; }
  }

  async function save(lists) {
    if (busy || conflict) return false;
    busy = true;
    error = '';
    try {
      data = await api.put(endpoint, { revision: data.revision, lists });
      return true;
    } catch (e) {
      error = e.message;
      conflict = e.status === 409;
      return false;
    } finally { busy = false; }
  }

  function copy() { return JSON.parse(JSON.stringify(data.lists)); }

  async function nameList(id = '') {
    naming = id;
    listName = data.lists.find((list) => list.id === id)?.name ?? '';
    menu = false;
    await tick();
    nameInput?.focus();
  }

  async function submitName(event) {
    event.preventDefault();
    const name = listName.trim();
    if (!name) return;
    const lists = copy();
    const id = naming || crypto.randomUUID();
    if (naming) lists.find((list) => list.id === id).name = name;
    else lists.push({ id, name, tasks: [] });
    if (await save(lists)) { active = id; naming = null; }
  }

  async function addTask(event) {
    event.preventDefault();
    const text = taskText.trim();
    if (!text || !selected) return;
    const lists = copy();
    lists.find((list) => list.id === active).tasks.push({ id: crypto.randomUUID(), text, done: false });
    if (await save(lists)) {
      taskText = '';
      await tick();
      taskInput?.focus();
    }
  }

  async function updateTask(id, patch, input) {
    const lists = copy();
    const task = lists.find((list) => list.id === active).tasks.find((task) => task.id === id);
    const previous = { ...task };
    Object.assign(task, patch);
    if (!task.text.trim() || !await save(lists)) {
      if (input.type === 'checkbox') input.checked = previous.done;
      else input.value = previous.text;
    }
  }

  async function deleteTask(id) {
    const lists = copy();
    const list = lists.find((list) => list.id === active);
    list.tasks = list.tasks.filter((task) => task.id !== id);
    await save(lists);
  }

  async function deleteList(id) {
    if (await save(copy().filter((list) => list.id !== id))) {
      active = data.lists[0]?.id ?? '';
      deleting = null;
      menu = false;
    }
  }
</script>

<section class="todos" aria-label="To-do">
  <header><h2 class="label">To-do</h2><span aria-live="polite">{busy && data ? 'Saving…' : ''}</span></header>
  {#if error}
    <p role="alert">{error} <button class="btn btn-sm" onclick={load} disabled={busy}>Reload lists</button></p>
  {/if}
  {#if data}
    <fieldset disabled={busy || conflict}>
      <div class="tabs" aria-label="Task lists">
        {#each data.lists as list (list.id)}
          <button class="tab" class:active={active === list.id} aria-pressed={active === list.id}
            onclick={() => { active = list.id; taskText = ''; menu = false; naming = null; }}>
            {list.name} <span>{list.tasks.filter((task) => task.done).length}/{list.tasks.length}</span>
          </button>
        {/each}
        <button class="btn btn-ghost btn-sm" aria-label="Add list" title="Add list" disabled={data.lists.length >= 50} onclick={() => nameList()}><Icon name="plus" size={15} /></button>
        {#if selected}
          <button class="btn btn-ghost btn-sm" aria-label="List options" aria-expanded={menu} onclick={() => (menu = !menu)}>•••</button>
        {/if}
      </div>
      {#if menu && selected}
        <div class="options">
          <button class="btn btn-sm" onclick={() => nameList(active)}>Rename list</button>
          <button class="btn btn-sm" onclick={() => selected.tasks.length ? (deleting = selected) : deleteList(active)}>Delete list</button>
        </div>
      {/if}
      {#if naming !== null}
        <form onsubmit={submitName} class="entry">
          <input class="input" aria-label="List name" placeholder="List name" maxlength="120" bind:value={listName} bind:this={nameInput} onkeydown={(e) => { if (e.key === 'Escape') naming = null; }} />
          <button class="btn btn-sm" disabled={!listName.trim()}>Save</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick={() => (naming = null)}>Cancel</button>
        </form>
      {/if}
      {#if selected}
        <ul aria-label={selected.name}>
          {#each selected.tasks as task (task.id)}
            <li>
              <input type="checkbox" aria-label={`Complete ${task.text}`} checked={task.done} onchange={(e) => updateTask(task.id, { done: e.currentTarget.checked }, e.currentTarget)} />
              <input class="task" class:done={task.done} aria-label="Task text" value={task.text} maxlength="2000" onchange={(e) => updateTask(task.id, { text: e.currentTarget.value.trim() }, e.currentTarget)} onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
              <button class="btn btn-ghost btn-sm" aria-label={`Delete ${task.text}`} title={`Delete ${task.text}`} onclick={() => deleteTask(task.id)}><Icon name="trash" size={14} /></button>
            </li>
          {/each}
        </ul>
        <form class="entry" onsubmit={addTask}>
          <input class="input" aria-label="New task" placeholder="Add a task…" maxlength="2000" bind:value={taskText} bind:this={taskInput} disabled={selected.tasks.length >= 200} />
          <button class="btn btn-sm" aria-label="Add task" title="Add task" disabled={!taskText.trim() || selected.tasks.length >= 200}><Icon name="plus" size={15} /></button>
        </form>
      {:else}
        <p class="quiet">Add a list to start.</p>
      {/if}
    </fieldset>
  {:else if busy}
    <p class="quiet">Loading lists…</p>
  {/if}
</section>

{#if deleting}
  <ConfirmDialog title="Delete list?" message={`Delete “${deleting.name}” and its ${deleting.tasks.length} tasks?`} detail="This cannot be undone." confirmLabel="Delete list" tone="danger" {busy} onconfirm={() => deleteList(deleting.id)} oncancel={() => { if (!busy) deleting = null; }} />
{/if}

<style>
  /* Written in the Home dashboard's vocabulary: a small-caps label over flat rows,
     no panel of its own, tabs drawn like the workspace tab strip. */
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  header .label { margin: 0; }
  header span, .tab span { color: var(--text-3); font-size: var(--fs-xs); }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  .tabs { display: flex; align-items: center; gap: 2px; overflow-x: auto; border-bottom: 1px solid var(--border); }
  .tab { padding: 7px 12px; white-space: nowrap; font-size: var(--fs-sm); font-weight: 500; color: var(--text-3); }
  .tab:hover { color: var(--text-1); }
  .tab.active { color: var(--text-1); box-shadow: inset 0 -2px 0 var(--accent); }
  .tab span { margin-left: 6px; font-weight: 400; font-variant-numeric: tabular-nums; }
  .entry, li, .options { display: flex; align-items: center; gap: 8px; }
  .entry, .options { margin-top: 10px; }
  .entry .input { flex: 1; min-width: 0; }
  ul { list-style: none; margin: 0; padding: 0; max-height: 300px; overflow-y: auto; }
  /* The Recent work row: a hairline between rows, the amber edge under the pointer. */
  li { padding: 2px 4px 2px 8px; border-bottom: 1px solid var(--border); border-left: 2px solid transparent; transition: background 0.14s var(--ease), border-color 0.14s var(--ease); }
  li:hover, li:focus-within { background: var(--bg-1); border-left-color: var(--accent); }
  input[type='checkbox'] { accent-color: var(--accent); flex-shrink: 0; }
  .task { flex: 1; min-width: 0; background: transparent; border: 1px solid transparent; border-radius: var(--r-sm); padding: 6px; color: var(--text-1); font: inherit; font-size: var(--fs-md); }
  .task:focus { border-color: var(--accent); outline: none; }
  .task.done { text-decoration: line-through; color: var(--text-3); }
  li .btn { color: var(--text-3); opacity: 0; }
  li:hover .btn, li:focus-within .btn { opacity: 1; }
  li .btn:hover { color: var(--text-1); }
  @media (hover: none) { li .btn { opacity: 1; } }
  .quiet { padding: 12px 8px; font-size: var(--fs-sm); color: var(--text-3); }
  p[role='alert'] { margin-bottom: 10px; color: var(--danger); font-size: var(--fs-sm); }
</style>
