<script>
  import Icon from '../../components/Icon.svelte';

  // The tab bar on top of Geo Proof's side column (`sideTabs.js`). The arrows, Home
  // and End move along it, each tab shown as it is reached, and they stay here: the
  // composer behind reads the same arrows as a nudge of the picked mark.
  let {
    tabs,
    current,
    // What the Proof tab still needs, said on its label so a blank field is not
    // forgotten while working in another tab.
    needs = '',
    onpick,
  } = $props();

  function key(event) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    const at = tabs.findIndex((one) => one.id === current);
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (at + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    event.stopPropagation();
    onpick(tabs[to].id);
    event.currentTarget.querySelectorAll('[role="tab"]')[to]?.focus();
  }
</script>

<div class="side-tabs" role="tablist" aria-label="Proof settings" tabindex="-1" onkeydown={key} data-guide="proof.tabs">
  {#each tabs as one (one.id)}
    {@const on = one.id === current}
    {@const warn = one.id === 'proof' && !!needs}
    <button
      type="button"
      class="side-tab"
      class:on
      role="tab"
      id={`proof-tab-${one.id}`}
      aria-selected={on}
      aria-controls={`proof-pane-${one.id}`}
      tabindex={on ? 0 : -1}
      title={warn ? needs : one.title}
      onclick={() => onpick(one.id)}
    >
      {one.label}
      {#if warn}
        <span class="need" role="img" aria-label={needs} data-testid="proof-tab-needs">
          <Icon name="alert" size={11} />
        </span>
      {/if}
    </button>
  {/each}
</div>

<style>
  /* Inspect's panel tabs, so the two side columns read alike. */
  .side-tabs {
    flex-shrink: 0;
    display: flex;
    gap: 2px;
    padding: 0 8px;
    border-bottom: 1px solid var(--border);
  }
  .side-tabs:focus {
    outline: none;
  }
  .side-tab {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-bottom: -1px;
    padding: 9px 9px 8px;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--text-3);
    font-size: var(--fs-sm);
    font-weight: 600;
    white-space: nowrap;
  }
  .side-tab:hover {
    color: var(--text-1);
  }
  .side-tab.on {
    color: var(--text-1);
    border-bottom-color: var(--accent);
  }
  .side-tab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    border-radius: var(--r-sm);
  }
  .need {
    display: inline-flex;
    color: var(--warn, #e8a33d);
  }
</style>
