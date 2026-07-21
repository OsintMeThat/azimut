<script>
  import {
    uiState,
    initSession,
    caseState,
    reloadCase,
    toast,
    updateState,
    checkForUpdateOnStart,
    toggleTheme,
  } from './lib/state.svelte.js';
  import { startEvents, onEvent } from './lib/events.js';
  import {
    WORKSPACES,
    TOOL_LABELS,
    sidebarOpenForWorkspace,
    workspaceOf,
    toolFromHash,
  } from './lib/workspaces.js';
  import { createToolLoader } from './lib/toolLoader.js';
  import Icon from './components/Icon.svelte';
  import Logo from './components/Logo.svelte';
  import Wordmark from './components/Wordmark.svelte';
  import CaseSwitcher from './components/CaseSwitcher.svelte';
  import CaseSidebar from './components/CaseSidebar.svelte';
  import Toasts from './components/Toasts.svelte';
  import UpdateModal from './components/UpdateModal.svelte';

  // The rail holds workspaces (docs/UI.md §3); tools are tabs inside them.
  // Settings lives behind the topbar gear instead — app plumbing, not part
  // of the working flow.
  const TOOLS = [
    { id: 'media', label: TOOL_LABELS.media, load: () => import('./tools/MediaLibrary.svelte') },
    { id: 'files', label: TOOL_LABELS.files, load: () => import('./tools/Files.svelte') },
    { id: 'reverse', label: TOOL_LABELS.reverse, load: () => import('./tools/ReverseSearch.svelte') },
    { id: 'inspect', label: TOOL_LABELS.inspect, load: () => import('./tools/Inspector.svelte') },
    { id: 'satellite', label: TOOL_LABELS.satellite, load: () => import('./tools/Satellite.svelte') },
    { id: 'coordinates', label: TOOL_LABELS.coordinates, load: () => import('./tools/Coordinates.svelte') },
    { id: 'proof', label: TOOL_LABELS.proof, load: () => import('./tools/ProofComposer.svelte') },
    { id: 'post', label: TOOL_LABELS.post, load: () => import('./tools/PostComposer.svelte') },
    { id: 'notebook', label: TOOL_LABELS.notebook, load: () => import('./tools/Notebook.svelte') },
  ];
  const ALL_TOOLS = [
    ...TOOLS,
    { id: 'settings', label: TOOL_LABELS.settings, load: () => import('./tools/Settings.svelte') },
  ];
  const loader = createToolLoader(Object.fromEntries(ALL_TOOLS.map((tool) => [tool.id, tool.load])));
  let toolComponents = $state.raw({});
  let toolErrors = $state.raw({});
  const TOOL_IDS = ALL_TOOLS.map((t) => t.id);
  const toolLabel = (id) => ALL_TOOLS.find((t) => t.id === id)?.label ?? id;

  // deep links: tool ids (#media, #proof, …) plus workspace aliases
  // (#compose, #compose/post) — see lib/workspaces.js
  const fromHash = toolFromHash(location.hash, TOOL_IDS);
  if (fromHash) uiState.tool = fromHash;
  $effect(() => {
    history.replaceState(null, '', `#${uiState.tool}`);
  });

  // Workspace navigation: clicking a workspace returns to its last-used tab.
  const activeWs = $derived(workspaceOf(uiState.tool));
  const lastTool = $state({});
  const sidebarOpenByWorkspace = $state({});
  let previousTool = null;
  $effect(() => {
    const ws = workspaceOf(uiState.tool);
    if (ws) lastTool[ws.id] = uiState.tool;
  });
  $effect(() => {
    const nextTool = uiState.tool;
    const previousWs = workspaceOf(previousTool);
    const nextWs = workspaceOf(nextTool);
    if (nextWs && previousWs?.id !== nextWs.id) {
      uiState.sidebarOpen = sidebarOpenForWorkspace(nextWs.id, sidebarOpenByWorkspace);
    }
    previousTool = nextTool;
  });
  function openWorkspace(ws) {
    uiState.tool = lastTool[ws.id] ?? ws.tools[0];
  }
  function toggleSidebar() {
    const open = !uiState.sidebarOpen;
    const ws = workspaceOf(uiState.tool);
    if (ws) sidebarOpenByWorkspace[ws.id] = open;
    uiState.sidebarOpen = open;
  }

  // Tools mount lazily on first visit, then stay mounted (hidden via CSS) so
  // unsaved editor state — a half-composed proof, a collage in progress —
  // survives switching tabs to grab another capture or media.
  const visited = $state({ [uiState.tool]: true });
  async function ensureTool(id) {
    try {
      const component = await loader.load(id);
      toolComponents = { ...toolComponents, [id]: component };
      if (toolErrors[id]) toolErrors = { ...toolErrors, [id]: null };
    } catch (error) {
      toolErrors = { ...toolErrors, [id]: error?.message ?? 'Could not load this tool' };
    }
  }
  $effect(() => {
    const id = uiState.tool;
    visited[id] = true;
    void ensureTool(id);
  });

  // Load the case list and reopen the last-used case (survives reloads), then
  // — once preferences have landed — see whether a newer release is out and
  // pop a notice. The check reads prefs.updateCheckOnStart, so it must follow
  // initSession, which loads them.
  initSession()
    .catch(() => {})
    .finally(() => checkForUpdateOnStart());

  // Live nudges from our own backend (SSE, same-origin — still local-first):
  // the capture extension files screenshots while this tab just sits here, and
  // they must show up without a reload. Refresh only what the nudge names.
  startEvents();
  onEvent('capture', (ev) => {
    toast(`Capture filed from ${ev.site}: ${ev.title}`, 'ok', 5000);
    if (caseState.current?.id === ev.case_id) reloadCase();
  });
  onEvent('bookmark', (ev) => {
    toast(`Bookmark saved: ${ev.title}`, 'ok', 5000);
    if (caseState.current?.id === ev.case_id) reloadCase();
  });
