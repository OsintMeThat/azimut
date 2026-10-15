<script>
  /**
   * The steps of the plate's day, over its date bar: the day itself first, then
   * each step in the order it is played. A press shows one; what is added then
   * belongs to it. **+** adds a step after the one shown. A step is dragged to
   * another place, and its ⋯ names it, sets how long it holds, or removes it with
   * what stands on it.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { clipRange, clipsOf, stepSeconds, timecode } from '../../lib/plate/clip.js';

  let {
    /** The day's steps, in order. */
    steps = [],
    /** The step shown, or null for the day itself. */
    current = null,
    /** The day as the first tile names it. */
    dayLabel = 'The day',
    elements = [],
    caseId = '',
    onpick,
    onadd,
    onremove,
    /** `(id, index)`: the step moved to that place. */
    onmove,
    /** `(id, patch)`: the step renamed or held longer. */
    onchange,
  } = $props();

  let menu = $state(null);
  let dragged = $state('');
  let target = $state(-1);

  const name = (step, index) => step.name || `Step ${index + 1}`;
  const firstClip = (step) => clipsOf(elements, step)[0] ?? null;
  const owned = (step) => elements.filter((element) => element.step === step.id).length;

  function dragOver(event, index) {
    if (!dragged) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    target = event.clientX < rect.left + rect.width / 2 ? index : index + 1;
  }
  function drop(event) {
    if (!dragged) return;
    event.preventDefault();
    if (target >= 0) onmove?.(dragged, target);
    dragged = ''; target = -1;
  }
</script>

<div class="steps" role="listbox" aria-label="Steps of the day" tabindex="-1" ondragover={(event) => event.preventDefault()} ondrop={drop}>
  <button type="button" class="tile day" class:on={!current} role="option" aria-selected={!current} title="The day itself, under its steps"
    onclick={() => onpick?.(null)}>
    <span class="thumb"><Icon name="plate" size={14} /></span>
    <span class="tile-name">{dayLabel}</span>
  </button>
  {#each steps as step, index (step.id)}
    {@const clip = firstClip(step)}
    <div class="slot" class:drop-before={target === index} class:drop-after={target === steps.length && index === steps.length - 1}
      role="presentation" ondragover={(event) => dragOver(event, index)}>
      <button type="button" class="tile" class:on={current === step.id} role="option" aria-selected={current === step.id}
        draggable="true" title="Drag to play it elsewhere"
        ondragstart={(event) => { dragged = step.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', step.id); }}
        ondragend={() => { dragged = ''; target = -1; }}
        onclick={() => onpick?.(step.id)}>
        <span class="thumb">
          {#if clip}
            <video src={`${fileUrl(caseId, clip.src)}#t=${clipRange(clip)[0]}`} preload="metadata" muted playsinline aria-hidden="true"></video>
            <span class="play"><Icon name="play" size={9} /></span>
          {:else}<span class="number">{index + 1}</span>{/if}
        </span>
        <span class="tile-name">{name(step, index)}</span>
        <span class="time">{timecode(stepSeconds(step, elements))}</span>
      </button>
      <button type="button" class="more" aria-label={`Set ${name(step, index)}`} title="Name, length, remove"
        onclick={(event) => (menu = { step, index, anchor: event.currentTarget })}><Icon name="more" size={11} /></button>
    </div>
  {/each}
  <button type="button" class="add" aria-label="Add a step" title={current ? 'Add a step after this one' : 'Add a step to this day'} onclick={() => onadd?.()}>
    <Icon name="plus" size={14} /></button>
</div>

{#if menu}
  <FloatingMenu anchor={menu.anchor} width={220} label="Step" role="dialog" onclose={() => (menu = null)}>
    <div class="fields">
      <label>Name<input class="input" maxlength="80" placeholder={`Step ${menu?.index + 1}`} value={menu?.step.name ?? ''}
        onchange={(event) => onchange?.(menu.step.id, { name: event.currentTarget.value.trim() })} /></label>
      {#if menu && firstClip(menu.step)}
        <p class="fm-note">Holds as long as its longest clip.</p>
      {:else}
        <label>Seconds<input class="input" type="number" min="0.5" max="120" step="0.5" value={menu?.step.duration ?? 3}
          onchange={(event) => onchange?.(menu.step.id, { duration: Math.max(0.5, Math.min(120, Number(event.currentTarget.value) || 3)) })} /></label>
      {/if}
    </div>
    <div class="fm-sep"></div>
    <button type="button" class="fm-item" disabled={menu?.index === 0} onclick={() => { const { step, index } = menu; menu = null; onmove?.(step.id, index - 1); }}>
      <Icon name="chevronLeft" size={14} /><span class="fm-grow">Play it earlier</span></button>
    <button type="button" class="fm-item" disabled={menu?.index === steps.length - 1} onclick={() => { const { step, index } = menu; menu = null; onmove?.(step.id, index + 2); }}>
      <Icon name="chevronRight" size={14} /><span class="fm-grow">Play it later</span></button>
    <div class="fm-sep"></div>
    <button type="button" class="fm-item danger" onclick={() => { const { step } = menu; menu = null; onremove?.(step.id); }}>
      <Icon name="trash" size={14} /><span class="fm-grow">{menu && owned(menu.step) ? `Remove it and its ${owned(menu.step) === 1 ? 'element' : `${owned(menu.step)} elements`}` : 'Remove it'}</span></button>
  </FloatingMenu>
{/if}

<style>
  .steps { display: flex; align-items: stretch; gap: 6px; padding: 6px 14px 0; overflow-x: auto; background: var(--bg-1); border-top: 1px solid var(--border); }
  .slot { position: relative; display: flex; border-radius: var(--r-sm); }
  .slot.drop-before { box-shadow: -3px 0 var(--accent); }
  .slot.drop-after { box-shadow: 3px 0 var(--accent); }
  .tile { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; align-items: center; gap: 0 6px; width: 132px; flex: none;
    padding: 4px 6px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); color: var(--text-2);
    font-size: 11px; text-align: left; cursor: pointer; }
  .tile:hover { border-color: var(--accent); color: var(--text-1); }
  .tile.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text-1); }
  .thumb { position: relative; grid-row: span 2; display: grid; place-items: center; width: 44px; height: 28px; border-radius: 3px; overflow: hidden;
    background: var(--bg-3); color: var(--text-3); }
  .thumb video { width: 100%; height: 100%; object-fit: cover; }
  .play { position: absolute; right: 2px; bottom: 2px; display: grid; place-items: center; width: 13px; height: 13px; border-radius: 50%;
    background: rgba(0, 0, 0, .65); color: #fff; }
  .number { font-weight: 700; font-size: 12px; }
  .tile-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .time { color: var(--text-3); font-size: 10px; font-variant-numeric: tabular-nums; }
  .more { position: absolute; top: 2px; right: 2px; display: grid; place-items: center; width: 18px; height: 18px; border-radius: var(--r-sm);
    color: var(--text-3); opacity: 0; cursor: pointer; }
  .slot:hover .more, .more:focus-visible { opacity: 1; }
  .more:hover { background: var(--bg-3); color: var(--text-1); }
  .add { display: grid; place-items: center; width: 34px; flex: none; border: 1px dashed var(--border); border-radius: var(--r-sm); color: var(--text-2); cursor: pointer; }
  .add:hover { border-color: var(--accent); color: var(--text-1); }
  .fields { display: grid; gap: 6px; padding: 6px; }
  .fields label { display: grid; gap: 3px; color: var(--text-3); font-size: 11px; }
  .fields .input { height: 26px; font-size: var(--fs-xs); }
</style>
