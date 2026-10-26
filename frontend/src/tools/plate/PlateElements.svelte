<script>
  /**
   * The left of the plate editor: what the page holds, top first. What can be added
   * is in Add, over the page (`PlateAdd.svelte`).
   *
   * - A row picks its element (Shift adds it), and is dragged to restack it. Maps
   *   stay under the writing, so the drag only offers the places a row can take: the
   *   writing among the writing, a map among the maps. A double click names it. Its
   *   eye hides it from the page and the export, its lock keeps it where it is.
   * - On a plate played through its days, **Other days** lists the annotations that
   *   belong to other days than the one shown, each stretched to reach this day or
   *   carried from this day on: what was drawn yesterday is there to reuse, never
   *   there by default.
   * - While a step is shown, the list holds the day's elements and that step's, the
   *   step's marked; another step's elements wait on their own step.
   */
  import Icon from '../../components/Icon.svelte';
  import { KIND_LABELS, MAP_KINDS, bringTo, carryOn, dated, fillTokens, landingIn, listedOf, periodSaid, shownOn } from '../../lib/plate/page.js';
  import { momentLabel } from '../../lib/map/layerHistory.js';
  import symbols from '../../lib/map/layerSymbols.json';

  let {
    spec,
    selection = $bindable([]),
    /** The plate's day, null for now. */
    at = null,
    /** The step shown (`placeOf`). */
    place = null,
    /** The plate draws a layer followed over time, so its annotations belong to days. */
    playable = false,
    ghosts = $bindable(false),
    tokens = {},
    /** `(id, index)`: the element let go above the row at that place in the list, top first (`page.restacked`). */
    onrestack,
    /** The list put away, from its own header. */
    onhide = null,
    /** `(id, { x, y })`: a right-click on a row, which opens the element's menu. */
    oncontext = null,
  } = $props();

  const ICONS = { map: 'satellite', inset: 'mapArea', legend: 'list', text: 'text', label: 'pin', arrow: 'arrowRight', scale: 'ruler',
    north: 'compass', image: 'image', credits: 'info', shape: 'square', ring: 'rings', cone: 'viewCone', zone: 'polygon', measure: 'line', line: 'curve',
    key: 'numbered', table: 'table', qr: 'qr', timeline: 'clock', signature: 'edit', brand: 'brand', video: 'video', symbol: 'star', focus: 'globe' };

  let naming = $state('');
  let nameField = $state('');
  /** A press on a row, which becomes a drag a few pixels on, so a click still picks. */
  let armed = null;
  let dragged = $state('');
  /** Where the dragged row would land, in the list, top first. */
  let target = $state(-1);
  let listEl = $state();
  let asideEl = $state();
  /** The pointer's height while a row is dragged, which the list scrolls toward near its edges. */
  let pointerY = 0;
  let scrolling = 0;

  /** The page's elements, top first: the day's, and the shown step's; another step's wait on it. */
  const list = $derived(listedOf(spec, at, place));
  const otherDays = $derived(playable ? spec.elements.filter((element) => dated(element) && !shownOn(element, at)) : []);

  function describe(element) {
    if (element.name) return element.name;
    if (element.kind === 'map' && element.of) return 'Detail map';
    if (element.kind === 'map') {
      const index = spec.elements.filter((item) => item.kind === 'map').indexOf(element);
      return index ? `Map ${index + 1}` : 'Map';
    }
    if (element.kind === 'video' && element.src) return element.src.split('/').pop();
    if (element.kind === 'symbol') return symbols.find((choice) => choice.id === element.symbol)?.label ?? KIND_LABELS.symbol;
    if (['text', 'label', 'arrow', 'zone'].includes(element.kind) && element.text) {
      return (fillTokens(element.text, tokens) || KIND_LABELS[element.kind]).split('\n')[0];
    }
    return KIND_LABELS[element.kind] ?? element.kind;
  }

  function pick(event, element) {
    const ids = element.group ? spec.elements.filter((item) => item.group === element.group).map((item) => item.id) : [element.id];
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      selection = selection.includes(element.id) ? selection.filter((id) => !ids.includes(id))
        : [...selection.filter((id) => !ids.includes(id)), ...ids.filter((id) => id !== element.id), element.id];
    } else selection = [...ids.filter((id) => id !== element.id), element.id];
  }

  function rename(element) {
    element.name = nameField.trim().slice(0, 80);
    naming = '';
  }

  /** The place under the pointer a row may take: the writing stays above the maps, a map among them. */
  function landing(id, clientY) {
    const rows = [...(listEl?.children ?? [])];
    const index = rows.findIndex((row) => { const rect = row.getBoundingClientRect(); return clientY < rect.top + rect.height / 2; });
    return landingIn(list, id, index < 0 ? rows.length : index);
  }

  function press(event, element) {
    if (event.button !== 0 || naming === element.id || event.target.closest('input, .mini')) return;
    armed = { id: element.id, x: event.clientX, y: event.clientY, pointer: event.pointerId, row: event.currentTarget };
  }
  function follow(event) {
    if (!armed) return;
    if (!dragged) {
      if (Math.hypot(event.clientX - armed.x, event.clientY - armed.y) < 4) return;
      dragged = armed.id;
      armed.row.setPointerCapture?.(armed.pointer);
      scrolling = requestAnimationFrame(scrollNearEdge);
    }
    pointerY = event.clientY;
    target = landing(dragged, event.clientY);
  }
  /** A long list scrolls while the dragged row is held near its top or its bottom. */
  function scrollNearEdge() {
    if (!dragged || !asideEl) return;
    const box = asideEl.getBoundingClientRect();
    const by = pointerY < box.top + 28 ? -8 : pointerY > box.bottom - 28 ? 8 : 0;
    if (by) {
      asideEl.scrollTop += by;
      target = landing(dragged, pointerY);
    }
    scrolling = requestAnimationFrame(scrollNearEdge);
  }
  function release() {
    if (dragged && target >= 0) onrestack?.(dragged, target);
    cancelAnimationFrame(scrolling);
    armed = null;
    dragged = '';
    target = -1;
  }
  // the release can land anywhere, outside the list or the window
  $effect(() => {
    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    return () => {
      window.removeEventListener('pointermove', follow);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
    };
  });
