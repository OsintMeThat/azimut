<script>
  import { uiState, initSession } from './lib/state.svelte.js';
  import Icon from './components/Icon.svelte';
  import Logo from './components/Logo.svelte';
  import CaseSwitcher from './components/CaseSwitcher.svelte';
  import CaseSidebar from './components/CaseSidebar.svelte';
  import Toasts from './components/Toasts.svelte';
  import MediaLibrary from './tools/MediaLibrary.svelte';
  import Satellite from './tools/Satellite.svelte';
  import ProofComposer from './tools/ProofComposer.svelte';
  import PostComposer from './tools/PostComposer.svelte';
  import Inspector from './tools/Inspector.svelte';

  const TOOLS = [
    { id: 'media', label: 'Media', icon: 'media', component: MediaLibrary },
    { id: 'inspect', label: 'Inspect', icon: 'inspect', component: Inspector },
    { id: 'satellite', label: 'Satellite', icon: 'satellite', component: Satellite },
    { id: 'proof', label: 'Proof', icon: 'proof', component: ProofComposer },
    { id: 'post', label: 'Post', icon: 'post', component: PostComposer },
  ];

  const ActiveTool = $derived(TOOLS.find((t) => t.id === uiState.tool)?.component ?? MediaLibrary);

  // deep-linkable tools: #media #satellite #proof #post
  const fromHash = location.hash.slice(1);
  if (TOOLS.some((t) => t.id === fromHash)) uiState.tool = fromHash;
  $effect(() => {
    history.replaceState(null, '', `#${uiState.tool}`);
  });

  // Load the case list and reopen the last-used case (survives reloads).
  initSession().catch(() => {});
</script>

<div class="shell">
  <header class="topbar">
    <div class="brand">
      <Logo size={26} />
      <span class="brand-name">Ozimut</span>
    </div>
    <CaseSwitcher />
    <div class="spacer"></div>
    <span class="local-badge" title="Everything stays on your machine — no accounts, no telemetry, no servers">
      Your investigation. Your machine.
    </span>
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
      {#each TOOLS as tool (tool.id)}
        <button
          class="rail-btn"
          class:active={uiState.tool === tool.id}
          onclick={() => (uiState.tool = tool.id)}
          title={tool.label}
        >
          <Icon name={tool.icon} size={21} />
          <span>{tool.label}</span>
        </button>
      {/each}
    </nav>

    <main class="canvas">
      <ActiveTool />
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
    font-family: 'Oxanium', var(--font-sans);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    /* trailing tracking pushes the word off-center; nudge it back */
    margin-right: -0.22em;
    font-size: var(--fs-md);
    color: var(--text-1);
  }
  .spacer {
    flex: 1;
  }
  .local-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-3);
    user-select: none;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
    box-shadow: 0 0 6px var(--ok);
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
    gap: 4px;
    padding: 10px 8px;
    border-right: 1px solid var(--border);
    background: var(--bg-1);
  }
  .rail-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 4px 8px;
    border-radius: var(--r-md);
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
    transition: background 0.15s var(--ease), color 0.15s var(--ease);
  }
  .rail-btn:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .rail-btn.active {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .canvas {
    flex: 1;
    min-width: 0;
    background: var(--bg-0);
  }
</style>