</script>

<div class="shell">
  <header class="topbar">
    <div class="brand">
      <Logo size={28} />
      <span class="brand-name"><Wordmark height={12} /></span>
    </div>
    <CaseSwitcher />
    <div class="spacer"></div>
    <button
      class="btn btn-ghost btn-sm"
      class:gear-active={uiState.tool === 'settings'}
      title="Settings"
      onclick={() => (uiState.tool = 'settings')}
    >
      <Icon name="settings" size={16} />
    </button>
    <button
      class="btn btn-ghost btn-sm"
      title="Toggle case sidebar"
      onclick={toggleSidebar}
    >
      <Icon name="panelRight" size={16} />
    </button>
  </header>

  <div class="main">
    <nav class="rail">
      {#each WORKSPACES as ws (ws.id)}
        <button
          class="rail-btn"
          class:active={activeWs?.id === ws.id}
          onclick={() => openWorkspace(ws)}
          title={ws.label}
        >
          <Icon name={ws.icon} size={19} />
          <span>{ws.label}</span>
        </button>
      {/each}
      <button
        class="rail-btn theme-toggle"
        onclick={toggleTheme}
        title={uiState.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
      >
        <Icon name={uiState.theme === 'light' ? 'moon' : 'sun'} size={19} />
        <span>{uiState.theme === 'light' ? 'Dark' : 'Light'}</span>
      </button>
    </nav>

    <main class="canvas">
      {#if activeWs && activeWs.tools.length > 1}
        <div class="tabstrip">
          {#each activeWs.tools as toolId (toolId)}
            <button
              class="tab-btn"
              class:active={uiState.tool === toolId}
              onclick={() => (uiState.tool = toolId)}
            >
              {toolLabel(toolId)}
            </button>
          {/each}
        </div>
      {/if}
      <div class="canvas-body">
        {#each ALL_TOOLS as tool (tool.id)}
          {#if visited[tool.id]}
            {@const ToolComponent = toolComponents[tool.id]}
            <div class="tool-host" class:hidden={uiState.tool !== tool.id}>
              {#if ToolComponent}
                <ToolComponent />
              {:else if toolErrors[tool.id]}
                <div class="tool-loading">
                  <p>{toolErrors[tool.id]}</p>
                  <button class="btn btn-sm" onclick={() => ensureTool(tool.id)}>Retry</button>
                </div>
              {:else}
                <div class="tool-loading">Loading {tool.label}…</div>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    </main>

    {#if uiState.sidebarOpen}
      <CaseSidebar />
    {/if}
  </div>
</div>

<Toasts />

{#if updateState.show}
  <UpdateModal />
{/if}

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .topbar {
    height: var(--topbar-h);
    flex-shrink: 0;
    /* own stacking context above the tool canvas: Leaflet's panes (z-index up
       to 1000) otherwise swallow the case switcher's dropdown */
    position: relative;
    z-index: 1200;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-1);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-right: 6px;
  }
  .brand-name {
    display: flex;
    align-items: center;
  }
  .spacer {
    flex: 1;
  }
  .gear-active {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .main {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .rail {
    width: var(--rail-w);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding: 4px 0;
    border-right: 1px solid var(--border);
    background: var(--bg-1);
  }
  /* flat, full-bleed segments — active state is the edge bar, not a card */
  .rail-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 10px 0 8px;
    border-left: 2px solid transparent;
    border-right: 2px solid transparent;
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 500;
  }
  .rail-btn:hover {
    color: var(--text-1);
  }
  .rail-btn.active {
    color: var(--text-1);
    border-left-color: var(--accent);
  }
  /* pinned to the foot of the rail, away from the workspace switches */
  .theme-toggle {
    margin-top: auto;
  }
  .canvas {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-0);
  }
  .tabstrip {
    flex-shrink: 0;
    display: flex;
    align-items: stretch;
    gap: 2px;
    padding: 0 10px;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
  }
  .tab-btn {
    padding: 7px 12px;
    font-size: var(--fs-sm);
    font-weight: 500;
    color: var(--text-3);
  }
  .tab-btn:hover {
    color: var(--text-1);
  }
  .tab-btn.active {
    color: var(--text-1);
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .canvas-body {
    flex: 1;
    min-height: 0;
  }
  .tool-host {
    width: 100%;
    height: 100%;
  }
  .tool-host.hidden {
    display: none;
  }
  .tool-loading {
    width: 100%;
    height: 100%;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 10px;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
</style>
