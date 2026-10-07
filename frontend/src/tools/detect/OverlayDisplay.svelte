<script>
  import { tick } from 'svelte';
  import Icon from '../../components/Icon.svelte';

  /**
   * What the map draws over the imagery: the switch and what it switches.
   *
   * The eye and the menu are one control rather than two buttons side by side.
   * Apart, nothing says the eye is the master of the list, and an eye beside a
   * chevron reads as two unrelated things to press.
   */
  let {
    markers = $bindable(true),
    outlines = $bindable(true),
    checkPins = $bindable(null),
    /** All of it off the map at once. */
    hidden = $bindable(false),
    /** What the eye takes off, for its label: "Hide the candidates". */
    what = 'the overlays',
    /** The key that does the same, named in the tooltip. */
    shortcut = '',
    upward = false,
  } = $props();
  let open = $state(false);
  /** Something is off, so the chevron reads as changed even while the menu is shut. */
  const some = $derived(!markers || !outlines || checkPins === false);
  let root = $state(null);
  let trigger = $state(null);

  async function toggle() {
    open = !open;
    if (open) {
      await tick();
      root?.querySelector('[role="menuitemcheckbox"]')?.focus();
    }
  }
  function onOutside(event) {
    if (open && !root?.contains(event.target)) open = false;
  }
  function onKey(event) {
    if (!open) return;
    if (event.key === 'Escape') {
      open = false;
      trigger?.focus();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const items = [...root.querySelectorAll('[role="menuitemcheckbox"]')];
      const at = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === 'Tab') {
      open = false;
      trigger?.focus();
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }
</script>

<svelte:document onpointerdown={onOutside} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay-display" class:upward bind:this={root} onkeydown={onKey}>
  <span class="joined">
    <button type="button" class="cmp-icon eye" class:on={hidden} aria-pressed={hidden}
      aria-label={`Hide ${what}`} title={`${hidden ? 'Show' : 'Hide'} ${what}${shortcut ? ` (${shortcut})` : ''}`}
      onclick={() => (hidden = !hidden)}><Icon name={hidden ? 'eyeOff' : 'eye'} size={14} /></button>
    <button type="button" class="cmp-icon pick" class:on={open || some}
      bind:this={trigger} aria-label="Which overlays" title="Which overlays" aria-haspopup="menu" aria-expanded={open}
      onclick={toggle}><Icon name="chevronDown" size={13} /></button>
  </span>
  {#if open}
    <div class="display-menu cmp-glass" role="menu" aria-label="Overlay display">
      <button type="button" role="menuitemcheckbox" aria-checked={markers} disabled={hidden}
        onclick={() => (markers = !markers)}>
        <Icon name={markers ? 'check' : 'minus'} size={13} /><span>Markers</span></button>
      <button type="button" role="menuitemcheckbox" aria-checked={outlines} disabled={hidden}
        onclick={() => (outlines = !outlines)}>
        <Icon name={outlines ? 'check' : 'minus'} size={13} /><span>Outlines</span></button>
      {#if checkPins !== null}
        <button type="button" role="menuitemcheckbox" aria-checked={checkPins} disabled={hidden}
          onclick={() => (checkPins = !checkPins)}>
          <Icon name={checkPins ? 'check' : 'minus'} size={13} /><span>Check pins</span></button>
      {/if}
      {#if hidden}
        <p class="all-off">The eye has them all off</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .overlay-display { position: relative; display: inline-flex; flex: 0 0 auto; }
  /* One control, not two: the eye is the switch and the chevron says what it
     switches, so they share a border and sit against each other. */
  .joined { display: inline-flex; border: 1px solid var(--glass-line); border-radius: var(--r-sm); }
  .joined .cmp-icon { border: 0; border-radius: 0; }
  .joined .eye { border-right: 1px solid var(--glass-line); border-radius: var(--r-sm) 0 0 var(--r-sm); }
  .joined .pick { border-radius: 0 var(--r-sm) var(--r-sm) 0; padding-inline: 2px; }
  .display-menu button:disabled { opacity: 0.45; cursor: default; }
  .display-menu button:disabled:hover { color: var(--glass-muted); background: none; }
  .all-off { margin: 2px 0 0; padding: 6px 9px 4px; border-top: 1px solid var(--glass-line);
    color: var(--glass-muted); font-size: var(--fs-xs); }
  .display-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 10; min-width: 150px; padding: 4px; }
  .upward .display-menu { top: auto; bottom: calc(100% + 4px); }
  .display-menu button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 9px; border-radius: var(--r-sm); color: var(--glass-muted); text-align: left; font-size: var(--fs-sm); }
  .display-menu button:hover, .display-menu button:focus-visible { color: var(--glass-ink); background: var(--glass-hover); }
  .display-menu button[aria-checked='true'] { color: var(--glass-ink); }
</style>