</script>

<aside class="elements" aria-label="Elements" bind:this={asideEl}>
  <div class="head">
    <h4>On the page <span class="count">{list.length}</span></h4>
    {#if onhide}
      <button type="button" class="mini shown" aria-label="Hide the list" title="Hide the list" onclick={onhide}><Icon name="chevronLeft" size={13} /></button>
    {/if}
  </div>
  <ul class="list" class:sorting={!!dragged} bind:this={listEl}>
    {#each list as element, index (element.id)}
      <li class:drop-before={target === index} class:drop-after={target === list.length && index === list.length - 1}
        class:dragging={dragged === element.id} onpointerdown={(event) => press(event, element)}
        oncontextmenu={(event) => { if (!oncontext || naming === element.id) return; event.preventDefault(); oncontext(element.id, { x: event.clientX, y: event.clientY }); }}>
        {#if naming === element.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input class="name-field" aria-label="Element name" bind:value={nameField} maxlength="80" autofocus
            onblur={() => rename(element)} onkeydown={(event) => { if (event.key === 'Enter') rename(element); if (event.key === 'Escape') naming = ''; }} />
        {:else}
          <button type="button" class="row" class:active={selection.includes(element.id)} class:dim={element.hidden || !shownOn(element, at, place)}
            onclick={(event) => pick(event, element)} ondblclick={() => { naming = element.id; nameField = element.name || describe(element); }}
            title={MAP_KINDS.includes(element.kind) ? 'Maps stay under the page\'s writing. Double-click to name it.' : 'Double-click to name it'}>
            <Icon name={ICONS[element.kind] ?? 'square'} size={12} /><span class="row-name">{describe(element)}</span>
            {#if element.step}<span class="tag step" title={element.carry ? 'On this step and the steps after it' : 'On this step only'}>Step</span>{/if}
            {#if element.group}<span class="tag" title="Picked and moved with its group">G</span>{/if}
          </button>
          <button type="button" class="mini" class:on={element.hidden} aria-label={element.hidden ? `Show ${describe(element)}` : `Hide ${describe(element)}`}
            title={element.hidden ? 'Hidden from the page and the export' : 'Hide'} onclick={() => (element.hidden = !element.hidden)}>
            <Icon name={element.hidden ? 'eyeOff' : 'eye'} size={12} /></button>
          <button type="button" class="mini" class:on={element.locked} aria-label={element.locked ? `Unlock ${describe(element)}` : `Lock ${describe(element)}`}
            title={element.locked ? 'Locked where it is' : 'Lock'} onclick={() => (element.locked = !element.locked)}>
            <Icon name={element.locked ? 'lock' : 'unlock'} size={12} /></button>
        {/if}
      </li>
    {/each}
  </ul>

  {#if playable}
    <h4>Other days</h4>
    <label class="ghosts"><input type="checkbox" bind:checked={ghosts} /> Show them faintly</label>
    {#each otherDays as element (element.id)}
      <div class="other">
        <span class="row-name" title={periodSaid(element, momentLabel)}>{describe(element)}</span>
        <button type="button" class="pill" title="Stretch its days to this one" onclick={() => Object.assign(element, bringTo(element, at))}>Here</button>
        <button type="button" class="pill" title="Show it on this day and every day after" onclick={() => Object.assign(element, carryOn(element, at))}>From here</button>
      </div>
    {:else}
      <p class="note">What you add on the map belongs to the day shown. Another day's annotations are listed here, to bring back.</p>
    {/each}
  {/if}
</aside>

<style>
  .elements { width: 100%; height: 100%; overflow-y: auto; padding: 6px 10px 14px; background: var(--bg-1); }
  .head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .head h4 { flex: 1; margin: 6px 0; }
  h4 { margin: 12px 0 6px; color: var(--text-3); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .count { margin-left: 4px; padding: 0 5px; border-radius: 999px; background: var(--bg-3); color: var(--text-2); font-weight: 600; letter-spacing: normal; }
  .list { list-style: none; margin: 0; padding: 0; }
  .list li { display: flex; align-items: center; gap: 1px; border-radius: var(--r-sm); }
  .list li.drop-before { box-shadow: inset 0 2px var(--accent); }
  .list li.drop-after { box-shadow: inset 0 -2px var(--accent); }
  .list li.dragging { opacity: .45; }
  .list.sorting, .list.sorting .row { cursor: grabbing; user-select: none; }
  .row { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; min-height: 24px; padding: 3px 6px; border-radius: var(--r-sm);
    color: var(--text-2); font-size: var(--fs-xs); text-align: left; cursor: pointer; }
  .row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: none; letter-spacing: normal; }
  .row:hover, .row.active { background: var(--bg-3); color: var(--text-1); }
  .row.active { box-shadow: inset 2px 0 var(--accent); }
  .row.dim { opacity: .5; }
  .tag { padding: 0 3px; border: 1px solid var(--border); border-radius: 3px; color: var(--text-3); font-size: 9px; }
  .tag.step { border-color: var(--accent); color: var(--accent); }
  .mini { display: grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: var(--r-sm); color: var(--text-3); opacity: 0; cursor: pointer; }
  .list li:hover .mini, .mini.on, .mini.shown, .mini:focus-visible { opacity: 1; }
  .mini.on { color: var(--accent); }
  .mini:hover { background: var(--bg-3); color: var(--text-1); }
  .name-field { width: 100%; height: 24px; padding: 2px 6px; font-size: var(--fs-xs); }
  .ghosts { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
  .other { display: flex; align-items: center; gap: 3px; min-height: 24px; padding: 2px 0; color: var(--text-2); font-size: var(--fs-xs); }
  .pill { flex: none; padding: 1px 6px; border: 1px solid var(--border); border-radius: 999px; color: var(--text-2); font-size: 10px; cursor: pointer; }
  .pill:hover { border-color: var(--accent); color: var(--text-1); }
  .note { margin: 4px 0; color: var(--text-3); font-size: 10.5px; line-height: 1.45; }
</style>
