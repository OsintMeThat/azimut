<script>
  import Icon from '../../components/Icon.svelte';
  import choices from '../../lib/map/layerSymbols.json';

  let { value = $bindable('pin'), colour = '#0072b2', label, onchange = null } = $props();
  let open = $state(false);
  let query = $state('');
  let root = $state(null);
  let above = $state(false);
  let menuHeight = $state(224);
  const selected = $derived(choices.find((choice) => choice.id === value) ?? choices[0]);
  const visible = $derived(choices.filter((choice) => {
    const text = `${choice.label} ${(choice.keywords ?? []).join(' ')}`.toLowerCase();
    return query.toLowerCase().trim().split(/\s+/).every((word) => text.includes(word));
  }));
  function toggle() {
    if (!open && root) {
      const box = root.getBoundingClientRect();
      const below = window.innerHeight - box.bottom - 12;
      const up = box.top - 12;
      above = below < 280 && up > below;
      menuHeight = Math.max(80, Math.min(224, (above ? up : below) - 52));
    }
    open = !open;
  }
  $effect(() => {
    if (!open) return;
    const outside = (event) => { if (root && !root.contains(event.target)) open = false; };
    window.addEventListener('click', outside, true);
    return () => window.removeEventListener('click', outside, true);
  });
  function escape(event) {
    if (open && event.key === 'Escape') { close(); event.stopPropagation(); }
  }
  function close() { open = false; root?.querySelector('.current')?.focus(); }
</script>

<div class="picker" bind:this={root} style={`--menu-height:${menuHeight}px`}>
  <button type="button" class="current" title={`${selected.label}: choose an icon`}
    aria-label={`${label} icons`} aria-expanded={open} onclick={toggle} onkeydown={escape}>
    <span class="preview" class:round={selected.id.startsWith('badge-')} style={`--colour:${colour}`}>
      <Icon name={selected.icon} size={14} />
    </span>
    <Icon name="chevronDown" size={10} />
  </button>
  {#if open}
    <div class="icon-menu" class:above role="group" aria-label={`${label} icon palette`}>
      <input type="search" aria-label={`${label} find icon`} bind:value={query} placeholder="Find an icon" onkeydown={escape} />
      <div class="icons">
        {#each visible as choice (choice.id)}
          <button type="button" class:chosen={choice.id === value} title={choice.label}
            aria-label={`${label} ${choice.label} icon`} aria-pressed={choice.id === value}
            onkeydown={escape}
            onclick={() => { value = choice.id; onchange?.({ symbol: value }); close(); }}>
            <span class:round={choice.id.startsWith('badge-')} style={`--colour:${colour}`}>
              <Icon name={choice.icon} size={14} />
            </span>
          </button>
        {/each}
      </div>
      {#if !visible.length}<p>No icons match.</p>{/if}
    </div>
  {/if}
</div>

<style>
  .picker { position: relative; }
  .current { display: flex; align-items: center; gap: 5px; padding: 2px 5px; border: 1px solid var(--border); border-radius: var(--radius-1); background: var(--bg-1); color: var(--text-2); cursor: pointer; }
  .current:hover, .current[aria-expanded='true'] { border-color: var(--accent); background: var(--bg-3); }
  .preview { display: grid; place-items: center; width: 23px; height: 23px; color: var(--colour); }
  .round { display: grid; place-items: center; width: 23px; height: 23px; border-radius: 50%; background: var(--colour); color: #fff; }
  .icon-menu { position: absolute; top: 31px; left: 0; width: 224px; padding: 7px; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-1); z-index: 10; box-shadow: 0 4px 18px #0005; }
  .icon-menu.above { top: auto; bottom: 31px; }
  input { width: 100%; font-size: var(--fs-xs); height: 26px; padding: 4px 6px; }
  .icons { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; margin-top: 6px; padding: 1px; max-height: var(--menu-height); overflow-y: auto; }
  .icons button { display: grid; place-items: center; height: 29px; color: var(--colour, var(--text-2)); border-radius: var(--radius-1); cursor: pointer; }
  .icons button:hover, .icons button.chosen { background: var(--bg-3); outline: 1px solid var(--accent); }
  .icons button > span:not(.round) { color: var(--colour); }
  p { font-size: var(--fs-xs); color: var(--text-3); margin: 7px 0 0; }
</style>
