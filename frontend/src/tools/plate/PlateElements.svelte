<script>
  /**
   * The left of the plate editor: what can be added, grouped by where it goes, and
   * what the page holds, top first.
   *
   * - A row picks its element (Shift adds it), and is dragged to restack it; maps
   *   stay under the writing whatever the order. A double click names it. Its eye
   *   hides it from the page and the export, its lock keeps it where it is.
   * - On a plate played through its days, **Other days** lists the annotations that
   *   belong to other days than the one shown, each stretched to reach this day or
   *   carried from this day on: what was drawn yesterday is there to reuse, never
   *   there by default.
   * - While a step is shown, the list holds the day's elements and that step's, the
   *   step's marked; another step's elements wait on their own step.
   */
  import Icon from '../../components/Icon.svelte';
  import { KIND_LABELS, MAP_KINDS, bringTo, carryOn, dated, fillTokens, periodSaid, shownOn } from '../../lib/plate/page.js';
  import { momentLabel } from '../../lib/map/layerHistory.js';

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
    placing = null,
    tokens = {},
    onadd,
    /** `(id, index)`: the element moved to that place in the list, top first. */
    onrestack,
  } = $props();

  /** What can be added, by where it goes on the page. */
  const SECTIONS = [
    { title: 'Maps', items: [['map', 'Map', 'satellite'], ['detail', 'Detail', 'zoomInset'], ['inset', 'Inset map', 'mapArea']] },
    { title: 'On the map', note: 'Press the map to place it', items: [['label', 'Label', 'pin'], ['number', 'Number', 'hash'],
      ['arrow', 'Arrow', 'arrowRight'], ['measure', 'Distance', 'line'], ['ring', 'Rings', 'rings'], ['cone', 'View cone', 'viewCone'],
      ['zone', 'Zone', 'polygon'], ['spotlight', 'Spotlight', 'crosshair']] },
    { title: 'Round the map', items: [['legend', 'Legend', 'list'], ['scale', 'Scale bar', 'ruler'], ['north', 'North arrow', 'compass'],
      ['credits', 'Credits', 'info'], ['timeline', 'Date strip', 'clock']] },
    { title: 'Writing', items: [['text', 'Text', 'text'], ['banner', 'Banner', 'columns'], ['stamp', 'Stamp', 'tag'], ['key', 'Numbered list', 'numbered'],
      ['table', 'Table', 'table'], ['qr', 'QR code', 'qr']] },
    { title: 'Signing', items: [['signature', 'Signature', 'edit'], ['brand', 'Made with Azimut', 'brand']] },
    { title: 'Pictures and shapes', items: [['image', 'Picture', 'image'], ['video', 'Video', 'video'], ['logo', 'Logo', 'shield'], ['rect', 'Box', 'square'],
      ['ellipse', 'Ellipse', 'circle'], ['rule', 'Rule', 'lineSolid']] },
  ];
  const ICONS = { map: 'satellite', inset: 'mapArea', legend: 'list', text: 'text', label: 'pin', arrow: 'arrowRight', scale: 'ruler',
    north: 'compass', image: 'image', credits: 'info', shape: 'square', ring: 'rings', cone: 'viewCone', zone: 'polygon', measure: 'line',
    key: 'numbered', table: 'table', qr: 'qr', timeline: 'clock', signature: 'edit', brand: 'brand', video: 'video' };

  let folded = $state(new Set());
  let naming = $state('');
  let nameField = $state('');
  let dragged = $state('');
  let target = $state(-1);

  /** The page's elements, top first: the day's, and the shown step's; another step's wait on it. */
  const list = $derived([...spec.elements].reverse().filter((element) => !element.step || shownOn(element, at, place)));
  const otherDays = $derived(playable ? spec.elements.filter((element) => dated(element) && !shownOn(element, at)) : []);

  function describe(element) {
    if (element.name) return element.name;
    if (element.kind === 'map' && element.of) return 'Detail map';
    if (element.kind === 'map') {
      const index = spec.elements.filter((item) => item.kind === 'map').indexOf(element);
      return index ? `Map ${index + 1}` : 'Map';
    }
    if (element.kind === 'video' && element.src) return element.src.split('/').pop();
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

  function toggle(title) {
    const next = new Set(folded);
    if (next.has(title)) next.delete(title); else next.add(title);
    folded = next;
  }

  function dragOver(event, index) {
    if (!dragged) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    target = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
  }
  function drop(event) {
    if (!dragged) return;
    event.preventDefault();
    // the list may leave out another step's elements: the place is read in the page's whole order
    if (target >= 0) {
      const whole = [...spec.elements].reverse();
      onrestack?.(dragged, list[target] ? whole.indexOf(list[target]) : whole.length);
    }
    dragged = ''; target = -1;
  }
</script>

<aside class="elements" aria-label="Elements">
  {#each SECTIONS as section (section.title)}
    <button type="button" class="section" aria-expanded={!folded.has(section.title)} onclick={() => toggle(section.title)}>
      <Icon name={folded.has(section.title) ? 'chevronRight' : 'chevronDown'} size={11} />{section.title}</button>
    {#if !folded.has(section.title)}
      <div class="adds">
        {#each section.items as [kind, label, icon] (kind)}
          <button type="button" class="add" class:on={placing?.kind === kind || placing?.preset === kind} onclick={() => onadd?.(kind)}
            title={section.note ? `${label}: ${section.note.toLowerCase()}` : `Add ${label.toLowerCase()}`}>
            <Icon name={icon} size={14} /><span>{label}</span></button>
        {/each}
      </div>
    {/if}
  {/each}

  <h4>On the page</h4>
  <ul class="list" ondragover={(event) => event.preventDefault()} ondrop={drop}>
    {#each list as element, index (element.id)}
      <li class:drop-before={target === index} class:drop-after={target === list.length && index === list.length - 1}
        draggable={naming !== element.id} ondragstart={(event) => { dragged = element.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', element.id); }}
        ondragend={() => { dragged = ''; target = -1; }} ondragover={(event) => dragOver(event, index)}>
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
  .elements { width: 196px; flex: none; overflow-y: auto; padding: 8px 10px 14px; border-right: 1px solid var(--border); background: var(--bg-1); }
  .section { display: flex; align-items: center; gap: 4px; width: 100%; margin: 6px 0 4px; padding: 2px 0; color: var(--text-3); font-size: 10px;
    font-weight: 700; text-transform: uppercase; letter-spacing: .06em; cursor: pointer; text-align: left; }
  .section:hover { color: var(--text-1); }
  h4 { margin: 12px 0 6px; color: var(--text-3); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .adds { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 3px; margin-bottom: 6px; }
  .add { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 5px 1px; border: 1px solid var(--border); border-radius: var(--r-sm);
    color: var(--text-2); font-size: 9.5px; line-height: 1.15; cursor: pointer; text-align: center; }
  .add:hover, .add.on { border-color: var(--accent); color: var(--text-1); background: var(--accent-soft); }
  .list { list-style: none; margin: 0; padding: 0; }
  .list li { display: flex; align-items: center; gap: 1px; border-radius: var(--r-sm); }
  .list li.drop-before { box-shadow: inset 0 2px var(--accent); }
  .list li.drop-after { box-shadow: inset 0 -2px var(--accent); }
  .row { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; min-height: 24px; padding: 3px 6px; border-radius: var(--r-sm);
    color: var(--text-2); font-size: var(--fs-xs); text-align: left; cursor: pointer; }
  .row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: none; letter-spacing: normal; }
  .row:hover, .row.active { background: var(--bg-3); color: var(--text-1); }
  .row.active { box-shadow: inset 2px 0 var(--accent); }
  .row.dim { opacity: .5; }
  .tag { padding: 0 3px; border: 1px solid var(--border); border-radius: 3px; color: var(--text-3); font-size: 9px; }
  .tag.step { border-color: var(--accent); color: var(--accent); }
  .mini { display: grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: var(--r-sm); color: var(--text-3); opacity: 0; cursor: pointer; }
  .list li:hover .mini, .mini.on, .mini:focus-visible { opacity: 1; }
  .mini.on { color: var(--accent); }
  .mini:hover { background: var(--bg-3); color: var(--text-1); }
  .name-field { width: 100%; height: 24px; padding: 2px 6px; font-size: var(--fs-xs); }
  .ghosts { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
  .other { display: flex; align-items: center; gap: 3px; min-height: 24px; padding: 2px 0; color: var(--text-2); font-size: var(--fs-xs); }
  .pill { flex: none; padding: 1px 6px; border: 1px solid var(--border); border-radius: 999px; color: var(--text-2); font-size: 10px; cursor: pointer; }
  .pill:hover { border-color: var(--accent); color: var(--text-1); }
  .note { margin: 4px 0; color: var(--text-3); font-size: 10.5px; line-height: 1.45; }
</style>
