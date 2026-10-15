<script>
  /**
   * What the picked element of a plate is, field by field; what several picked ones
   * share (lining them up, spacing them, grouping them); the page itself when
   * nothing is picked. Every field writes the plate as it is set, and the plate
   * saves itself.
   *
   * A video is set here: its file (the footage placed on the map first, pointing at
   * its place), the part of it the clip runs, its sound, and the line saying where
   * it comes from, read from the file's record and written over as wanted.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import MonthGrid from '../../components/MonthGrid.svelte';
  import { api } from '../../lib/api.js';
  import { today as calendarToday } from '../../lib/calendar.js';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { buildMediaQuery } from '../../lib/mediaQuery.js';
  import { isTracked, momentLabel } from '../../lib/map/layerHistory.js';
  import { prefs } from '../../lib/state.svelte.js';
  import { FONTS, KIND_LABELS, PAPERS, SIGNATURE, THEMES, TOKENS, bornOn, bringTo, dayOf, endOn, labelBox, mainMap,
    pageSize, shownOn, startOn, textMeasurer, turnable } from '../../lib/plate/page.js';
  import { FIRST_SECONDS, captionOf, clipRange, readTimecode, timecode } from '../../lib/plate/clip.js';
  import { GRATICULE_STEPS } from '../../lib/plate/geo.js';
  import { align, distribute, fittedHeight, sameSize } from '../../lib/plate/arrange.js';
  import { moveRow } from '../../lib/plate/legend.js';
  import { PALETTES } from '../../lib/plate/plainBasemap.js';
  import { WAYBACK_ID } from '../../lib/wayback.js';
  import { shrinkPicture } from '../../lib/plate/picture.js';
  import PlateColour from './PlateColour.svelte';

  let {
    spec,
    selection = [],
    caseId = '',
    rows = [],
    /** The basemaps a plate offers, `[id, label]`. */
    grounds = [],
    /** The Wayback releases, `{ release, date }`, newest first, once read. */
    releases = [],
    /** The rows each legend shows now, by legend id. */
    legend = {},
    /** The plate's day, and the days it changes on. */
    at = null,
    moments = [],
    /** The step shown (`placeOf`), and `{ id, name }` of it, or null on the day itself. */
    place = null,
    step = null,
    /** The elements whose words run past their box. */
    overflow = new Set(),
    framing = '',
    onpaper,
    ontheme,
    onremove,
    onduplicate,
    onorder,
    onframe,
    onlabels,
    onpoint,
    ongroup,
    onwayback,
    /** The pictures the main map's features carry (a proof's plate, a video's frame), each with its point. */
    featurePictures = [],
  } = $props();

  const picked = $derived(spec.elements.filter((item) => selection.includes(item.id)));
  const element = $derived(picked.length === 1 ? picked[0] : null);
  const maps = $derived(spec.elements.filter((item) => item.kind === 'map'));
  const credited = $derived(spec.elements.filter((item) => item.kind === 'credits').length);
  const playable = $derived(moments.length > 0);

  const measure = $derived(textMeasurer(spec.theme));
  let picking = $state(false);
  let pickAnchor = $state(null);
  let pictures = $state([]);
  let fileInput = $state(null);
  let backgroundInput = $state(null);

  const OVERLAYS = [['relief', 'Relief shading'], ['boundaries', 'Borders and big names'], ['placenames', 'Town and village names']];
  const PLAIN_COLOURS = [['ground', 'Land'], ['water', 'Water'], ['wood', 'Woods'], ['urban', 'Towns'], ['road', 'Roads'], ['border', 'Borders'], ['name', 'Names']];
  const LANGS = [['latin', 'Latin letters'], ['local', 'As written there'], ['en', 'English'], ['fr', 'French'], ['ar', 'Arabic'], ['ru', 'Russian'], ['uk', 'Ukrainian']];
  const TONES = { none: ['As it is', { opacity: 1, saturation: 0, brightness: 1, contrast: 0, hue: 0 }],
    grey: ['Greyed', { opacity: 1, saturation: -0.85, brightness: 0.9, contrast: 0.05, hue: 0 }],
    faded: ['Faded', { opacity: 0.55, saturation: -0.4, brightness: 1, contrast: -0.1, hue: 0 }],
    dark: ['Darkened', { opacity: 1, saturation: -0.5, brightness: 0.55, contrast: 0.1, hue: 0 }] };
  const name = (map) => map.name || (map.of ? 'Detail map' : maps.indexOf(map) ? `Map ${maps.indexOf(map) + 1}` : 'Map');

  function toggleOverlay(id) {
    const list = element.overlays ?? [];
    element.overlays = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
  }
  function toggleLayer(row) {
    const list = element.layers ?? [];
    element.layers = list.some((entry) => entry.name === row.name)
      ? list.filter((entry) => entry.name !== row.name)
      : [...list, { name: row.name, hidden: [], stroke: 1, icons: 1 }];
  }
  function moveLayer(entry, by) {
    const list = [...element.layers];
    const from = list.indexOf(entry);
    const to = Math.max(0, Math.min(list.length - 1, from + by));
    list.splice(from, 1);
    list.splice(to, 0, entry);
    element.layers = list;
  }
  function toggleGroup(entry, group) {
    entry.hidden = entry.hidden.includes(group) ? entry.hidden.filter((item) => item !== group) : [...entry.hidden, group];
  }
  async function openPictures(event) {
    pickAnchor = event.currentTarget;
    picking = true;
    try {
      const page = await api.get(buildMediaQuery(caseId, { kind: 'image', limit: 120 }));
      pictures = page.items ?? [];
    } catch { pictures = []; }
  }
  async function readPicture(file, apply) {
    if (!file) return;
    try { apply(await shrinkPicture(file)); } catch (error) { alertText = error.message; }
  }
  let alertText = $state('');
  const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

  function setBoxes(boxes) {
    for (const item of picked) if (boxes[item.id]) item.box = boxes[item.id];
  }
  function fitBox() {
    const height = fittedHeight(element, measure);
    element.box = [element.box[0], element.box[1], element.box[2], Math.max(4, height)];
  }
  function theme(id) {
    ontheme?.(id);
  }

  // -- legend rows ----------------------------------------------------------------
  const rowsOf = $derived(element?.kind === 'legend' ? legend[element.id] ?? [] : []);
  function toggleRow(key) {
    const off = element.off ?? [];
    element.off = off.includes(key) ? off.filter((item) => item !== key) : [...off, key];
  }
  function moveLegendRow(key, by) {
    element.order = moveRow(rowsOf, key, by);
  }
  function renameRow(key, value) {
    const names = { ...(element.names ?? {}) };
    const text = value.trim();
    if (text) names[key] = text; else delete names[key];
    element.names = names;
  }

  // -- a video ----------------------------------------------------------------------
  let trimVideo = $state(null);
  let trimLength = $state(null);
  let clipEnd = 0;
  let videos = $state([]);
  let footage = $state([]);
  let pickingVideo = $state(false);
  $effect(() => { void element?.src; trimLength = null; });
  const range = $derived(element?.kind === 'video' ? clipRange(element, trimLength) : [0, 0]);
  const fileName = (path) => String(path ?? '').split('/').pop();

  async function openVideos(event) {
    pickAnchor = event.currentTarget;
    pickingVideo = true;
    try {
      const [page, located] = await Promise.all([api.get(buildMediaQuery(caseId, { kind: 'video', limit: 120 })),
        api.get(`/api/cases/${caseId}/satellite/media`).catch(() => [])]);
      videos = page.items ?? [];
      footage = (Array.isArray(located) ? located : []).filter((row) => row.media_kind === 'video' && row.path).slice(0, 60);
    } catch { videos = []; footage = []; }
  }
  /** A file for the video, pointing at `point` when it was picked on the map; its source line read from its record. */
  async function chooseVideo(path, point = null) {
    pickingVideo = false;
    const main = mainMap(spec);
    Object.assign(element, { src: path, clip: [0, FIRST_SECONDS],
      ...(point && main ? { at: point, of: main.id, leader: element.leader ?? 'straight' } : {}) });
    try {
      const item = await api.get(`/api/cases/${caseId}/media/item?path=${encodeURIComponent(path)}`);
      if (element.src === path) element.text = captionOf(item);
    } catch { /* the line stays as it was, to be written by hand */ }
  }
  async function readCaption() {
    try { element.text = captionOf(await api.get(`/api/cases/${caseId}/media/item?path=${encodeURIComponent(element.src)}`)); } catch { /* kept */ }
  }
  /** The video's length is read: a clip running past it is brought back inside. */
  function lengthKnown(duration) {
    trimLength = Number.isFinite(duration) && duration > 0 ? duration : null;
    const inside = clipRange(element, trimLength);
    if (trimLength && (element.clip?.[0] !== inside[0] || element.clip?.[1] !== inside[1])) element.clip = inside;
  }
  function setClip(start, end) {
    element.clip = clipRange({ clip: [start, end] }, trimLength);
  }
  function playClip() {
    if (!trimVideo) return;
    clipEnd = range[1];
    trimVideo.currentTime = range[0];
    trimVideo.play().catch(() => {});
  }
  function trimTick() {
    if (clipEnd && trimVideo && trimVideo.currentTime >= clipEnd) { trimVideo.pause(); clipEnd = 0; }
  }

  // -- the days an annotation belongs to --------------------------------------------
  const shownToday = $derived(element ? shownOn(element, at, place) : true);
  /** The plate's day as a button says it: "on 14 Oct 2026", or "now". */
  const onDay = $derived(at ? `on ${momentLabel(at)}` : 'now');
  const dayName = (day) => (day === 'now' ? 'Now' : momentLabel(day));
  /** Which end of the annotation's days has its calendar open: `onward`, `until`, or neither. */
  let ending = $state('');
  $effect(() => { void element?.id; ending = ''; });
  function setEnd(day) {
    Object.assign(element, ending === 'onward' ? startOn(element, day) : endOn(element, day));
    ending = '';
  }
  const endDay = $derived(((ending === 'onward' ? element?.onward : element?.until) || at || '').slice(0, 10).replace(/^now$/, '')
    || calendarToday());
  /** What the signature is made of, said where it is set, and where to set what is missing. */
  const signatureNote = $derived(prefs.signatureHandle
    ? `{handle} is ${prefs.signatureHandle}; the picture is the one in Settings → Publishing → Signature, when there is one.`
    : 'Set your handle and your picture in Settings → Publishing → Signature; {handle} and {today} are filled in.');
