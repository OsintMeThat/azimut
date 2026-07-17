<script>
  import { uiState, initSession, caseState, reloadCase, toast } from './lib/state.svelte.js';
  import { startEvents, onEvent } from './lib/events.js';
  import { WORKSPACES, workspaceOf, toolFromHash } from './lib/workspaces.js';
  import Icon from './components/Icon.svelte';
  import Logo from './components/Logo.svelte';
  import Wordmark from './components/Wordmark.svelte';
  import CaseSwitcher from './components/CaseSwitcher.svelte';
  import CaseSidebar from './components/CaseSidebar.svelte';
  import Toasts from './components/Toasts.svelte';
  import MediaLibrary from './tools/MediaLibrary.svelte';
  import Satellite from './tools/Satellite.svelte';
  import ProofComposer from './tools/ProofComposer.svelte';
  import PostComposer from './tools/PostComposer.svelte';
  import Inspector from './tools/Inspector.svelte';
  import Settings from './tools/Settings.svelte';

  // The rail holds workspaces (docs/UI.md §3); tools are tabs inside them.
  // Settings lives behind the topbar gear instead — app plumbing, not part
  // of the working flow.
  const TOOLS = [
    { id: 'media', label: 'Media', component: MediaLibrary },
    { id: 'inspect', label: 'Inspect', component: Inspector },
    { id: 'satellite', label: 'Satellite', component: Satellite },
    { id: 'proof', label: 'Proof', component: ProofComposer },
    { id: 'post', label: 'Post', component: PostComposer },
  ];
  const ALL_TOOLS = [
    ...TOOLS,
    { id: 'settings', label: 'Settings', component: Settings },
  ];
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
  $effect(() => {
    const ws = workspaceOf(uiState.tool);
    if (ws) lastTool[ws.id] = uiState.tool;
  });
  function openWorkspace(ws) {
    uiState.tool = lastTool[ws.id] ?? ws.tools[0];
  }

  // Tools mount lazily on first visit, then stay mounted (hidden via CSS) so
  // unsaved editor state — a half-composed proof, a collage in progress —
  // survives switching tabs to grab another capture or media.
  const visited = $state({ [uiState.tool]: true });
  $effect(() => {
    visited[uiState.tool] = true;
  });

  // Load the case list and reopen the last-used case (survives reloads).
  initSession().catch(() => {});

  // Live nudges from our own backend (SSE, same-origin — still local-first):
  // the capture extension files screenshots while this tab just sits here, and
  // they must show up without a reload. Refresh only what the nudge names.
  startEvents();
  onEvent('capture', (ev) => {
    toast(`Capture filed from ${ev.site}: ${ev.title}`, 'ok', 5000);
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
      onclick={() => (uiState.sidebarOpen = !uiState.sidebarOpen)}
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
            <div class="tool-host" class:hidden={uiState.tool !== tool.id}>
              <tool.component />
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
</style>