</script>

<aside class="inspector" aria-label="Plate inspector">
  {#if alertText}<p class="warn" role="alert">{alertText} <button type="button" class="text-act" onclick={() => (alertText = '')}>OK</button></p>{/if}
  {#if !picked.length}
    <h3>Page</h3>
    <h4>Looks</h4>
    <div class="themes">
      {#each Object.entries(THEMES) as [id, preset] (id)}
        <button type="button" class="theme" class:on={spec.theme.preset === id} onclick={() => theme(id)} title={`Set the page and its maps as ${preset.label}`}>
          <span class="sample" style:background={preset.theme.paper} style:color={preset.theme.ink} style:border-color={preset.theme.accent}>Aa</span>
          <span>{preset.label}</span></button>
      {/each}
    </div>
    <div class="rows">
      <span class="key">Paper</span>
      <select aria-label="Paper" value={spec.page.paper}
        onchange={(event) => { const paper = event.currentTarget.value; onpaper({ ...spec.page, paper, ...(paper === 'custom' ? { size: [pageSize(spec.page).width, pageSize(spec.page).height] } : {}) }); }}>
        {#each Object.entries(PAPERS) as [id, paper] (id)}<option value={id}>{paper.label}</option>{/each}
      </select>
      {#if spec.page.paper === 'custom'}
        <span class="key">Size, mm</span>
        <span class="pair">
          <input type="number" aria-label="Page width" min="30" max="1200" step="1" value={spec.page.size?.[0] ?? 297}
            onchange={(event) => onpaper({ ...spec.page, size: [Math.max(30, Math.min(1200, number(event.currentTarget.value, 297))), spec.page.size?.[1] ?? 210] })} />
          ×
          <input type="number" aria-label="Page height" min="30" max="1200" step="1" value={spec.page.size?.[1] ?? 210}
            onchange={(event) => onpaper({ ...spec.page, size: [spec.page.size?.[0] ?? 297, Math.max(30, Math.min(1200, number(event.currentTarget.value, 210)))] })} />
        </span>
      {/if}
      {#if turnable(spec.page)}
        <span class="key">Turned</span>
        <div class="segments" role="group" aria-label="Orientation">
          {#each [['landscape', 'Landscape'], ['portrait', 'Portrait']] as [value, label] (value)}
            <button type="button" aria-pressed={spec.page.orientation === value} onclick={() => onpaper({ ...spec.page, orientation: value })}>{label}</button>
          {/each}
        </div>
      {/if}
      <span class="key">Font</span>
      <select aria-label="Font" bind:value={spec.theme.font}>
        {#each Object.entries(FONTS) as [id, font] (id)}<option value={id}>{font.label}</option>{/each}
      </select>
      <span class="key">Paper colour</span><input type="color" aria-label="Paper colour" bind:value={spec.theme.paper} />
      <span class="key">Ink</span><input type="color" aria-label="Ink colour" bind:value={spec.theme.ink} />
      <span class="key">Accent</span><input type="color" aria-label="Accent colour" bind:value={spec.theme.accent} />
      <span class="key">Paper</span>
      <div class="segments" role="group" aria-label="Paper background">
        {#each [['solid', 'Plain'], ['gradient', 'Gradient'], ['image', 'Picture']] as [value, label] (value)}
          <button type="button" aria-pressed={(spec.page.background?.kind ?? 'solid') === value}
            onclick={() => (spec.page.background = { ...(spec.page.background ?? {}), kind: value })}>{label}</button>
        {/each}
      </div>
      {#if spec.page.background?.kind === 'gradient'}
        <span class="key">To</span>
        <span class="pair"><input type="color" aria-label="Gradient colour" value={spec.page.background.colour ?? spec.theme.paper}
          oninput={(event) => (spec.page.background.colour = event.currentTarget.value)} />
          <input type="range" aria-label="Gradient direction" min="0" max="360" step="15" bind:value={spec.page.background.angle} /></span>
      {:else if spec.page.background?.kind === 'image'}
        <span class="key">Picture</span>
        <span class="pair"><button type="button" class="btn btn-xs" onclick={() => backgroundInput?.click()}>{spec.page.background.data ? 'Another' : 'Choose…'}</button>
          {#if spec.page.background.data}<button type="button" class="text-act" onclick={() => (spec.page.background.data = null)}>Remove</button>{/if}</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden bind:this={backgroundInput}
          onchange={(event) => readPicture(event.currentTarget.files?.[0], (data) => (spec.page.background.data = data))} />
      {/if}
    </div>
    <div class="checks">
      <label><input type="checkbox" bind:checked={spec.page.frame} /> A rule round the page</label>
      <label><input type="checkbox" bind:checked={spec.page.guides} /> Show the margins and the feed crop</label>
      <label><input type="checkbox" bind:checked={spec.page.transparent} /> See-through paper in a PNG</label>
    </div>
    <p class="note">Pick an element on the page to set it, Shift to pick several. A drag inside a map moves its ground; its edge moves the frame.</p>
    <p class="note">Texts fill in {TOKENS.join(' ')}.</p>
  {:else if picked.length > 1}
    <h3>{picked.length} picked</h3>
    <h4>Line up</h4>
    <div class="tools">
      {#each [['left', 'alignLeft', 'Left edges'], ['centre', 'alignCentreH', 'Centres, across'], ['right', 'alignRight', 'Right edges'],
        ['top', 'alignTop', 'Tops'], ['middle', 'alignCentreV', 'Middles, down'], ['bottom', 'alignBottom', 'Bottoms']] as [edge, icon, label] (edge)}
        <button type="button" class="icon-act" aria-label={`Line up the ${label.toLowerCase()}`} title={label} onclick={() => setBoxes(align(picked, edge))}><Icon name={icon} size={15} /></button>
      {/each}
      <button type="button" class="icon-act" aria-label="Space them evenly across" title="Space evenly across" disabled={picked.length < 3}
        onclick={() => setBoxes(distribute(picked, 'h'))}><Icon name="distributeH" size={15} /></button>
      <button type="button" class="icon-act" aria-label="Space them evenly down" title="Space evenly down" disabled={picked.length < 3}
        onclick={() => setBoxes(distribute(picked, 'v'))}><Icon name="distributeV" size={15} /></button>
    </div>
    <h4>Size</h4>
    <div class="tools wide">
      <button type="button" class="btn btn-xs" onclick={() => setBoxes(sameSize(picked, 'width', picked.at(-1)))}>Same width</button>
      <button type="button" class="btn btn-xs" onclick={() => setBoxes(sameSize(picked, 'height', picked.at(-1)))}>Same height</button>
    </div>
    <p class="note">They take the size of the one picked last.</p>
    <h4>Together</h4>
    <div class="tools wide">
      <button type="button" class="btn btn-xs" onclick={() => ongroup?.(true)}><Icon name="layers" size={12} /> Group</button>
      <button type="button" class="btn btn-xs" onclick={() => ongroup?.(false)}>Ungroup</button>
      <button type="button" class="btn btn-xs" onclick={() => { const lock = !picked.every((item) => item.locked); for (const item of picked) item.locked = lock; }}>
        <Icon name="lock" size={12} /> {picked.every((item) => item.locked) ? 'Unlock' : 'Lock'}</button>
      <button type="button" class="btn btn-xs danger" onclick={() => { for (const item of [...picked]) onremove(item); }}><Icon name="trash" size={12} /> Remove</button>
    </div>
    <p class="note">A group is picked and moved as one. Ctrl+G groups, Ctrl+Shift+G ungroups.</p>
  {:else}
    <header>
      <h3>{KIND_LABELS[element.kind]}{#if element.kind === 'map' && element.of} (detail){/if}</h3>
      <button type="button" class="icon-act" aria-label="Bring forward" title="Bring forward" onclick={() => onorder(element, 1)}><Icon name="chevronUp" size={13} /></button>
      <button type="button" class="icon-act" aria-label="Send back" title="Send back" onclick={() => onorder(element, -1)}><Icon name="chevronDown" size={13} /></button>
      {#if element.kind !== 'credits'}
        <button type="button" class="icon-act" aria-label="Duplicate" title="Duplicate (Ctrl+D)" onclick={() => onduplicate(element)}><Icon name="copy" size={13} /></button>
      {/if}
      <button type="button" class="icon-act" aria-label={element.locked ? 'Unlock' : 'Lock'} title={element.locked ? 'Unlock' : 'Lock where it is'}
        onclick={() => (element.locked = !element.locked)}><Icon name={element.locked ? 'lock' : 'unlock'} size={13} /></button>
      <button type="button" class="icon-act danger" aria-label="Remove" title={element.kind === 'credits' && credited < 2 ? 'The map\'s sources are owed their credit' : 'Remove'}
        disabled={element.kind === 'credits' && credited < 2} onclick={() => onremove(element)}><Icon name="trash" size={13} /></button>
    </header>
    <input class="element-name" aria-label="Element name" placeholder="Name it in the list" maxlength="80" bind:value={element.name} />

    {#if element.step}
      <div class="days">
        <span class="key">Shown</span>
        {#if element.kind === 'video'}
          <span class="quiet">On {step?.id === element.step ? step.name : 'its step'}, which runs as long as the clip</span>
        {:else}
          <div class="segments" role="group" aria-label="Steps it is shown on">
            <button type="button" aria-pressed={!element.carry} onclick={() => (element.carry = false)}>This step</button>
            <button type="button" aria-pressed={!!element.carry} onclick={() => (element.carry = true)}>And after</button>
          </div>
          <p class="note wide">{#if !shownToday}Not on the step shown. {/if}<button type="button" class="text-act"
            onclick={() => Object.assign(element, { step: null, carry: false, ...bornOn(at, playable) })}>Put it on the whole day</button></p>
        {/if}
      </div>
    {:else if step && element.kind !== 'credits' && !['map', 'inset'].includes(element.kind)}
      <p class="note">On the whole day, under its steps. <button type="button" class="text-act"
        onclick={() => Object.assign(element, { step: step.id, carry: false, onward: null, until: null })}>Only on {step.name}</button></p>
    {/if}

    {#if !element.step && playable && ['label', 'arrow', 'ring', 'cone', 'zone', 'measure', 'shape', 'text', 'image'].includes(element.kind)}
      <div class="days" class:off={!shownToday}>
        <span class="key">Shown from</span>
        <button type="button" class="end" class:open={ending === 'onward'} aria-expanded={ending === 'onward'} aria-label="First day shown"
          onclick={() => (ending = ending === 'onward' ? '' : 'onward')}><Icon name="calendar" size={12} />{element.onward ? dayName(element.onward) : 'The start'}</button>
        <span class="key">to</span>
        <button type="button" class="end" class:open={ending === 'until'} aria-expanded={ending === 'until'} aria-label="Last day shown"
          onclick={() => (ending = ending === 'until' ? '' : 'until')}><Icon name="calendar" size={12} />{element.until ? dayName(element.until) : 'Now'}</button>
        {#if ending}
          <div class="pick">
            <div class="tools wide">
              {#if ending === 'onward'}<button type="button" class="btn btn-xs" onclick={() => setEnd('')}>The start</button>{/if}
              {#if at || ending === 'onward'}
                <button type="button" class="btn btn-xs" title={at ? `${momentLabel(at)}, the plate's day` : 'The plate is on now'} onclick={() => setEnd(dayOf(at))}>{at ? 'This day' : 'Now'}</button>
              {/if}
              {#if ending === 'until'}<button type="button" class="btn btn-xs" onclick={() => setEnd('')}>Now</button>{/if}
            </div>
            <MonthGrid value={endDay} max={calendarToday()} label={ending === 'onward' ? 'First day shown' : 'Last day shown'} onpick={setEnd} />
          </div>
        {/if}
        {#if !shownToday}
          <p class="note wide">Not on the plate's day. <button type="button" class="text-act" onclick={() => Object.assign(element, bringTo(element, at))}>Show it {onDay}</button></p>
        {/if}
      </div>
    {/if}

    {#if overflow.has(element.id)}
      <p class="warn">The words run past the box.
        {#if element.kind === 'text' || element.kind === 'label'}<button type="button" class="text-act" onclick={fitBox}>Fit the box</button>{/if}</p>
    {/if}

    {#if element.kind === 'map'}
      <button type="button" class="btn btn-sm frame" class:on={framing === element.id} onclick={() => onframe(element)}>
        <Icon name="move" size={12} /> {framing === element.id ? 'Done framing' : 'Frame the map'}</button>
      <div class="rows">
        {#if element.of}
          <span class="key">Detail of</span>
          <select aria-label="Detail of" bind:value={element.of}>{#each maps.filter((map) => map.id !== element.id) as map (map.id)}<option value={map.id}>{name(map)}</option>{/each}</select>
        {/if}
        <span class="key">Ground</span>
        <select aria-label="Ground" value={element.basemap} onchange={(event) => { element.basemap = event.currentTarget.value; if (element.basemap === WAYBACK_ID) onwayback?.(); }}>
          {#each grounds as [id, label] (id)}<option value={id}>{label}</option>{/each}
        </select>
        {#if element.basemap === WAYBACK_ID}
          <span class="key">Release</span>
          <select aria-label="Wayback release" value={String(element.release ?? '')}
            onchange={(event) => (element.release = event.currentTarget.value ? Number(event.currentTarget.value) : null)}>
            <option value="">Newest</option>
            {#each releases as entry (entry.release)}<option value={String(entry.release)}>{entry.date}</option>{/each}
          </select>
        {/if}
        <span class="key">Zoom</span>
        <input type="number" aria-label="Zoom" step="0.1" min="0" max="22" value={element.view.zoom.toFixed(2)}
          onchange={(event) => (element.view = { ...element.view, zoom: Math.min(22, Math.max(0, number(event.currentTarget.value, element.view.zoom))) })} />
        <span class="key">Turned</span>
        <input type="number" aria-label="Bearing" step="1" min="-180" max="180" value={Math.round(element.view.bearing ?? 0)}
          onchange={(event) => (element.view = { ...element.view, bearing: number(event.currentTarget.value, 0) % 360 })} />
        <span class="key">Frame</span>
        <span class="pair"><input type="checkbox" aria-label="Map frame" checked={element.border !== false} onchange={(event) => (element.border = event.currentTarget.checked)} />
          <input type="range" aria-label="Frame weight" min="0.5" max="4" step="0.25" value={element.width ?? 1} oninput={(event) => (element.width = Number(event.currentTarget.value))} /></span>
      </div>

      <h4>Grid</h4>
      <div class="segments" role="group" aria-label="Grid">
        {#each [['none', 'None'], ['latlon', 'Lat · lon'], ['utm', 'UTM'], ['mgrs', 'MGRS']] as [value, label] (value)}
          <button type="button" aria-pressed={(element.grid ?? 'none') === value} onclick={() => (element.grid = value)}>{label}</button>
        {/each}
      </div>
      {#if element.grid && element.grid !== 'none'}
        {@const style = element.grid_style ?? {}}
        <div class="rows">
          <span class="key">Every</span>
          <select aria-label="Grid step" value={String(style.step ?? '')}
            onchange={(event) => (element.grid_style = { ...style, step: event.currentTarget.value ? Number(event.currentTarget.value) : null })}>
            <option value="">As it fits</option>
            {#if element.grid === 'latlon'}
              {#each GRATICULE_STEPS as step (step)}<option value={String(step)}>{step >= 1 ? `${step}°` : `${Math.round(step * 60 * 100) / 100}′`}</option>{/each}
            {:else}
              {#each [100000, 50000, 10000, 5000, 1000, 500, 100] as step (step)}<option value={String(step)}>{step >= 1000 ? `${step / 1000} km` : `${step} m`}</option>{/each}
            {/if}
          </select>
          {#if element.grid === 'latlon'}
            <span class="key">Written</span>
            <div class="segments" role="group" aria-label="Grid labels">
              {#each [['dms', '48°51′N'], ['dd', '48.85°N']] as [value, label] (value)}
                <button type="button" aria-pressed={(style.format ?? 'dms') === value} onclick={() => (element.grid_style = { ...style, format: value })}>{label}</button>
              {/each}
            </div>
          {/if}
          <span class="key">Colour</span>
          <span class="colour"><input type="color" aria-label="Grid colour" value={style.colour ?? '#15181e'}
            oninput={(event) => (element.grid_style = { ...style, colour: event.currentTarget.value })} />
            {#if style.colour}<button type="button" class="text-act" onclick={() => (element.grid_style = { ...style, colour: null })}>Auto</button>{/if}</span>
        </div>
        <div class="checks">
          <label><input type="checkbox" checked={style.sides === 'four'} onchange={(event) => (element.grid_style = { ...style, sides: event.currentTarget.checked ? 'four' : 'two' })} /> Labels on all four sides</label>
          <label><input type="checkbox" checked={!!style.ticks} onchange={(event) => (element.grid_style = { ...style, ticks: event.currentTarget.checked })} /> Ticks on the frame only</label>
        </div>
      {/if}

      {#if element.basemap?.startsWith('plain')}
        {@const plain = element.plain ?? {}}
        <h4>The plain ground</h4>
        <div class="swatches">
          {#each PLAIN_COLOURS as [key, label] (key)}
            <label class="swatch" title={label}><input type="color" aria-label={`${label} colour`}
              value={plain.colours?.[key] ?? PALETTES[element.basemap === 'plain-dark' ? 'dark' : 'light'][key]}
              onchange={(event) => (element.plain = { ...plain, colours: { ...(plain.colours ?? {}), [key]: event.currentTarget.value } })} /><span>{label}</span></label>
          {/each}
          {#if Object.keys(plain.colours ?? {}).length}<button type="button" class="text-act" onclick={() => (element.plain = { ...plain, colours: {} })}>Reset</button>{/if}
        </div>
        <div class="checks">
          <label><input type="checkbox" checked={plain.roads !== false} onchange={(event) => (element.plain = { ...plain, roads: event.currentTarget.checked })} /> Roads</label>
          <label><input type="checkbox" checked={plain.buildings !== false} onchange={(event) => (element.plain = { ...plain, buildings: event.currentTarget.checked })} /> Buildings</label>
          <label><input type="checkbox" checked={plain.names !== false} onchange={(event) => (element.plain = { ...plain, names: event.currentTarget.checked })} /> Place names</label>
        </div>
        <div class="rows">
          <span class="key">Names in</span>
          <select aria-label="Place names language" value={plain.lang ?? 'latin'} onchange={(event) => (element.plain = { ...plain, lang: event.currentTarget.value })}>
            {#each LANGS as [value, label] (value)}<option {value}>{label}</option>{/each}
          </select>
          <span class="key">How many</span>
          <div class="segments" role="group" aria-label="Place names density">
            {#each [['low', 'Fewer'], ['normal', 'Usual'], ['high', 'More']] as [value, label] (value)}
              <button type="button" aria-pressed={(plain.density ?? 'normal') === value} onclick={() => (element.plain = { ...plain, density: value })}>{label}</button>
            {/each}
          </div>
          {#if (element.overlays ?? []).includes('relief')}
            <span class="key">Relief</span>
            <input type="range" aria-label="Relief strength" min="0.25" max="2" step="0.25" value={element.relief ?? 1} oninput={(event) => (element.relief = Number(event.currentTarget.value))} />
          {/if}
        </div>
      {:else}
        {@const tone = element.tone ?? {}}
        <h4>The imagery</h4>
        <div class="tools wide">
          {#each Object.entries(TONES) as [id, [label, values]] (id)}<button type="button" class="btn btn-xs" onclick={() => (element.tone = { ...values })}>{label}</button>{/each}
        </div>
        <div class="rows">
          {#each [['opacity', 'Strength', 0, 1, 0.05], ['saturation', 'Colour', -1, 1, 0.05], ['brightness', 'Light', 0.2, 1, 0.05], ['contrast', 'Contrast', -1, 1, 0.05], ['hue', 'Tint', 0, 360, 5]] as [key, label, min, max, step] (key)}
            <span class="key">{label}</span>
            <input type="range" aria-label={`Imagery ${label.toLowerCase()}`} {min} {max} {step} value={tone[key] ?? (key === 'opacity' || key === 'brightness' ? 1 : 0)}
              oninput={(event) => (element.tone = { ...tone, [key]: Number(event.currentTarget.value) })} />
          {/each}
        </div>
      {/if}
      <div class="checks">
        {#each OVERLAYS as [id, label] (id)}
          {#if id !== 'relief' || element.basemap?.startsWith('plain')}
            <label><input type="checkbox" checked={(element.overlays ?? []).includes(id)} onchange={() => toggleOverlay(id)} /> {label}</label>
          {/if}
        {/each}
      </div>

      <h4>Layers</h4>
      {#if !rows.length}<p class="note">The case has no map layers yet. Add some in the Map.</p>{/if}
      <ul class="layers">
        {#each [...(element.layers ?? []).map((entry) => rows.find((row) => row.name === entry.name)).filter(Boolean), ...rows.filter((row) => !(element.layers ?? []).some((entry) => entry.name === row.name))] as row (row.name)}
          {@const entry = (element.layers ?? []).find((item) => item.name === row.name)}
          <li>
            <div class="layer"><label><input type="checkbox" checked={!!entry} onchange={() => toggleLayer(row)} />
              <span class="name">{row.title}</span>{#if isTracked(row)}<Icon name="clock" size={11} />{/if}</label>
              {#if entry}
                <button type="button" class="icon-act small" aria-label={`Draw ${row.title} higher`} title="Draw it over the others" onclick={() => moveLayer(entry, -1)}><Icon name="chevronUp" size={11} /></button>
                <button type="button" class="icon-act small" aria-label={`Draw ${row.title} lower`} title="Draw it under the others" onclick={() => moveLayer(entry, 1)}><Icon name="chevronDown" size={11} /></button>
              {/if}
            </div>
            {#if entry}
              <div class="layer-set">
                <div class="groups">
                  {#each row.categories as group (group.name)}
                    <button type="button" class="chip" class:off={entry.hidden.includes(group.name)} title={entry.hidden.includes(group.name) ? 'Show on this plate' : 'Leave out of this plate'}
                      onclick={() => toggleGroup(entry, group.name)}>{group.name}</button>
                  {/each}
                </div>
                <label class="weight">Lines <input type="range" min="0.5" max="3" step="0.25" bind:value={entry.stroke} /> <span>{entry.stroke}×</span></label>
                <label class="weight">Marks <input type="range" min="0.5" max="3" step="0.25" value={entry.icons ?? 1} oninput={(event) => (entry.icons = Number(event.currentTarget.value))} /> <span>{entry.icons ?? 1}×</span></label>
                <div class="weight">Here in {#if !entry.colour}<span class="quiet">its own colours</span>{/if}</div>
                <PlateColour label={`${row.title} colour on this plate`} value={entry.colour ?? '#c8102e'} theme={spec.theme} none onpick={(hex) => (entry.colour = hex)} />
                <div class="segments thin" role="group" aria-label={`${row.title} lines on this plate`}>
                  {#each [['', 'Its lines'], ['dashed', 'Dashed'], ['dotted', 'Dotted']] as [value, label] (value)}
                    <button type="button" aria-pressed={(entry.dash ?? '') === value} onclick={() => (entry.dash = value)}>{label}</button>
                  {/each}
                </div>
                <button type="button" class="text-act" onclick={() => onlabels(element, row)}>Label its named features</button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {:else if element.kind === 'inset'}
      <div class="rows">
        <span class="key">Ground</span>
        <select aria-label="Ground" bind:value={element.basemap}>
          {#each grounds.filter(([id]) => id !== WAYBACK_ID) as [id, label] (id)}<option value={id}>{label}</option>{/each}
        </select>
        <span class="key">Zoom</span>
        <input type="number" aria-label="Inset zoom" step="0.5" min="0" max="18" placeholder="Auto" value={element.zoom ?? ''}
          onchange={(event) => (element.zoom = event.currentTarget.value === '' ? null : number(event.currentTarget.value, null))} />
        <span class="key">Of</span>
        <select aria-label="Inset of" bind:value={element.of}>{#each maps as map (map.id)}<option value={map.id}>{name(map)}</option>{/each}</select>
        <span class="key">Frame</span><input type="checkbox" aria-label="Inset frame" checked={element.border !== false} onchange={(event) => (element.border = event.currentTarget.checked)} />
      </div>
      <p class="note">The inset follows its map and outlines the ground it shows.</p>
    {:else if element.kind === 'legend'}
      <div class="rows">
        <span class="key">Title</span><input aria-label="Legend title" bind:value={element.text} placeholder="Legend" maxlength="120" />
        <span class="key">Of</span>
        <select aria-label="Legend of" bind:value={element.of}>{#each maps as map (map.id)}<option value={map.id}>{name(map)}</option>{/each}</select>
        <span class="key">Size</span><input type="number" aria-label="Text size" min="5" max="24" step="0.5" bind:value={element.size} />
        <span class="key">Columns</span><input type="number" aria-label="Columns" min="1" max="4" step="1" bind:value={element.columns} />
        <span class="key">Frame</span><input type="checkbox" aria-label="Legend frame" bind:checked={element.border} />
        <span class="key">Fill</span>
        <span class="colour"><input type="color" aria-label="Legend fill" value={element.fill ?? '#ffffff'} oninput={(event) => (element.fill = event.currentTarget.value)} />
          {#if element.fill}<button type="button" class="text-act" onclick={() => (element.fill = null)}>None</button>{/if}</span>
      </div>
      <label class="check"><input type="checkbox" bind:checked={element.offmap} /> List what the layers hold off the map too</label>
      <h4>Rows</h4>
      {#each rowsOf.filter((entry) => !entry.off) as entry (entry.key)}
        <div class="legend-row">
          <span class="dot" style:background={entry.colour}></span>
          <input class="rename" aria-label={`Name of ${entry.said}`} placeholder={entry.said} maxlength="200" value={element.names?.[entry.key] ?? ''}
            onchange={(event) => renameRow(entry.key, event.currentTarget.value)} />
          <button type="button" class="icon-act small" aria-label={`Move ${entry.said} up`} title="Up" onclick={() => moveLegendRow(entry.key, -1)}><Icon name="chevronUp" size={11} /></button>
          <button type="button" class="icon-act small" aria-label={`Move ${entry.said} down`} title="Down" onclick={() => moveLegendRow(entry.key, 1)}><Icon name="chevronDown" size={11} /></button>
          <button type="button" class="icon-act small" aria-label={`Remove ${entry.said}`} title="Remove the row"
            onclick={() => (entry.extra ? (element.extra = element.extra.filter((_, index) => `extra/${index}` !== entry.key)) : toggleRow(entry.key))}><Icon name="x" size={11} /></button>
        </div>
      {:else}
        <p class="note">What the map draws in its frame is listed here.</p>
      {/each}
      {#if rowsOf.some((entry) => entry.off)}
        <details class="removed">
          <summary>Removed ({rowsOf.filter((entry) => entry.off).length})</summary>
          {#each rowsOf.filter((entry) => entry.off) as entry (entry.key)}
            <div class="legend-row off">
              <span class="dot" style:background={entry.colour}></span><span class="gone">{entry.label}</span>
              <button type="button" class="text-act" onclick={() => toggleRow(entry.key)}>Put back</button>
            </div>
          {/each}
        </details>
      {/if}
      <button type="button" class="text-act" disabled={(element.extra ?? []).length >= 20}
        onclick={() => (element.extra = [...(element.extra ?? []), { label: 'New row', kind: 'line', colour: spec.theme.accent, symbol: 'pin' }])}>
        <Icon name="plus" size={11} /> A row by hand</button>
      {#each element.extra ?? [] as extra, index (index)}
        <div class="extra">
          <input aria-label="Row name" maxlength="200" bind:value={extra.label} />
          <select aria-label="Row mark" bind:value={extra.kind}><option value="point">Mark</option><option value="line">Line</option><option value="area">Area</option></select>
          <input type="color" aria-label="Row colour" bind:value={extra.colour} />
        </div>
      {/each}
    {:else if ['text', 'label', 'credits', 'key', 'table', 'qr', 'timeline'].includes(element.kind)}
      {#if element.kind === 'qr'}
        <div class="rows"><span class="key">Address</span><input aria-label="QR address" placeholder="https://…" maxlength="400" bind:value={element.text} /></div>
        <p class="note">A phone reads it straight from the print. About two hundred characters fit.</p>
      {:else if element.kind === 'table'}
        <div class="rows">
          <span class="key">Lists</span>
          <div class="segments" role="group" aria-label="Table lists">
            {#each [['events', 'Chronology'], ['sources', 'Sources']] as [value, label] (value)}
              <button type="button" aria-pressed={(element.source ?? 'events') === value} onclick={() => (element.source = value)}>{label}</button>
            {/each}
          </div>
          <span class="key">From</span>
          <select aria-label="Table layer" bind:value={element.layer}>
            <option value="">The main map's layers</option>
            {#each rows as row (row.name)}<option value={row.name}>{row.title}</option>{/each}
          </select>
          <span class="key">Rows</span><input type="number" aria-label="Table rows" min="1" max="60" step="1" bind:value={element.rows} />
          <span class="key">Title</span><input aria-label="Table title" placeholder={element.source === 'sources' ? 'Sources' : 'Chronology'} maxlength="120" bind:value={element.text} />
        </div>
        <p class="note">{element.source === 'sources' ? 'Each address the features cite, once.' : 'The dated features, oldest first; on a played plate, up to the day shown.'}</p>
      {:else if element.kind === 'key'}
        <div class="rows"><span class="key">Title</span><input aria-label="List title" placeholder="No title" maxlength="120" bind:value={element.text} /></div>
        <p class="note">Lists the numbered labels shown on the day, in their order.</p>
      {:else if element.kind === 'timeline'}
        <p class="note">The days the plate's followed layers change on, the one shown picked out. Made for the video.</p>
      {:else if element.kind !== 'credits'}
        <textarea aria-label="Text" rows={element.kind === 'label' ? 2 : 4} bind:value={element.text} maxlength="4000"
          oninput={() => { if (element.kind === 'label') element.box = labelBox(element, measure); }}></textarea>
        {#if element.kind === 'text'}<p class="note">{TOKENS.join(' ')} are filled in.</p>{/if}
      {:else}
        <p class="note">The map's sources, written for you. A plate always carries them, and they shrink rather than lose one.</p>
      {/if}
      <div class="rows">
        {#if element.kind !== 'qr'}
          <span class="key">Size</span><input type="number" aria-label="Text size" min="4" max="200" step="0.5" bind:value={element.size}
            oninput={() => { if (element.kind === 'label') element.box = labelBox(element, measure); }} />
          <span class="key">Font</span>
          <select aria-label="Element font" value={element.font ?? ''} onchange={(event) => { element.font = event.currentTarget.value || null; if (element.kind === 'label') element.box = labelBox(element, measure); }}>
            <option value="">The page's</option>
            {#each Object.entries(FONTS) as [id, font] (id)}<option value={id}>{font.label}</option>{/each}
          </select>
        {/if}
        {#if ['text', 'label'].includes(element.kind)}
          <span class="key">Weight</span>
          <div class="segments" role="group" aria-label="Weight">
            {#each [[400, 'Regular'], [600, 'Semi'], [700, 'Bold']] as [value, label] (value)}
              <button type="button" aria-pressed={(element.weight ?? (element.kind === 'label' ? 600 : 400)) === value} onclick={() => (element.weight = value)}>{label}</button>
            {/each}
          </div>
          <span class="key">Style</span>
          <div class="segments" role="group" aria-label="Text style">
            <button type="button" aria-pressed={!!element.italic} onclick={() => (element.italic = !element.italic)}><i>Italic</i></button>
            <button type="button" aria-pressed={!!element.upper} onclick={() => (element.upper = !element.upper)}>CAPS</button>
            <button type="button" aria-pressed={!!element.halo} onclick={() => (element.halo = !element.halo)} title="A halo round the letters, for a text over a map">Halo</button>
          </div>
          <span class="key">Spacing</span>
          <input type="range" aria-label="Letter spacing" min="-5" max="40" step="1" value={element.tracking ?? 0} oninput={(event) => (element.tracking = Number(event.currentTarget.value))} />
          <span class="key">Lines</span>
          <input type="range" aria-label="Line spacing" min="0.9" max="2.2" step="0.05" value={element.leading ?? 1.25} oninput={(event) => (element.leading = Number(event.currentTarget.value))} />
        {/if}
        {#if element.kind === 'text' || element.kind === 'credits'}
          <span class="key">Align</span>
          <div class="segments" role="group" aria-label="Align">
            {#each [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] as [value, label] (value)}
              <button type="button" aria-pressed={(element.align ?? 'left') === value} onclick={() => (element.align = value)}>{label}</button>
            {/each}
          </div>
        {/if}
        {#if element.kind === 'text'}
          <span class="key">Down</span>
          <div class="segments" role="group" aria-label="Vertical alignment">
            {#each [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']] as [value, label] (value)}
              <button type="button" aria-pressed={(element.valign ?? 'top') === value} onclick={() => (element.valign = value)}>{label}</button>
            {/each}
          </div>
        {/if}
        {#if element.kind === 'label'}
          <span class="key">Look</span>
          <div class="segments" role="group" aria-label="Label style">
            {#each [['plain', 'Plain'], ['bubble', 'Bubble'], ['box', 'Box'], ['number', 'Number']] as [value, label] (value)}
              <button type="button" aria-pressed={(element.style ?? 'plain') === value} onclick={() => { element.style = value; element.box = labelBox(element, measure); }}>{label}</button>
            {/each}
          </div>
          <span class="key">Leader</span>
          <select aria-label="Leader" bind:value={element.leader}>
            <option value="straight">Straight</option><option value="elbow">Elbowed</option><option value="curve">Curved</option><option value="none">None</option>
          </select>
          <span class="key">Its end</span>
          <select aria-label="Leader end" bind:value={element.end}>
            <option value="dot">A dot</option><option value="arrow">An arrow</option><option value="none">Nothing</option>
          </select>
        {/if}
        <span class="key">Colour</span>
        <PlateColour label="Text colour" value={element.colour ?? spec.theme.ink} theme={spec.theme} onpick={(hex) => (element.colour = hex)} />
        <span class="key">Fill</span>
        <PlateColour label="Fill colour" value={element.fill ?? '#ffffff'} theme={spec.theme} none onpick={(hex) => (element.fill = hex)} />
        {#if ['text', 'key', 'table'].includes(element.kind)}<span class="key">Frame</span><input type="checkbox" aria-label="Text frame" bind:checked={element.border} />{/if}
      </div>
      {#if element.ref}
        <p class="note">Shown when its feature is on the map. <button type="button" class="text-act" onclick={() => (element.ref = null)}>Always show it</button></p>
      {/if}
    {:else if element.kind === 'signature'}
      <textarea aria-label="Signature words" rows="2" bind:value={element.text} maxlength="400"></textarea>
      <p class="note">{signatureNote}</p>
      <div class="rows">
        <span class="key">Size</span><input type="number" aria-label="Text size" min="4" max="40" step="0.5" bind:value={element.size} />
        <span class="key">Picture</span>
        <div class="segments" role="group" aria-label="Signature side">
          {#each [['left', 'On the left'], ['right', 'On the right']] as [value, label] (value)}
            <button type="button" aria-pressed={(element.align ?? 'left') === value} onclick={() => (element.align = value)}>{label}</button>
          {/each}
        </div>
        <span class="key">Colour</span><PlateColour label="Signature colour" value={element.colour ?? spec.theme.ink} theme={spec.theme} onpick={(hex) => (element.colour = hex)} />
      </div>
    {:else if element.kind === 'brand'}
      <div class="rows">
        <span class="key">Before it</span><input aria-label="Words before the mark" maxlength="40" placeholder="Nothing" bind:value={element.text} />
        <span class="key">Colour</span><PlateColour label="Mark colour" value={element.colour ?? spec.theme.ink} theme={spec.theme} onpick={(hex) => (element.colour = hex)} />
        <span class="key">Align</span>
        <div class="segments" role="group" aria-label="Mark alignment">
          {#each [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] as [value, label] (value)}
            <button type="button" aria-pressed={(element.align ?? 'right') === value} onclick={() => (element.align = value)}>{label}</button>
          {/each}
        </div>
      </div>
      <p class="note">The mark grows with its box; its amber flank stays amber.</p>
    {:else if element.kind === 'scale'}
      <div class="rows">
        <span class="key">Units</span>
        <select aria-label="Scale units" bind:value={element.units}>
          <option value="auto">As in Settings ({prefs.units === 'imperial' ? 'miles' : 'kilometres'})</option>
          <option value="metric">Kilometres</option><option value="imperial">Miles</option><option value="both">Both</option>
        </select>
        <span class="key">Look</span>
        <div class="segments" role="group" aria-label="Scale look">
          {#each [['bar', 'Bar'], ['line', 'Line'], ['ticks', 'Ticks']] as [value, label] (value)}
            <button type="button" aria-pressed={(element.variant ?? 'bar') === value} onclick={() => (element.variant = value)}>{label}</button>
          {/each}
        </div>
        <span class="key">Size</span><input type="number" aria-label="Scale text size" min="4" max="30" step="0.5" value={element.size === 10 || !element.size ? 7 : element.size}
          onchange={(event) => (element.size = number(event.currentTarget.value, 7))} />
        <span class="key">Backing</span><input type="checkbox" aria-label="Scale backing" checked={!!element.fill}
          onchange={(event) => (element.fill = event.currentTarget.checked ? spec.theme.paper : null)} />
      </div>
      <p class="note">Measured at the map's centre.</p>
    {:else if element.kind === 'north'}
      <div class="rows">
        <span class="key">Look</span>
        <select aria-label="North arrow look" bind:value={element.variant}>
          <option value="arrow">Arrow</option><option value="simple">Simple</option><option value="star">Compass star</option><option value="letter">The letter N</option>
        </select>
        <span class="key">Backing</span><input type="checkbox" aria-label="North backing" checked={!!element.fill}
          onchange={(event) => (element.fill = event.currentTarget.checked ? spec.theme.paper : null)} />
      </div>
      <p class="note">Turns with its map.</p>
    {:else if element.kind === 'image'}
      <div class="tools wide">
        <button type="button" class="btn btn-xs" onclick={openPictures}><Icon name="image" size={12} /> From the case</button>
        <button type="button" class="btn btn-xs" onclick={() => fileInput?.click()}><Icon name="upload" size={12} /> From this computer</button>
        <button type="button" class="btn btn-xs" title="The badge set in Settings → Signature" onclick={() => { element.src = SIGNATURE; element.data = null; }}>Signature</button>
      </div>
      <input type="file" accept="image/png,image/jpeg,image/webp" hidden bind:this={fileInput}
        onchange={(event) => readPicture(event.currentTarget.files?.[0], (data) => { element.data = data; element.src = ''; })} />
      <p class="note">{element.data ? 'Kept inside the plate, so a template keeps it too.' : element.src === SIGNATURE ? 'Your signature, as set in Settings.' : element.src ? 'A picture of the case.' : 'No picture yet.'}</p>
      <div class="rows">
        <span class="key">Fit</span>
        <div class="segments" role="group" aria-label="Picture fit">
          {#each [['contain', 'Whole'], ['cover', 'Fill the box']] as [value, label] (value)}
            <button type="button" aria-pressed={(element.fit ?? 'contain') === value} onclick={() => (element.fit = value)}>{label}</button>
          {/each}
        </div>
        <span class="key">Frame</span><input type="checkbox" aria-label="Picture frame" bind:checked={element.border} />
        <span class="key">Points at</span>
        <span class="pair">
          {#if element.at}
            <select aria-label="Leader" bind:value={element.leader}><option value="straight">Straight</option><option value="elbow">Elbowed</option><option value="curve">Curved</option></select>
            <button type="button" class="text-act" onclick={() => { element.at = null; element.of = null; }}>Nothing</button>
          {:else}
            <button type="button" class="btn btn-xs" onclick={() => onpoint?.(element)}>A point of the map…</button>
          {/if}
        </span>
      </div>
    {:else if element.kind === 'video'}
      <div class="tools wide">
        <button type="button" class="btn btn-xs" onclick={openVideos}><Icon name="video" size={12} /> {element.src ? 'Another video' : 'Choose a video'}</button>
      </div>
      {#if element.src}
        <p class="note file" title={element.src}>{fileName(element.src)}</p>
        <!-- svelte-ignore a11y_media_has_caption -->
        <video class="trim" bind:this={trimVideo} src={fileUrl(caseId, element.src)} controls preload="metadata"
          onloadedmetadata={(event) => lengthKnown(event.currentTarget.duration)} ontimeupdate={trimTick}></video>
        <div class="tools wide">
          <button type="button" class="btn btn-xs" title="The clip starts where the player stands" onclick={() => setClip(trimVideo?.currentTime ?? 0, range[1])}>Start here</button>
          <button type="button" class="btn btn-xs" title="The clip ends where the player stands" onclick={() => setClip(range[0], trimVideo?.currentTime ?? range[1])}>End here</button>
          <button type="button" class="btn btn-xs" onclick={playClip}><Icon name="play" size={11} /> The clip</button>
        </div>
        <div class="rows">
          <span class="key">Start</span>
          <input aria-label="Clip start" value={timecode(range[0])}
            onchange={(event) => { const value = readTimecode(event.currentTarget.value); if (value !== null) setClip(value, range[1]); else event.currentTarget.value = timecode(range[0]); }} />
          <span class="key">End</span>
          <input aria-label="Clip end" value={timecode(range[1])}
            onchange={(event) => { const value = readTimecode(event.currentTarget.value); if (value !== null) setClip(range[0], value); else event.currentTarget.value = timecode(range[1]); }} />
          <span class="key">Runs</span><span>{timecode(range[1] - range[0])}{trimLength ? ` of ${timecode(trimLength)}` : ''}</span>
          <span class="key">Sound</span>
          <label class="check"><input type="checkbox" bind:checked={element.sound} /> <Icon name={element.sound ? 'volume' : 'volumeOff'} size={12} /> In the video</label>
          {#if element.sound}
            <span class="key">Volume</span><input type="range" aria-label="Volume" min="0" max="2" step="0.05" bind:value={element.volume} />
          {/if}
          <span class="key">Source</span>
          <label class="check"><input type="checkbox" bind:checked={element.caption} /> Said on the video</label>
          {#if element.caption}
            <span class="key">Line</span>
            <input aria-label="Source line" maxlength="200" placeholder="Who posted it, where, when" bind:value={element.text} />
            <span class="key">Size</span><input type="range" aria-label="Source line size" min="5" max="14" step="0.5" bind:value={element.size} />
          {/if}
        </div>
        {#if element.caption}<button type="button" class="text-act" onclick={readCaption}>Read the line from the file again</button>{/if}
      {/if}
      <div class="rows">
        <span class="key">Fit</span>
        <div class="segments" role="group" aria-label="Video fit">
          {#each [['contain', 'Whole'], ['cover', 'Fill the box']] as [value, label] (value)}
            <button type="button" aria-pressed={(element.fit ?? 'contain') === value} onclick={() => (element.fit = value)}>{label}</button>
          {/each}
        </div>
        <span class="key">Frame</span><input type="checkbox" aria-label="Video frame" bind:checked={element.border} />
        <span class="key">Points at</span>
        <span class="pair">
          {#if element.at}
            <select aria-label="Leader" bind:value={element.leader}><option value="straight">Straight</option><option value="elbow">Elbowed</option><option value="curve">Curved</option></select>
            <button type="button" class="text-act" onclick={() => { element.at = null; element.of = null; }}>Nothing</button>
          {:else}
            <button type="button" class="btn btn-xs" onclick={() => onpoint?.(element)}>A point of the map…</button>
          {/if}
        </span>
      </div>
      <p class="note">The step runs as long as the clip.</p>
    {:else if element.kind === 'shape'}
      <div class="rows">
        <span class="key">Shape</span>
        <div class="segments" role="group" aria-label="Shape">
          {#each [['rect', 'Box'], ['ellipse', 'Ellipse'], ['line', 'Rule']] as [value, label] (value)}
            <button type="button" aria-pressed={(element.shape === 'line' ? 'line' : element.shape ?? 'rect') === value} onclick={() => (element.shape = value)}>{label}</button>
          {/each}
        </div>
        <span class="key">Line</span>
        <PlateColour label="Line colour" value={element.colour ?? spec.theme.ink} theme={spec.theme} onpick={(hex) => (element.colour = hex)} />
        <span class="key">Weight</span>
        <input type="range" aria-label="Line weight" min="0.2" max="8" step="0.1" bind:value={element.width} />
        <span class="key">Dash</span>
        <select aria-label="Line dash" bind:value={element.line}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select>
        {#if element.shape !== 'line'}
          <span class="key">Fill</span>
          <PlateColour label="Shape fill" value={element.fill ?? '#ffffff'} theme={spec.theme} none onpick={(hex) => (element.fill = hex)} />
        {/if}
      </div>
    {:else if ['arrow', 'measure', 'ring', 'cone', 'zone'].includes(element.kind)}
      <div class="rows">
        <span class="key">Colour</span><PlateColour label="Colour" value={element.colour ?? spec.theme.accent} theme={spec.theme} onpick={(hex) => (element.colour = hex)} />
        <span class="key">Weight</span><input type="range" aria-label="Weight" min="0.3" max="6" step="0.1" bind:value={element.width} />
        {#if !(element.kind === 'arrow' && element.shape === 'offensive')}
          <span class="key">Dash</span>
          <select aria-label="Dash" value={element.line ?? (element.kind === 'measure' ? 'dashed' : 'solid')} onchange={(event) => (element.line = event.currentTarget.value)}>
            <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
          </select>
        {/if}
        {#if element.kind === 'arrow'}
          <span class="key">Kind</span>
          <div class="segments" role="group" aria-label="Arrow kind">
            {#each [['line', 'Line'], ['offensive', 'Advance']] as [value, label] (value)}
              <button type="button" aria-pressed={(element.shape === 'offensive' ? 'offensive' : 'line') === value} onclick={() => (element.shape = value)}>{label}</button>
            {/each}
          </div>
          <span class="key">Bend</span><input type="range" aria-label="Arrow bend" min="-1" max="1" step="0.05" bind:value={element.bend} />
          {#if element.shape !== 'offensive'}
            <span class="key">Heads</span>
            <select aria-label="Arrow heads" bind:value={element.heads}><option value="end">At its end</option><option value="both">At both ends</option><option value="none">None</option></select>
          {/if}
          <span class="key">Head</span><input type="range" aria-label="Head size" min="0.4" max="3" step="0.1" bind:value={element.head} />
        {/if}
        {#if element.kind === 'ring'}
          <span class="key">Rings, km</span>
          <input aria-label="Ring distances" value={(element.radii ?? []).join(', ')}
            onchange={(event) => (element.radii = event.currentTarget.value.split(/[,;\s]+/).map(Number).filter((value) => value > 0 && value <= 20000).slice(0, 8))} />
        {/if}
        {#if element.kind === 'cone'}
          <span class="key">Facing</span><input type="number" aria-label="Cone bearing" min="0" max="360" step="1" value={Math.round(element.bearing ?? 0)}
            onchange={(event) => (element.bearing = ((number(event.currentTarget.value, 0) % 360) + 360) % 360)} />
          <span class="key">Opening</span><input type="range" aria-label="Cone opening" min="5" max="360" step="5" bind:value={element.spread} />
          <span class="key">Reach, km</span><input type="number" aria-label="Cone reach" min="0.01" max="20000" step="0.1" bind:value={element.reach} />
        {/if}
        {#if ['ring', 'cone', 'zone'].includes(element.kind)}
          <span class="key">Look</span>
          <select aria-label="Look" bind:value={element.look}><option value="fill">Filled</option><option value="hatch">Hatched</option><option value="glow">Glowing</option><option value="outline">Outlined</option></select>
        {/if}
        {#if ['arrow', 'measure', 'zone'].includes(element.kind)}
          <span class="key">{element.kind === 'measure' ? 'Says' : 'Words'}</span>
          <input aria-label="Words" maxlength="200" placeholder={element.kind === 'measure' ? 'Its length, worked out' : 'None'} bind:value={element.text} />
        {/if}
      </div>
      {#if element.kind === 'zone'}
        <label class="check"><input type="checkbox" checked={!!element.mask?.on} onchange={(event) => (element.mask = { ...(element.mask ?? {}), on: event.currentTarget.checked })} />
          Dim the ground round it</label>
        {#if element.mask?.on}
          <label class="weight">Dim <input type="range" min="0.1" max="0.9" step="0.05" value={element.mask.darkness ?? 0.55}
            oninput={(event) => (element.mask = { ...element.mask, darkness: Number(event.currentTarget.value) })} /></label>
        {/if}
      {/if}
      <p class="note">Drag its points on the map, or the whole of it.</p>
    {/if}

    {#if !['map', 'inset', 'arrow', 'zone', 'ring', 'cone', 'measure', 'video'].includes(element.kind)}
      <div class="rows">
        <span class="key">Strength</span><input type="range" aria-label="Opacity" min="0.05" max="1" step="0.05" value={element.opacity ?? 1}
          oninput={(event) => (element.opacity = Number(event.currentTarget.value))} />
        <span class="key">Turned</span><input type="number" aria-label="Rotation" min="-180" max="180" step="1" value={element.rotate ?? 0}
          onchange={(event) => (element.rotate = Math.max(-180, Math.min(180, number(event.currentTarget.value, 0))))} />
      </div>
    {/if}
  {/if}
</aside>

{#if picking}
  <FloatingMenu anchor={pickAnchor} width={300} label="Pictures of the case" onclose={() => (picking = false)}>
    {#if featurePictures.length}
      <p class="fm-label">The proofs and footage on the map, pointing at their place</p>
      <div class="pictures">
        {#each featurePictures as item (item.key)}
          <button type="button" class="picture" title={item.title}
            onclick={() => { Object.assign(element, { src: item.path, data: null, at: item.at, of: item.of, leader: element.leader ?? 'straight' }); picking = false; }}>
            <img src={fileUrl(caseId, item.path)} alt={item.title} loading="lazy" />
          </button>
        {/each}
      </div>
      <p class="fm-label">Pictures of the case</p>
    {/if}
    <div class="pictures">
      {#each pictures as item (item.path)}
        <button type="button" class="picture" title={item.title || item.path}
          onclick={() => { element.src = item.path; element.data = null; picking = false; }}>
          <img src={fileUrl(caseId, item.thumbnail || item.path)} alt={item.title || ''} loading="lazy" />
        </button>
      {:else}
        <p class="note">No picture in this case yet.</p>
      {/each}
    </div>
  </FloatingMenu>
{/if}

{#if pickingVideo}
  <FloatingMenu anchor={pickAnchor} width={300} label="Videos of the case" onclose={() => (pickingVideo = false)}>
    {#if footage.length}
      <p class="fm-label">Footage placed on the map, pointing at its place</p>
      <div class="pictures">
        {#each footage as row (row.key)}
          <button type="button" class="picture" title={row.title} onclick={() => chooseVideo(row.path, [row.lon, row.lat])}>
            {#if row.thumbnail}<img src={fileUrl(caseId, row.thumbnail)} alt={row.title} loading="lazy" />{:else}<Icon name="video" size={16} />{/if}
          </button>
        {/each}
      </div>
      <p class="fm-label">Videos of the case</p>
    {/if}
    <div class="pictures">
      {#each videos as item (item.path)}
        <button type="button" class="picture" title={item.title || item.path} onclick={() => chooseVideo(item.path)}>
          {#if item.thumbnail}<img src={fileUrl(caseId, item.thumbnail)} alt={item.title || ''} loading="lazy" />{:else}<Icon name="video" size={16} />{/if}
        </button>
      {:else}
        <p class="note">No video in this case yet.</p>
      {/each}
    </div>
  </FloatingMenu>
{/if}

<style>
  .inspector { width: 284px; flex: none; overflow-y: auto; padding: 10px 12px 16px; border-left: 1px solid var(--border); background: var(--bg-1); font-size: var(--fs-xs); }
  header { display: flex; align-items: center; gap: 2px; margin-bottom: 6px; }
  h3 { flex: 1; margin: 0 0 8px; font-size: var(--fs-sm); }
  header h3 { margin: 0; }
  h4 { margin: 14px 0 6px; color: var(--text-3); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .rows { display: grid; grid-template-columns: 74px minmax(0, 1fr); align-items: center; gap: 7px 8px; margin: 8px 0; }
  .key { color: var(--text-3); font-size: 11px; }
  select, input[type='number'], input:not([type]), .rename, textarea, .element-name { width: 100%; min-width: 0; height: 26px; padding: 3px 6px; font-size: var(--fs-xs); border-radius: var(--r-sm); }
  .element-name { margin-bottom: 4px; }
  textarea { height: auto; resize: vertical; line-height: 1.4; }
  input[type='color'] { flex: none; width: 34px; height: 22px; padding: 0; border: 1px solid var(--border); border-radius: var(--r-sm); background: none; }
  input[type='range'] { width: 100%; min-width: 0; }
  .colour, .pair { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .pair input[type='number'] { width: 70px; }
  .rename { flex: 1; }
  .segments { display: flex; border: 1px solid var(--border); border-radius: var(--r-sm); overflow: hidden; background: var(--bg-1); }
  .segments button { flex: 1; min-width: 0; padding: 4px 3px; color: var(--text-2); font-size: 11px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .segments.thin button { padding: 2px; font-size: 10px; }
  .segments button + button { border-left: 1px solid var(--border); }
  .segments button[aria-pressed='true'] { background: var(--accent-soft); color: var(--text-1); font-weight: 600; }
  .checks { display: grid; gap: 4px; margin: 6px 0; }
  .checks label, .check { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .layers { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .layer { display: flex; align-items: center; gap: 2px; }
  .layer label { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; cursor: pointer; }
  .layer .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-1); }
  .layer-set { margin: 4px 0 4px 22px; display: grid; gap: 6px; }
  .groups { display: flex; flex-wrap: wrap; gap: 3px; }
  .chip { padding: 1px 7px; border: 1px solid var(--border); border-radius: 999px; background: var(--accent-soft); color: var(--text-1); font-size: 10.5px; cursor: pointer; }
  .chip.off { background: none; color: var(--text-3); text-decoration: line-through; }
  .weight { display: flex; align-items: center; gap: 6px; color: var(--text-3); font-size: 10.5px; }
  .weight input[type='range'] { flex: 1; }
  .quiet { color: var(--text-3); }
  .frame { width: 100%; justify-content: center; margin-bottom: 4px; }
  .frame.on { border-color: var(--accent); color: var(--accent); }
  .note { margin: 6px 0; color: var(--text-3); font-size: 10.5px; line-height: 1.45; }
  .warn { margin: 6px 0; padding: 5px 7px; border-radius: var(--r-sm); background: color-mix(in srgb, var(--warning, #f59e0b) 18%, transparent); color: var(--text-1); font-size: 10.5px; }
  .icon-act { display: grid; place-items: center; width: 24px; height: 24px; border-radius: var(--r-sm); color: var(--text-2); cursor: pointer; }
  .icon-act.small { width: 20px; height: 20px; }
  .icon-act:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
  .icon-act.danger:hover:not(:disabled) { color: var(--danger); }
  .icon-act:disabled { opacity: .35; cursor: default; }
  .text-act { display: inline-flex; align-items: center; gap: 3px; padding: 0; color: var(--text-2); font-size: 10.5px; text-align: left; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
  .text-act:hover { color: var(--text-1); }
  .tools { display: flex; flex-wrap: wrap; gap: 2px; margin: 4px 0; }
  .tools.wide { gap: 4px; }
  .btn.danger { color: var(--danger); }
  .themes { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
  .theme { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 4px 2px; border: 1px solid var(--border); border-radius: var(--r-sm);
    color: var(--text-2); font-size: 9.5px; cursor: pointer; }
  .theme.on, .theme:hover { border-color: var(--accent); color: var(--text-1); }
  .sample { display: grid; place-items: center; width: 100%; height: 22px; border-bottom: 3px solid; border-radius: 3px; font-weight: 700; font-size: 11px; }
  .swatches { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .swatch { display: flex; flex-direction: column; align-items: center; gap: 2px; color: var(--text-3); font-size: 9.5px; cursor: pointer; }
  .days { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 4px 6px; align-items: center; margin: 6px 0; padding: 6px; border: 1px solid var(--border); border-radius: var(--r-sm); }
  .days.off { border-color: var(--accent); }
  .days .pick, .days .wide { grid-column: 1 / -1; }
  .days .note { margin: 0; }
  .end { display: flex; align-items: center; gap: 5px; min-width: 0; height: 24px; padding: 0 6px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-1); font-size: var(--fs-xs); text-align: left; cursor: pointer; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .end :global(svg) { flex: none; color: var(--text-3); }
  .end:hover, .end.open { border-color: var(--accent); }
  .legend-row { display: flex; align-items: center; gap: 3px; margin-bottom: 3px; }
  .legend-row.off { color: var(--text-3); }
  .gone { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-decoration: line-through; }
  .removed { margin: 6px 0; }
  .removed summary { color: var(--text-3); font-size: 10.5px; cursor: pointer; }
  .dot { flex: none; width: 9px; height: 9px; border-radius: 50%; }
  .extra { display: grid; grid-template-columns: 1fr 64px 34px; gap: 4px; margin-top: 4px; }
  .fm-label { margin: 6px 6px 2px; color: var(--text-3); font-size: 10.5px; }
  .pictures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; padding: 4px; max-height: 320px; overflow-y: auto; }
  .picture { aspect-ratio: 1; padding: 0; border: 1px solid var(--border); border-radius: var(--r-sm); overflow: hidden; background: #000; cursor: pointer; }
  .picture:hover { border-color: var(--accent); }
  .picture img { width: 100%; height: 100%; object-fit: cover; }
  .picture { display: grid; place-items: center; color: var(--text-3); }
  .trim { width: 100%; max-height: 150px; margin: 4px 0; border-radius: var(--r-sm); background: #000; }
  .file { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
