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
  import { untrack } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import MonthGrid from '../../components/MonthGrid.svelte';
  import { api } from '../../lib/api.js';
  import { today as calendarToday } from '../../lib/calendar.js';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { buildMediaQuery } from '../../lib/mediaQuery.js';
  import { isTracked, momentLabel } from '../../lib/map/layerHistory.js';
  import { prefs, toast } from '../../lib/state.svelte.js';
  import { FONTS, KIND_LABELS, MAX_MAPS, PAGE, PAPERS, PLATE_OVERLAYS, SIGNATURE, THEMES, TOKENS, TOKEN_SAID, TOO_MANY_MAPS, bornOn, bringTo, dayOf, endOn, labelBox,
    mainMap, mapCount, pageSize, shownOn, startOn, textMeasurer, transitionsOf, turnable } from '../../lib/plate/page.js';
  import { FIRST_SECONDS, captionOf, clipRange, isGif, readTimecode, timecode } from '../../lib/plate/clip.js';
  import { GRATICULE_STEPS } from '../../lib/plate/geo.js';
  import { align, distribute, fittedHeight, sameSize } from '../../lib/plate/arrange.js';
  import { moveRow } from '../../lib/plate/legend.js';
  import { GROUNDS, PALETTES, groundPalette, readsHeights, topographic } from '../../lib/plate/plainBasemap.js';
  import { CLOUDLESS_ID, cloudlessYear } from '../../lib/plate/cloudless.js';
  import { PLATE_MAXCC, SENTINEL_ID } from '../../lib/plate/sentinelPass.js';
  import { DEFAULT_LAYER, cloudClass, cloudLabel, maxccLabel, monthGrid, monthLabel } from '../../lib/sentinel.js';
  import { createSentinelState } from '../satellite/state/sentinel.svelte.js';
  import SentinelPicker from '../satellite/SentinelPicker.svelte';
  import { ACCOUNT_STEPS } from '../../lib/copernicusSetup.js';
  import GroundSwatch from './GroundSwatch.svelte';
  import { TEXT_STYLES, styled } from '../../lib/plate/design.js';
  import { drawnOn } from '../../lib/plate/toLayer.js';
  import { ROLE_LIST, withRole } from '../../lib/plate/roles.js';
  import { countryNames } from '../../lib/plate/spotlight.js';
  import { WAYBACK_ID } from '../../lib/wayback.js';
  import { shrinkPicture } from '../../lib/plate/picture.js';
  import PlateColour from './PlateColour.svelte';
  import PlateSection from './PlateSection.svelte';
  import PlateWords from './PlateWords.svelte';
  import LayerStyleButton from '../satellite/LayerStyleButton.svelte';
  import { LAYER_HELP, STATUS_CHOICES } from '../../lib/map/layerHelp.js';
  import { PLATE_HELP, hoverHelp } from '../../lib/plate/plateHelp.js';

  let {
    /** The plate, which the inspector sets in place: bound, so the page and the inspector own it together. */
    spec = $bindable(),
    selection = [],
    caseId = '',
    rows = [],
    /** The basemaps a plate offers, `[id, label]`. */
    grounds = [],
    /** The Wayback releases, `{ release, date }`, newest first, once read. */
    releases = [],
    /** The years of Sentinel-2 cloudless, `{ year, licence, free }`, newest first. */
    years = [],
    /** The rows each legend shows now, by legend id. */
    legend = {},
    /** Each credit the plate owes, `{ text, owed }`: `owed` for what a ground's terms ask for. */
    creditList = [],
    /** The plate's day, and the days it changes on. */
    at = null,
    moments = [],
    /** The step shown (`placeOf`), and `{ id, name }` of it, or null on the day itself. */
    place = null,
    step = null,
    /** The elements whose words run past their box. */
    overflow = new Map(),
    framing = '',
    onpaper,
    ontheme,
    onremove,
    onduplicate,
    onorder,
    /** `(element, by)`: whether a step forward (1) or back (-1) can move it, among the rows the list shows. */
    canorder = () => true,
    onframe,
    onlabels,
    /** `(style)` once a symbol's marker, colour or size is set, which the next symbol placed takes. */
    onsymbol = null,
    onpoint,
    ongroup,
    onwayback,
    /** `(map)`: a new layer of the case, drawn on this map and opened for editing in the Map. */
    onnewlayer = null,
    /** `(map)`: what was drawn by hand on this map, made into a layer of the case. */
    onkeepdrawn = null,
    /** The pictures the main map's features carry (a proof's plate, a video's frame), each with its point. */
    featurePictures = [],
    /** How a map is framed on the day or step shown (`page.framingOf`), `(map, view)` to frame it, `(map, keep)` to hold the one before. */
    framingFor = (map) => ({ view: map.view, own: false, first: true }),
    onmapview = (map, view) => { map.view = view; },
    onkeep = null,
    /** The plate plays: through days followed over time, or through steps. */
    plays = false,
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

  const PLAIN_COLOURS = [['ground', 'Land'], ['water', 'Water'], ['wood', 'Woods'], ['urban', 'Towns'], ['road', 'Roads'], ['border', 'Borders'], ['name', 'Names']];
  const GRIDS = [['none', 'None'], ['latlon', 'Lat · lon'], ['utm', 'UTM'], ['mgrs', 'MGRS']];
  const LANGS = [['latin', 'Latin letters'], ['local', 'As written there'], ['en', 'English'], ['fr', 'French'], ['ar', 'Arabic'], ['ru', 'Russian'], ['uk', 'Ukrainian']];
  const TONES = { none: ['As it is', { opacity: 1, saturation: 0, brightness: 1, contrast: 0, hue: 0 }],
    grey: ['Greyed', { opacity: 1, saturation: -0.85, brightness: 0.9, contrast: 0.05, hue: 0 }],
    faded: ['Faded', { opacity: 0.55, saturation: -0.4, brightness: 1, contrast: -0.1, hue: 0 }],
    dark: ['Darkened', { opacity: 1, saturation: -0.5, brightness: 0.55, contrast: 0.1, hue: 0 }],
    muted: ['Muted', { opacity: 1, saturation: -0.6, brightness: 0.82, contrast: 0.12, hue: 0 }] };
  /** Whether the fine colours of a plain ground are shown, folded until asked. */
  let colouring = $state(false);
  /** The text's field, and a word put where its cursor is, or at its end. */
  let words = $state(null);
  function putToken(token) {
    const text = element.text ?? '';
    const [from, to] = words && document.activeElement === words ? [words.selectionStart, words.selectionEnd] : [text.length, text.length];
    element.text = `${text.slice(0, from)}${token}${text.slice(to)}`;
    queueMicrotask(() => { words?.focus(); words?.setSelectionRange(from + token.length, from + token.length); });
  }
  /** Sets the ground a map is drawn on, and reads what a dated one offers. */
  function setGround(id) {
    element.basemap = id;
    if (id === WAYBACK_ID) onwayback?.();
  }

  /**
   * Satellite's own Sentinel-2 choices (`state/sentinel.svelte.js`), for the map picked:
   * its layer, its cloud ceiling and its pass, picked on the same calendar over the
   * map's middle. What is picked is written into the map; another map picked reads its own.
   */
  const s2 = createSentinelState({
    place: () => { const { lat, lon } = framingFor(element).view; return { lat, lon }; },
    onBilled: () => {},
    notify: toast,
    api,
  });
  let s2MenuEl = $state();
  /** The map the choices were last read from. */
  let s2For = '';
  /** Natural Earth's countries, read the first time a focus's list is opened. */
  let world = $state.raw(null);
  async function readWorld() {
    if (!world) world = (await import('../../lib/plate/world.json')).default;
    return world;
  }

  /** Whether the steps to a Copernicus account are shown under the locked Sentinel-2 ground. */
  let copernicusShown = $state(false);
  // a map on Sentinel-2 picked: the choices read from it, its pass pinned as the day it holds
  $effect(() => {
    const target = element;
    if (target?.basemap !== SENTINEL_ID || s2For === target.id) return;
    s2For = target.id;
    untrack(() => {
      s2.layer = target.product || DEFAULT_LAYER;
      s2.setMaxcc(target.maxcc ?? PLATE_MAXCC);
      s2.date = target.acquired ?? '';
    });
  });
  // "Most recent", or a map set on Sentinel-2 just now with no pass yet, here or from its bar: the newest
  // pass under the ceiling is looked for, a request or two the analyst's choice asks for
  $effect(() => {
    const [date, maxcc] = [s2.date, s2.maxcc];
    if (element?.basemap !== SENTINEL_ID || s2For !== element.id || date) return;
    void maxcc;
    untrack(() => s2.resolveLatest());
  });
  $effect(() => { if (element?.basemap !== SENTINEL_ID) s2For = ''; });
  // what is picked on the calendar is the map's: one day, its layer, its ceiling
  $effect(() => {
    const target = element;
    const [day, layer, maxcc] = [s2.day, s2.layer, s2.maxcc];
    if (target?.basemap !== SENTINEL_ID || s2For !== target.id) return;
    untrack(() => {
      if (day && target.acquired !== day) target.acquired = day;
      const product = layer === DEFAULT_LAYER ? '' : layer;
      if ((target.product ?? '') !== product) target.product = product;
      if ((target.maxcc ?? null) !== maxcc) target.maxcc = maxcc;
    });
  });
  // the calendar closes on a press anywhere else, as on Satellite's map
  $effect(() => {
    if (!s2.menuOpen) return;
    const away = (event) => { if (s2MenuEl && !s2MenuEl.contains(event.target)) s2.menuOpen = false; };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  });
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
  /** The box grown to what it writes: a text or a label by its words, a list by the height its rows need. */
  function fitBox() {
    const height = overflow.get(element.id) ?? fittedHeight(element, measure);
    element.box = [element.box[0], element.box[1], element.box[2], Math.max(4, height)];
  }
  const fits = (item) => item.kind === 'text' || item.kind === 'label' || overflow.get(item.id) != null;
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
      // a GIF plays as a video does, round and round for as long as its clip runs
      const [page, pictures, located] = await Promise.all([api.get(buildMediaQuery(caseId, { kind: 'video', limit: 120 })),
        api.get(buildMediaQuery(caseId, { kind: 'image', limit: 200 })).catch(() => ({ items: [] })),
        api.get(`/api/cases/${caseId}/satellite/media`).catch(() => [])]);
      videos = [...(page.items ?? []), ...(pictures.items ?? []).filter((item) => isGif(item.path))];
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
  /** The plate's day as a button says it: "on 14 Oct 2026". */
  const onDay = $derived(at ? `on ${momentLabel(at)}` : 'on the page');
  const dayName = (day) => (day === PAGE ? 'The page' : momentLabel(day));
  /** No day after today, nor after the plate's own, which is today on its layers' clock at most. */
  const lastDay = $derived([calendarToday(), (at ?? '').slice(0, 10)].sort().at(-1));
  /** Which end of the annotation's days has its calendar open: `onward`, `until`, or neither. */
  let ending = $state('');
  $effect(() => { void element?.id; ending = ''; });
  function setEnd(day) {
    Object.assign(element, ending === 'onward' ? startOn(element, day) : endOn(element, day));
    ending = '';
  }
  const endDay = $derived(((ending === 'onward' ? element?.onward : element?.until) || at || '').slice(0, 10).replace(PAGE, '')
    || lastDay);
  /** What the signature is made of, said where it is set, and where to set what is missing. */
  const signatureNote = $derived(prefs.signatureHandle
    ? `{handle} is ${prefs.signatureHandle}; the picture is the one in Settings → Publishing → Signature, when there is one.`
    : 'Set your handle and your picture in Settings → Publishing → Signature; {handle} and {today} are filled in.');
</script>

<!-- every setting says what it does under the pointer (`lib/plate/plateHelp.js`) -->
<aside class="inspector" aria-label="Plate inspector" use:hoverHelp>
  <div class="flow">
  {#if alertText}<p class="warn" role="alert">{alertText} <button type="button" class="text-act" onclick={() => (alertText = '')}>OK</button></p>{/if}
  {#if !picked.length}
    <h3>Page</h3>
    <PlateSection title="Looks" summary={THEMES[spec.theme.preset]?.label ?? 'Own colours'}>
    <div class="themes" data-guide="plate.looks">
      {#each Object.entries(THEMES) as [id, preset] (id)}
        <button type="button" class="theme" class:on={spec.theme.preset === id} onclick={() => theme(id)} title={`Set the page and its maps as ${preset.label}`}>
          <span class="sample" style:background={preset.theme.paper} style:color={preset.theme.ink} style:border-color={preset.theme.accent}>
            <GroundSwatch id={preset.ground} width={30} height={20} /><b>Aa</b><i style:background={preset.theme.accent}></i></span>
          <span>{preset.label}</span></button>
      {/each}
    </div>
    </PlateSection>
    <PlateSection title="Paper" summary={PAPERS[spec.page.paper]?.label ?? ''}>
    <div class="rows">
      <span class="key">Size</span>
      <select aria-label="Paper" value={spec.page.paper}
        onchange={(event) => { const paper = event.currentTarget.value; onpaper({ ...spec.page, paper, ...(paper === 'custom' ? { size: [pageSize(spec.page).width, pageSize(spec.page).height] } : {}) }); }}>
        {#each Object.entries(PAPERS) as [id, paper] (id)}<option value={id}>{paper.label}</option>{/each}
      </select>
      {#if spec.page.paper === 'custom'}
        <span class="key" title={PLATE_HELP['key:Size, mm']}>Size, mm</span>
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
      <span class="key">Fill</span>
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
        <span class="pair"><button type="button" class="btn btn-xs" title="A picture from this computer, kept inside the plate" onclick={() => backgroundInput?.click()}>{spec.page.background.data ? 'Another' : 'Choose…'}</button>
          {#if spec.page.background.data}<button type="button" class="text-act" onclick={() => (spec.page.background.data = null)}>Remove</button>{/if}</span>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden bind:this={backgroundInput}
          onchange={(event) => readPicture(event.currentTarget.files?.[0], (data) => (spec.page.background.data = data))} />
      {/if}
    </div>
    <div class="checks">
      <label><input type="checkbox" bind:checked={spec.page.frame} /> A rule round the page</label>
      <label><input type="checkbox" bind:checked={spec.page.guides} /> Show the margins and the feed crop</label>
      <label><input type="checkbox" bind:checked={spec.page.transparent} /> See-through paper in a PNG</label>
    </div>
    <div class="rows">
      <span class="key">Grain</span>
      <span class="pair"><input type="range" aria-label="Paper grain" min="0" max="1" step="0.05" value={spec.page.grain ?? 0}
        oninput={(event) => (spec.page.grain = Number(event.currentTarget.value))} />
        <span class="quiet">{spec.page.grain ? `${Math.round(spec.page.grain * 100)}%` : 'None'}</span></span>
    </div>
    </PlateSection>
    <PlateSection title="Face and colours" summary={FONTS[spec.theme.font]?.label ?? ''}>
    <div class="rows">
      <span class="key">Font</span>
      <select aria-label="Font" bind:value={spec.theme.font}>
        {#each Object.entries(FONTS) as [id, font] (id)}<option value={id}>{font.label}</option>{/each}
      </select>
      <span class="key" title={PLATE_HELP['key:Colours']}>Colours</span>
      <div class="swatches">
        <label class="swatch"><input type="color" aria-label="Paper colour" bind:value={spec.theme.paper} /><span>Paper</span></label>
        <label class="swatch"><input type="color" aria-label="Ink colour" bind:value={spec.theme.ink} /><span>Ink</span></label>
        <label class="swatch"><input type="color" aria-label="Accent colour" bind:value={spec.theme.accent} /><span>Accent</span></label>
      </div>
    </div>
    </PlateSection>
    {#if plays}
      {@const moves = transitionsOf(spec)}
      <PlateSection title="Video transitions" summary={moves.on ? `${moves.seconds.toFixed(1)} s` : 'Off'}>
      <label class="check"><input type="checkbox" checked={moves.on} onchange={(event) => (spec.transitions = { ...moves, on: event.currentTarget.checked })} />
        Between the days and the steps</label>
      {#if moves.on}
        <div class="rows">
          <span class="key">Length</span>
          <span class="pair"><input type="range" aria-label="Transition length" min="0.2" max="3" step="0.1" value={moves.seconds}
            oninput={(event) => (spec.transitions = { ...moves, seconds: Number(event.currentTarget.value) })} /><span class="quiet">{moves.seconds.toFixed(1)} s</span></span>
          <span class="key">What is new</span>
          <div class="segments" role="group" aria-label="What is new on a day or a step">
            {#each [['fade', 'Fades in'], ['draw', 'Is drawn'], ['none', 'At once']] as [value, label] (value)}
              <button type="button" aria-pressed={moves.appear === value} onclick={() => (spec.transitions = { ...moves, appear: value })}>{label}</button>
            {/each}
          </div>
        </div>
        <div class="checks">
          <label><input type="checkbox" checked={moves.fade} onchange={(event) => (spec.transitions = { ...moves, fade: event.currentTarget.checked })} /> The page fades into the next</label>
          <label><input type="checkbox" checked={moves.move} onchange={(event) => (spec.transitions = { ...moves, move: event.currentTarget.checked })} /> A map framed otherwise moves there</label>
          {#if moves.move}
            <label class="sub"><input type="checkbox" checked={moves.blur} onchange={(event) => (spec.transitions = { ...moves, blur: event.currentTarget.checked })} /> Blurred as it moves</label>
          {/if}
        </div>
        <p class="note">In the MP4. A step can still cut straight in, from its ⋯.</p>
      {/if}
      </PlateSection>
    {/if}
    <p class="note">Pick an element on the page to set it, Shift to pick several. A drag inside a map moves its ground; its edge moves the frame.</p>
    <p class="note">A text fills in words such as {'{date}'} and {'{case}'}; pick one to see them all.</p>
  {:else if picked.length > 1}
    <h3>{picked.length} picked</h3>
    <PlateSection title="Line up">
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
    </PlateSection>
    <PlateSection title="Size">
    <div class="tools wide">
      <button type="button" class="btn btn-xs" title="Each as wide as the one picked last" onclick={() => setBoxes(sameSize(picked, 'width', picked.at(-1)))}>Same width</button>
      <button type="button" class="btn btn-xs" title="Each as tall as the one picked last" onclick={() => setBoxes(sameSize(picked, 'height', picked.at(-1)))}>Same height</button>
    </div>
    <p class="note">They take the size of the one picked last.</p>
    </PlateSection>
    <PlateSection title="Together">
    <div class="tools wide">
      <button type="button" class="btn btn-xs" title="Picked and moved as one from now on (Ctrl+G)" onclick={() => ongroup?.(true)}><Icon name="layers" size={12} /> Group</button>
      <button type="button" class="btn btn-xs" title="Each picked on its own again (Ctrl+Shift+G)" onclick={() => ongroup?.(false)}>Ungroup</button>
      <button type="button" class="btn btn-xs" title="Kept where they are, or free to move again" onclick={() => { const lock = !picked.every((item) => item.locked); for (const item of picked) item.locked = lock; }}>
        <Icon name="lock" size={12} /> {picked.every((item) => item.locked) ? 'Unlock' : 'Lock'}</button>
      <button type="button" class="btn btn-xs danger" title="Take them all off the page" onclick={() => { for (const item of [...picked]) onremove(item); }}><Icon name="trash" size={12} /> Remove</button>
    </div>
    <p class="note">A group is picked and moved as one. Ctrl+G groups, Ctrl+Shift+G ungroups.</p>
    </PlateSection>
  {:else}
    <header>
      <h3>{element.kind === 'label' && element.leader === 'none' ? 'Text on the map' : KIND_LABELS[element.kind]}{#if element.kind === 'map' && element.of}{' (detail)'}{/if}{#if element.kind === 'map' && (element.terrain ?? 0) > 0}{' in 3D'}{/if}</h3>
      <button type="button" class="icon-act" aria-label="Bring forward" title="Bring forward"
        disabled={!canorder(element, 1)} onclick={() => onorder(element, 1)}><Icon name="chevronUp" size={13} /></button>
      <button type="button" class="icon-act" aria-label="Send back" title="Send back"
        disabled={!canorder(element, -1)} onclick={() => onorder(element, -1)}><Icon name="chevronDown" size={13} /></button>
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

    {#if !element.step && playable && ['label', 'symbol', 'arrow', 'ring', 'cone', 'zone', 'measure', 'line', 'shape', 'text', 'image', 'focus'].includes(element.kind)}
      <div class="days" class:off={!shownToday}>
        <span class="key">Shown from</span>
        <button type="button" class="end" class:open={ending === 'onward'} aria-expanded={ending === 'onward'} aria-label="First day shown"
          onclick={() => (ending = ending === 'onward' ? '' : 'onward')}><Icon name="calendar" size={12} />{element.onward ? dayName(element.onward) : 'The start'}</button>
        <span class="key">to</span>
        <button type="button" class="end" class:open={ending === 'until'} aria-expanded={ending === 'until'} aria-label="Last day shown"
          onclick={() => (ending = ending === 'until' ? '' : 'until')}><Icon name="calendar" size={12} />{element.until ? dayName(element.until) : 'The end'}</button>
        {#if ending}
          <div class="pick">
            <div class="tools wide">
              {#if ending === 'onward'}<button type="button" class="btn btn-xs" title="Shown from the plate's first day" onclick={() => setEnd('')}>The start</button>{/if}
              {#if at}
                <button type="button" class="btn btn-xs" title={`${momentLabel(at)}, the plate's day`} onclick={() => setEnd(dayOf(at))}>This day</button>
              {/if}
              {#if ending === 'until'}<button type="button" class="btn btn-xs" title="Shown on every day after its first" onclick={() => setEnd('')}>The end</button>{/if}
            </div>
            <MonthGrid value={endDay} max={lastDay} label={ending === 'onward' ? 'First day shown' : 'Last day shown'} onpick={setEnd} />
          </div>
        {/if}
        {#if !shownToday}
          <p class="note wide">Not on the plate's day. <button type="button" class="text-act" onclick={() => Object.assign(element, bringTo(element, at))}>Show it {onDay}</button></p>
        {/if}
      </div>
    {/if}

    {#if overflow.has(element.id)}
      <p class="warn">{['legend', 'table', 'key'].includes(element.kind) ? 'The rows run past the box.' : 'The words run past the box.'}
        {#if fits(element)}<button type="button" class="text-act" onclick={fitBox}>Fit the box</button>{/if}</p>
    {/if}

    {#if element.kind === 'map'}
      {@const framed = framingFor(element)}
      {@const held = !framed.own && !framed.first}
      {#if !framed.first}
        <label class="check keep"><input type="checkbox" checked={held} onchange={(event) => onkeep?.(element, event.currentTarget.checked)} />
          Keep the previous framing</label>
        <p class="note">{held ? 'This day or step shows the map as the one before it does.' : 'Framed here on its own; the steps after it follow, unless they frame it too.'}</p>
      {/if}
      <button type="button" class="btn btn-sm frame" class:on={framing === element.id} disabled={held}
        title={framing === element.id ? 'Stop framing the map' : 'Pan, zoom and turn the map by the hand'} onclick={() => onframe(element)}>
        <Icon name="move" size={12} /> {framing === element.id ? 'Done framing' : 'Frame the map'}</button>
      <div class="rows">
        {#if element.of}
          <span class="key">Detail of</span>
          <select aria-label="Detail of" bind:value={element.of}>{#each maps.filter((map) => map.id !== element.id) as map (map.id)}<option value={map.id}>{name(map)}</option>{/each}</select>
        {/if}
        <span class="key">Zoom</span>
        <input type="number" aria-label="Zoom" step="0.1" min="0" max="22" value={framed.view.zoom.toFixed(2)} disabled={held}
          onchange={(event) => onmapview(element, { ...framed.view, zoom: Math.min(22, Math.max(0, number(event.currentTarget.value, framed.view.zoom))) })} />
        <span class="key">Turned</span>
        <input type="number" aria-label="Bearing" step="1" min="-180" max="180" value={Math.round(framed.view.bearing ?? 0)} disabled={held}
          onchange={(event) => onmapview(element, { ...framed.view, bearing: number(event.currentTarget.value, 0) % 360 })} />
        <span class="key">Frame</span>
        <span class="pair"><input type="checkbox" aria-label="Map frame" checked={element.border !== false} onchange={(event) => (element.border = event.currentTarget.checked)} />
          <input type="range" aria-label="Frame weight" min="0.5" max="4" step="0.25" value={element.width ?? 1} oninput={(event) => (element.width = Number(event.currentTarget.value))} /></span>
      </div>

      <PlateSection title="Ground" summary={grounds.find(([id]) => id === element.basemap)?.[1] ?? ''}>
      <div class="grounds" role="radiogroup" aria-label="Ground">
        {#each grounds as [id, label] (id)}
          <button type="button" class="ground-tile" role="radio" aria-checked={element.basemap === id} title={label}
            onclick={() => setGround(id)}><GroundSwatch {id} width={58} height={38} /><span>{label}</span></button>
        {/each}
        {#if !grounds.some(([id]) => id === SENTINEL_ID)}
          <button type="button" class="ground-tile locked" aria-expanded={copernicusShown} title="Needs a free Copernicus account"
            onclick={() => (copernicusShown = !copernicusShown)}><GroundSwatch id={SENTINEL_ID} width={58} height={38} />
            <span><Icon name="lock" size={10} /> Sentinel-2, one dated pass</span></button>
        {/if}
      </div>
      {#if copernicusShown && !grounds.some(([id]) => id === SENTINEL_ID)}
        <p class="note">Sentinel-2's dated passes need a Copernicus account, free and with no card:</p>
        <ol class="setup">{#each ACCOUNT_STEPS as line (line)}<li>{line}</li>{/each}</ol>
      {/if}
      {#if element.basemap === WAYBACK_ID}
        <div class="rows">
          <span class="key">Release</span>
          <select aria-label="Wayback release" value={String(element.release ?? '')}
            onchange={(event) => (element.release = event.currentTarget.value ? Number(event.currentTarget.value) : null)}>
            <option value="">Newest</option>
            {#each releases as entry (entry.release)}<option value={String(entry.release)}>{entry.date}</option>{/each}
          </select>
        </div>
      {:else if element.basemap === CLOUDLESS_ID}
        {@const shown = cloudlessYear(element, years)}
        <div class="rows">
          <span class="key">Year</span>
          <select aria-label="Cloudless year" value={String(element.year ?? '')}
            onchange={(event) => (element.year = event.currentTarget.value ? Number(event.currentTarget.value) : null)}>
            <option value="">Newest</option>
            {#each years as entry (entry.year)}<option value={String(entry.year)}>{entry.year}{entry.free ? ', free for any use' : ''}</option>{/each}
          </select>
        </div>
        <p class="note">One cloud-free picture of that year, made of many passes: it holds no single date.</p>
        {#if shown}<p class="note">{shown.free ? 'Free for any use, with its credit.' : 'Free for non-commercial use only, with its credit. 2016 is free for any use.'}</p>{/if}
      {:else if element.basemap === SENTINEL_ID}
        <div class="rows s2">
          <span class="key">Pass</span>
          <span class="s2-pick"><SentinelPicker bind:menuEl={s2MenuEl} {s2} {maxccLabel} {monthLabel} {monthGrid} {cloudClass} {cloudLabel} /></span>
        </div>
        <p class="note">{s2.latestBusy && !element.acquired ? 'Looking for the newest pass…' : !element.acquired ? 'No pass picked yet.'
          : `${s2.layerLabel}, the pass of ${element.acquired}${s2.date ? '' : s2.maxcc < 100 ? `, the newest under ${s2.maxcc}% cloud` : ', the newest'}.`}</p>
        <p class="note">One pass at 10 m a pixel, empty where it did not reach, its tiles spending your Copernicus quota.</p>
      {/if}
      </PlateSection>

      <PlateSection title="3D" summary={(element.terrain ?? 0) > 0 ? `Tilted ${Math.round(framed.view.pitch ?? 0)}°` : 'Flat'}>
      <label class="check"><input type="checkbox" checked={(element.terrain ?? 0) > 0}
        onchange={(event) => { const on = event.currentTarget.checked; element.terrain = on ? 1.5 : 0;
          onmapview(element, { ...framed.view, pitch: on ? Math.max(framed.view.pitch ?? 0, 55) : 0 }); if (!on) element.ridges = false; }} />
        Show the map in 3D</label>
      {#if (element.terrain ?? 0) > 0}
        <div class="rows">
          <span class="key">Tilt</span>
          <input type="range" aria-label="Map tilt" min="0" max="85" step="1" value={framed.view.pitch ?? 0} disabled={held}
            oninput={(event) => onmapview(element, { ...framed.view, pitch: Number(event.currentTarget.value) })} />
          <span class="key">Heights</span>
          <span class="pair"><input type="range" aria-label="Height exaggeration" min="1" max="3" step="0.25" bind:value={element.terrain} />
            <span class="quiet">{element.terrain}×</span></span>
        </div>
        <label class="check"><input type="checkbox" bind:checked={element.ridges} /> Ridge lines</label>
        <p class="note">{element.terrain > 1 ? `The heights are drawn ${element.terrain} times as tall as they are, to read the slopes.` : 'The heights as they are.'}</p>
        <p class="note">A tilted map has no scale bar and no grid.</p>
      {/if}
      </PlateSection>

      <PlateSection title="Grid" summary={GRIDS.find(([value]) => value === (element.grid ?? 'none'))?.[1] ?? ''}>
      <div class="segments" role="group" aria-label="Grid">
        {#each GRIDS as [value, label] (value)}
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
      </PlateSection>

      <PlateSection title={element.basemap?.startsWith('plain') ? 'The plain ground' : 'The imagery'}>
      {#if element.basemap?.startsWith('plain')}
        {@const plain = element.plain ?? {}}
        <div class="rows">
          <span class="key">Detail</span>
          <div class="segments" role="group" aria-label="Ground detail">
            {#each [['low', 'Less'], ['normal', 'Usual'], ['high', 'More']] as [value, label] (value)}
              <button type="button" aria-pressed={(plain.density ?? 'normal') === value} onclick={() => (element.plain = { ...plain, density: value })}>{label}</button>
            {/each}
          </div>
          <span class="key">Presence</span>
          <input type="range" aria-label="Ground presence" min="0.2" max="1" step="0.05" value={plain.presence ?? 1}
            oninput={(event) => (element.plain = { ...plain, presence: Number(event.currentTarget.value) })} />
          {#if readsHeights(element.basemap, element.overlays ?? [])}
            <span class="key">Relief</span>
            <input type="range" aria-label="Relief strength" min="0.25" max="2" step="0.25" value={element.relief ?? 1} oninput={(event) => (element.relief = Number(event.currentTarget.value))} />
          {/if}
          <span class="key">Names in</span>
          <select aria-label="Place names language" value={plain.lang ?? 'latin'} onchange={(event) => (element.plain = { ...plain, lang: event.currentTarget.value })}>
            {#each LANGS as [value, label] (value)}<option {value}>{label}</option>{/each}
          </select>
        </div>
        {#if plain.hidden_names?.length}
          <p class="note hidden-names">Hidden: {plain.hidden_names.join(', ')}. <button type="button" class="text-act"
            onclick={() => (element.plain = { ...plain, hidden_names: [] })}>Show them again</button></p>
        {:else}
          <p class="note">Framed, a click on a name hides it or makes it a label to move.</p>
        {/if}
        <button type="button" class="text-act" aria-expanded={colouring} onclick={() => (colouring = !colouring)}>
          {colouring ? 'Hide the colours' : 'Change the colours'}{Object.keys(plain.colours ?? {}).length ? ' · changed' : ''}</button>
        {#if colouring}
          <div class="swatches">
            {#each PLAIN_COLOURS as [key, label] (key)}
              <label class="swatch" title={label}><input type="color" aria-label={`${label} colour`}
                value={plain.colours?.[key] ?? PALETTES[groundPalette(element.basemap)][key]}
                onchange={(event) => (element.plain = { ...plain, colours: { ...(plain.colours ?? {}), [key]: event.currentTarget.value } })} /><span>{label}</span></label>
            {/each}
            {#if Object.keys(plain.colours ?? {}).length}<button type="button" class="text-act" onclick={() => (element.plain = { ...plain, colours: {} })}>Reset</button>{/if}
          </div>
        {/if}
        <div class="checks">
          {#if GROUNDS[element.basemap]?.tints}
            <label><input type="checkbox" checked={plain.tints !== false} onchange={(event) => (element.plain = { ...plain, tints: event.currentTarget.checked })} /> Heights in colour</label>
          {/if}
          {#if topographic(element.basemap)}
            <label><input type="checkbox" checked={plain.contours !== false} onchange={(event) => (element.plain = { ...plain, contours: event.currentTarget.checked })} /> Contour lines</label>
            <label><input type="checkbox" checked={plain.peaks !== false} onchange={(event) => (element.plain = { ...plain, peaks: event.currentTarget.checked })} /> Summits and their heights</label>
          {/if}
          <label><input type="checkbox" checked={plain.roads !== false} onchange={(event) => (element.plain = { ...plain, roads: event.currentTarget.checked })} /> Roads</label>
          <label><input type="checkbox" checked={plain.rails !== false} onchange={(event) => (element.plain = { ...plain, rails: event.currentTarget.checked })} /> Railways</label>
          <label><input type="checkbox" checked={plain.buildings !== false} onchange={(event) => (element.plain = { ...plain, buildings: event.currentTarget.checked })} /> Buildings</label>
          <label><input type="checkbox" checked={plain.names !== false} onchange={(event) => (element.plain = { ...plain, names: event.currentTarget.checked })} /> Place names</label>
          <label><input type="checkbox" checked={plain.refs !== false} onchange={(event) => (element.plain = { ...plain, refs: event.currentTarget.checked })} /> Road numbers</label>
          <label><input type="checkbox" checked={plain.airfields !== false} onchange={(event) => (element.plain = { ...plain, airfields: event.currentTarget.checked })} /> Airfields and runways</label>
          <label><input type="checkbox" checked={plain.military !== false} onchange={(event) => (element.plain = { ...plain, military: event.currentTarget.checked })} /> Military ground</label>
          <label><input type="checkbox" checked={plain.cover !== false} onchange={(event) => (element.plain = { ...plain, cover: event.currentTarget.checked })} /> Fields, sand and ice</label>
        </div>
        <div class="rows">
          <span class="key">Borders</span>
          <div class="segments" role="group" aria-label="Borders drawn">
            {#each [['countries', 'Countries'], ['regions', 'Regions'], ['districts', 'Districts']] as [value, label] (value)}
              <button type="button" aria-pressed={(plain.admin ?? 'regions') === value} onclick={() => (element.plain = { ...plain, admin: value })}>{label}</button>
            {/each}
          </div>
        </div>
      {:else}
        {@const tone = element.tone ?? {}}
        <div class="tools wide">
          {#each Object.entries(TONES) as [id, [label, values]] (id)}<button type="button" class="btn btn-xs" title={id === 'none' ? 'The imagery as it comes' : `The imagery ${label.toLowerCase()}, at one press`}
            onclick={() => (element.tone = { ...values })}>{label}</button>{/each}
        </div>
        <div class="rows">
          {#if (element.overlays ?? []).includes('relief')}
            <span class="key">Relief</span>
            <input type="range" aria-label="Relief strength" min="0.25" max="2" step="0.25" value={element.relief ?? 1} oninput={(event) => (element.relief = Number(event.currentTarget.value))} />
          {/if}
          {#each [['opacity', 'Strength', 0, 1, 0.05], ['saturation', 'Colour', -1, 1, 0.05], ['brightness', 'Light', 0.2, 1, 0.05], ['contrast', 'Contrast', -1, 1, 0.05], ['hue', 'Tint', 0, 360, 5]] as [key, label, min, max, step] (key)}
            <span class="key">{label}</span>
            <input type="range" aria-label={`Imagery ${label.toLowerCase()}`} {min} {max} {step} value={tone[key] ?? (key === 'opacity' || key === 'brightness' ? 1 : 0)}
              oninput={(event) => (element.tone = { ...tone, [key]: Number(event.currentTarget.value) })} />
          {/each}
        </div>
      {/if}
      <div class="checks">
        {#each PLATE_OVERLAYS as [id, label] (id)}
          {#if id !== 'relief' || !GROUNDS[element.basemap]?.shade?.own}
            <label><input type="checkbox" checked={(element.overlays ?? []).includes(id)} onchange={() => toggleOverlay(id)} /> {label}</label>
          {/if}
        {/each}
      </div>
      </PlateSection>

      <PlateSection title="Layers" summary={`${(element.layers ?? []).length} drawn`}>
      {@const drawn = drawnOn(spec, element.id).length}
      {#if !rows.length}<p class="note">The case has no map layers yet. Draw on the plate from Add, or make one here.</p>{/if}
      <div class="tools wide">
        {#if onnewlayer}<button type="button" class="btn btn-xs" title="A new case layer, opened for editing in the Map where this map looks"
          onclick={() => onnewlayer(element)}><Icon name="plus" size={11} /> New layer here</button>{/if}
        {#if onkeepdrawn && drawn}<button type="button" class="btn btn-xs" title="Makes what was drawn by hand here a layer of the case"
          onclick={() => onkeepdrawn(element)}>Make a layer of the {drawn} drawn here</button>{/if}
      </div>
      <ul class="layers">
        {#each [...(element.layers ?? []).map((entry) => rows.find((row) => row.name === entry.name)).filter(Boolean), ...rows.filter((row) => !(element.layers ?? []).some((entry) => entry.name === row.name))] as row (row.name)}
          {@const entry = (element.layers ?? []).find((item) => item.name === row.name)}
          <li>
            <div class="layer"><label title={PLATE_HELP['Draw the layer']}><input type="checkbox" checked={!!entry} onchange={() => toggleLayer(row)} />
              <span class="name">{row.title}</span>{#if isTracked(row)}<Icon name="clock" size={11} />{/if}</label>
              {#if entry}
                <button type="button" class="icon-act small" aria-label={`Draw ${row.title} higher`} title="Draw it over the others" onclick={() => moveLayer(entry, -1)}><Icon name="chevronUp" size={11} /></button>
                <button type="button" class="icon-act small" aria-label={`Draw ${row.title} lower`} title="Draw it under the others" onclick={() => moveLayer(entry, 1)}><Icon name="chevronDown" size={11} /></button>
              {/if}
            </div>
            {#if entry}
              <div class="layer-set">
                <label class="weight role" title="One press gives the layer its role's colour, fill and lines, named in the legend">Stands for
                  <select aria-label={`${row.title} stands for`} value={entry.role ?? ''}
                    onchange={(event) => { const index = element.layers.indexOf(entry); element.layers[index] = withRole(entry, event.currentTarget.value, spec.theme); }}>
                    <option value="">Its own look</option>
                    {#each ROLE_LIST as [value, label] (value)}<option {value}>{label}</option>{/each}
                  </select></label>
                <div class="groups">
                  {#each row.categories as group (group.name)}
                    <button type="button" class="chip" class:off={entry.hidden.includes(group.name)} title={entry.hidden.includes(group.name) ? 'Show on this plate' : 'Leave out of this plate'}
                      onclick={() => toggleGroup(entry, group.name)}>{group.name}</button>
                  {/each}
                </div>
                <label class="weight" title={PLATE_HELP['Lines on this plate']}>Lines <input type="range" min="0.5" max="3" step="0.25" bind:value={entry.stroke} /> <span>{entry.stroke}×</span></label>
                <label class="weight" title={PLATE_HELP['Marks on this plate']}>Marks <input type="range" min="0.5" max="3" step="0.25" value={entry.icons ?? 1} oninput={(event) => (entry.icons = Number(event.currentTarget.value))} /> <span>{entry.icons ?? 1}×</span></label>
                <div class="weight">Here in {#if !entry.colour}<span class="quiet">its own colours</span>{/if}</div>
                <PlateColour label={`${row.title} colour on this plate`} value={entry.colour ?? '#c8102e'} theme={spec.theme} none onpick={(hex) => (entry.colour = hex)} />
                <div class="segments thin" role="group" aria-label={`${row.title} lines on this plate`}>
                  {#each [['', 'Its lines'], ['dashed', 'Dashed'], ['dotted', 'Dotted']] as [value, label] (value)}
                    <button type="button" aria-pressed={(entry.dash ?? '') === value} onclick={() => (entry.dash = value)}>{label}</button>
                  {/each}
                </div>
                <div class="segments thin" role="group" aria-label={`${row.title} areas on this plate`}>
                  {#each [['', 'Its fill'], ['solid', 'Full'], ['hatch', 'Hatched'], ['none', 'Outline']] as [value, label] (value)}
                    <button type="button" aria-pressed={(entry.fill ?? '') === value} onclick={() => (entry.fill = value)}>{label}</button>
                  {/each}
                </div>
                <button type="button" class="text-act" title="A label beside each named feature in the frame, none covering another" onclick={() => onlabels(element, row)}>Label its named features</button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
      </PlateSection>
    {:else if element.kind === 'inset'}
      <div class="rows">
        <span class="key">Ground</span>
        <select aria-label="Ground" bind:value={element.basemap}>
          {#each grounds.filter(([id]) => id !== WAYBACK_ID) as [id, label] (id)}<option value={id}>{label}</option>{/each}
        </select>
        <!-- a globe is turned to its map's middle, never zoomed, and its rim is its frame -->
        {#if !element.globe}
          <span class="key">Zoom</span>
          <input type="number" aria-label="Inset zoom" step="0.5" min="0" max="18" placeholder="Auto" value={element.zoom ?? ''}
            onchange={(event) => (element.zoom = event.currentTarget.value === '' ? null : number(event.currentTarget.value, null))} />
        {/if}
        <span class="key">Of</span>
        <select aria-label="Inset of" bind:value={element.of}>{#each maps as map (map.id)}<option value={map.id}>{name(map)}</option>{/each}</select>
        {#if !element.globe}
          <span class="key">Frame</span><input type="checkbox" aria-label="Inset frame" checked={element.border !== false} onchange={(event) => (element.border = event.currentTarget.checked)} />
        {/if}
      </div>
      <label class="check"><input type="checkbox" checked={!!element.globe} onchange={(event) => {
        // a globe laid flat again is one of the plate's maps
        if (!event.currentTarget.checked && mapCount(spec.elements) >= MAX_MAPS) { event.currentTarget.checked = true; toast(TOO_MANY_MAPS, 'warn', 6000); return; }
        element.globe = event.currentTarget.checked;
      }} /> Drawn as a globe</label>
      {#if element.globe}<p class="note">The world turned to the map's middle, its country in the accent, not counted among the plate's eight maps.</p>
      {:else}<p class="note">The inset follows its map and outlines the ground it shows.</p>{/if}
    {:else if element.kind === 'legend'}
      <div class="rows">
        <span class="key">Title</span><input aria-label="Legend title" bind:value={element.text} placeholder="Legend" maxlength="120" />
        <span class="key">Of</span>
        <select aria-label="Legend of" bind:value={element.of}>{#each maps as map (map.id)}<option value={map.id}>{name(map)}</option>{/each}</select>
        <span class="key">Columns</span><input type="number" aria-label="Columns" min="1" max="4" step="1" bind:value={element.columns} />
        <span class="key">Frame</span><input type="checkbox" aria-label="Legend frame" bind:checked={element.border} />
      </div>
      <PlateWords {element} theme={spec.theme} />
      <label class="check"><input type="checkbox" bind:checked={element.offmap} /> List what the layers hold off the map too</label>
      <PlateSection title="Rows" summary={`${rowsOf.filter((entry) => !entry.off).length}`}>
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
      </PlateSection>
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
        {#if element.kind === 'text'}
          <div class="rows">
            <span class="key">Style</span>
            <select aria-label="Text role" value={element.role ?? ''}
              onchange={(event) => Object.assign(element, styled(element, event.currentTarget.value, spec.theme))}>
              <option value="">Set by hand</option>
              {#each Object.entries(TEXT_STYLES) as [id, style] (id)}<option value={id}>{style.label}</option>{/each}
            </select>
          </div>
        {/if}
        <textarea aria-label="Text" rows={element.kind === 'label' ? 2 : 4} bind:value={element.text} maxlength="4000" bind:this={words}
          oninput={() => { if (element.kind === 'label') element.box = labelBox(element, measure); }}></textarea>
        {#if element.kind === 'text'}
          <div class="tokens" role="group" aria-label="Words filled in">
            {#each TOKENS as token (token)}
              <button type="button" class="token" title={`${TOKEN_SAID[token]}. Put it where the cursor is`} onclick={() => putToken(token)}>{token}</button>
            {/each}
          </div>
        {/if}
      {:else}
        <p class="note">The map's sources, written for you. They shrink to fit rather than lose one.</p>
        {#if creditList.length}
          <ul class="credit-list" aria-label="Credits printed">
            {#each creditList as part (part.text)}
              <li><label title={part.owed ? 'Its terms ask for this credit wherever its pictures are shown' : 'Print this credit, or take it off'}>
                <input type="checkbox" checked={part.owed || !(element.dropped ?? []).includes(part.text)} disabled={part.owed}
                  onchange={(event) => { const others = (element.dropped ?? []).filter((text) => text !== part.text);
                    element.dropped = event.currentTarget.checked ? others : [...others, part.text]; }} />
                <span>{part.text}</span>{#if part.owed}<Icon name="lock" size={10} />{/if}</label></li>
            {/each}
          </ul>
        {/if}
      {/if}
      {#if element.kind === 'qr'}
        <div class="rows">
          <span class="key">Colour</span>
          <PlateColour label="QR colour" value={element.colour ?? '#000000'} theme={spec.theme} onpick={(hex) => (element.colour = hex)} />
          <span class="key">Fill</span>
          <PlateColour label="QR fill" value={element.fill ?? '#ffffff'} theme={spec.theme} onpick={(hex) => (element.fill = hex)} />
        </div>
      {:else}
        <PlateWords {element} theme={spec.theme} onchange={() => { if (element.kind === 'label') element.box = labelBox(element, measure); }} />
      {/if}
      <div class="rows">
        {#if ['text', 'label'].includes(element.kind)}
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
          {#if element.style && element.style !== 'plain'}
            <span class="key">Fill</span>
            <PlateColour label="Fill colour" value={element.fill ?? (element.style === 'number' ? spec.theme.accent : spec.theme.paper)} theme={spec.theme}
              onpick={(hex) => (element.fill = hex)} />
          {/if}
          <span class="key">Leader</span>
          <select aria-label="Leader" bind:value={element.leader}>
            <option value="straight">Straight</option><option value="elbow">Elbowed</option><option value="curve">Curved</option><option value="none">None</option>
          </select>
          {#if element.leader !== 'none'}
            <span class="key">Its end</span>
            <select aria-label="Leader end" bind:value={element.end}>
              <option value="dot">A dot</option><option value="arrow">An arrow</option><option value="none">Nothing</option>
            </select>
          {/if}
        {/if}
        {#if ['text', 'key', 'table', 'legend'].includes(element.kind)}<span class="key">Frame</span><input type="checkbox" aria-label="Text frame" bind:checked={element.border} />{/if}
      </div>
      {#if element.ref}
        <p class="note">Shown when its feature is on the map. <button type="button" class="text-act" onclick={() => (element.ref = null)}>Always show it</button></p>
      {/if}
    {:else if element.kind === 'symbol'}
      <!-- one of the markers the case's layers draw, picked from the same palette -->
      <div class="rows">
        <span class="key" title="One of the markers the layers draw, in the colour picked">Symbol</span>
        <LayerStyleButton label="Symbol and colour" title="Symbol" symbol={element.symbol ?? 'pin'} colour={element.colour ?? spec.theme.accent} {caseId} size={24} own={false}
          onpick={(style) => { Object.assign(element, style); onsymbol?.({ ...style, size: element.box[2] }); }} />
        <span class="key" title="Its size on the page">Size</span>
        <span class="pair"><input type="range" aria-label="Symbol size" min="3" max="30" step="0.5" value={element.box[2]}
          oninput={(event) => { const side = Number(event.currentTarget.value); element.box = [element.box[0], element.box[1], side, side]; onsymbol?.({ size: side }); }} />
          <span class="quiet">{element.box[2]} mm</span></span>
        <!-- the same three states, worded as a layer's marker says them -->
        <span class="key" title={LAYER_HELP.status}>State</span>
        <div class="segments" role="group" aria-label="Symbol state" title={LAYER_HELP.status}>
          {#each STATUS_CHOICES as [value, label, said] (value)}
            <button type="button" class:short={!value} aria-pressed={(element.status ?? '') === value} aria-label={value ? label : said} title={said}
              onclick={() => (element.status = value)}>{label}</button>
          {/each}
        </div>
      </div>
      <p class="note">It stands over its point of the ground, the map framed however it is.</p>
    {:else if element.kind === 'signature'}
      <textarea aria-label="Signature words" rows="2" bind:value={element.text} maxlength="400"></textarea>
      <p class="note">{signatureNote}</p>
      <div class="rows">
        <span class="key">Picture</span>
        <div class="segments" role="group" aria-label="Signature side">
          {#each [['left', 'On the left'], ['right', 'On the right']] as [value, label] (value)}
            <button type="button" aria-pressed={(element.align ?? 'left') === value} onclick={() => (element.align = value)}>{label}</button>
          {/each}
        </div>
      </div>
      <PlateWords {element} theme={spec.theme} />
    {:else if element.kind === 'brand'}
      <div class="rows">
        <span class="key">Before it</span><input aria-label="Words before the mark" maxlength="40" placeholder="Nothing" bind:value={element.text} />
        <span class="key">Align</span>
        <div class="segments" role="group" aria-label="Mark alignment">
          {#each [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] as [value, label] (value)}
            <button type="button" aria-pressed={(element.align ?? 'right') === value} onclick={() => (element.align = value)}>{label}</button>
          {/each}
        </div>
      </div>
      <PlateWords {element} theme={spec.theme} />
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
      </div>
      <PlateWords {element} theme={spec.theme} />
      <p class="note">Measured at the map's centre. A tilted map has none.</p>
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
        <button type="button" class="btn btn-xs" title="A picture of the case, or a proof on the map pointing at its place" onclick={openPictures}><Icon name="image" size={12} /> From the case</button>
        <button type="button" class="btn btn-xs" title="A picture kept inside the plate, so a template keeps it too" onclick={() => fileInput?.click()}><Icon name="upload" size={12} /> From this computer</button>
        <button type="button" class="btn btn-xs" title="The badge set in Settings → Signature" onclick={() => { element.src = SIGNATURE; element.data = null; }}>Signature</button>
      </div>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden bind:this={fileInput}
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
            <button type="button" class="btn btn-xs" title="Press the map where it points" onclick={() => onpoint?.(element)}>A point of the map…</button>
          {/if}
        </span>
      </div>
    {:else if element.kind === 'focus'}
      <div class="rows">
        <span class="key">Lit</span>
        <select aria-label="Country lit" value={element.spotlight?.country ?? ''} onfocus={readWorld}
          onchange={(event) => { const country = event.currentTarget.value;
            if (country) { element.spotlight = { ...element.spotlight, country }; element.name = country; } }}>
          {#each world ? countryNames(world) : [element.spotlight?.country].filter(Boolean) as name (name)}<option value={name}>{name}</option>{/each}
        </select>
        <span class="key">The rest</span>
        <div class="segments" role="group" aria-label="The rest of the world">
          {#each [['dark', 'Darkened'], ['fade', 'Faded']] as [value, label] (value)}
            <button type="button" aria-pressed={(element.spotlight?.mode ?? 'dark') === value} onclick={() => (element.spotlight = { ...element.spotlight, mode: value })}>{label}</button>
          {/each}
        </div>
        <span class="key">Strength</span>
        <input type="range" aria-label="Focus strength" min="0.1" max="0.9" step="0.05" value={element.spotlight?.dim ?? 0.55}
          oninput={(event) => (element.spotlight = { ...element.spotlight, dim: Number(event.currentTarget.value) })} />
      </div>
      <p class="note">On a flat map only, disputed areas touching it half lit and dotted round, faded in by the video's transitions.</p>
    {:else if element.kind === 'video'}
      <div class="tools wide">
        <button type="button" class="btn btn-xs" title="The footage placed on the map first, then every video and GIF of the case" onclick={openVideos}><Icon name="video" size={12} /> {element.src ? 'Another video' : 'Choose a video'}</button>
      </div>
      {#if element.src && isGif(element.src)}
        <p class="note file" title={element.src}>{fileName(element.src)}</p>
        <img class="trim" src={fileUrl(caseId, element.src)} alt="" />
        <div class="rows">
          <span class="key">Runs</span>
          <input aria-label="GIF runs" value={timecode(range[1] - range[0])}
            onchange={(event) => { const value = readTimecode(event.currentTarget.value); if (value !== null && value > 0) element.clip = clipRange({ clip: [0, value] }); else event.currentTarget.value = timecode(range[1] - range[0]); }} />
        </div>
        <p class="note">A GIF plays round and round for as long as it runs, and holds its step that long.</p>
      {:else if element.src}
        <p class="note file" title={element.src}>{fileName(element.src)}</p>
        <!-- svelte-ignore a11y_media_has_caption -->
        <video class="trim" bind:this={trimVideo} src={fileUrl(caseId, element.src)} controls preload="metadata"
          onloadedmetadata={(event) => lengthKnown(event.currentTarget.duration)} ontimeupdate={trimTick}></video>
        <div class="tools wide">
          <button type="button" class="btn btn-xs" title="The clip starts where the player stands" onclick={() => setClip(trimVideo?.currentTime ?? 0, range[1])}>Start here</button>
          <button type="button" class="btn btn-xs" title="The clip ends where the player stands" onclick={() => setClip(range[0], trimVideo?.currentTime ?? range[1])}>End here</button>
          <button type="button" class="btn btn-xs" title="Plays the clip alone, from its start to its end" onclick={playClip}><Icon name="play" size={11} /> The clip</button>
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
          {/if}
        </div>
        {#if element.caption}<PlateWords {element} theme={spec.theme} />{/if}
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
            <button type="button" class="btn btn-xs" title="Press the map where it points" onclick={() => onpoint?.(element)}>A point of the map…</button>
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
    {:else if ['arrow', 'measure', 'ring', 'cone', 'zone', 'line'].includes(element.kind)}
      <div class="rows">
        <span class="key">Colour</span><PlateColour label="Colour" value={element.colour ?? spec.theme.accent} theme={spec.theme} onpick={(hex) => (element.colour = hex)} />
        <span class="key">Weight</span><input type="range" aria-label="Weight" min="0.3" max="6" step="0.1" bind:value={element.width} />
        {#if !(element.kind === 'arrow' && element.shape === 'offensive')}
          <span class="key">Dash</span>
          <select aria-label="Dash" value={element.line ?? (element.kind === 'measure' ? 'dashed' : 'solid')} onchange={(event) => (element.line = event.currentTarget.value)}>
            <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
          </select>
        {/if}
        {#if element.kind === 'line'}
          <span class="key">Path</span>
          <div class="segments" role="group" aria-label="Line path">
            {#each [['line', 'Straight'], ['curve', 'Curved']] as [value, label] (value)}
              <button type="button" aria-pressed={(element.shape === 'curve' ? 'curve' : 'line') === value} onclick={() => (element.shape = value)}>{label}</button>
            {/each}
          </div>
          <span class="key">Heads</span>
          <select aria-label="Line heads" value={element.heads ?? 'none'} onchange={(event) => (element.heads = event.currentTarget.value)}>
            <option value="none">None</option><option value="end">At its end</option><option value="both">At both ends</option>
          </select>
          {#if (element.heads ?? 'none') !== 'none'}
            <span class="key">Head</span><input type="range" aria-label="Head size" min="0.4" max="3" step="0.1" bind:value={element.head} />
          {/if}
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
        <span class="key">{element.kind === 'measure' ? 'Says' : 'Words'}</span>
        <input aria-label="Words" maxlength="200" placeholder={element.kind === 'measure' ? 'Its length, worked out' : 'None'} bind:value={element.text} />
      </div>
      <PlateWords {element} theme={spec.theme} />
      {#if element.kind === 'zone'}
        <label class="check"><input type="checkbox" checked={!!element.mask?.on} onchange={(event) => (element.mask = { ...(element.mask ?? {}), on: event.currentTarget.checked })} />
          Dim the ground round it</label>
        {#if element.mask?.on}
          <label class="weight" title={PLATE_HELP['Dim strength']}>Dim <input type="range" min="0.1" max="0.9" step="0.05" value={element.mask.darkness ?? 0.55}
            oninput={(event) => (element.mask = { ...element.mask, darkness: Number(event.currentTarget.value) })} /></label>
        {/if}
      {/if}
      <p class="note">Drag its points on the map, or the whole of it.</p>
    {/if}

    {#if !['map', 'inset', 'arrow', 'zone', 'ring', 'cone', 'measure', 'line', 'video'].includes(element.kind)}
      <div class="rows">
        <span class="key">Strength</span><input type="range" aria-label="Opacity" min="0.05" max="1" step="0.05" value={element.opacity ?? 1}
          oninput={(event) => (element.opacity = Number(event.currentTarget.value))} />
        <span class="key">Turned</span><input type="number" aria-label="Rotation" min="-180" max="180" step="1" value={element.rotate ?? 0}
          onchange={(event) => (element.rotate = Math.max(-180, Math.min(180, number(event.currentTarget.value, 0))))} />
      </div>
    {/if}
  {/if}
  </div>
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
  <FloatingMenu anchor={pickAnchor} width={300} label="Videos and GIFs of the case" onclose={() => (pickingVideo = false)}>
    {#if footage.length}
      <p class="fm-label">Footage placed on the map, pointing at its place</p>
      <div class="pictures">
        {#each footage as row (row.key)}
          <button type="button" class="picture" title={row.title} onclick={() => chooseVideo(row.path, [row.lon, row.lat])}>
            {#if row.thumbnail}<img src={fileUrl(caseId, row.thumbnail)} alt={row.title} loading="lazy" />{:else}<Icon name="video" size={16} />{/if}
          </button>
        {/each}
      </div>
      <p class="fm-label">Videos and GIFs of the case</p>
    {/if}
    <div class="pictures">
      {#each videos as item (item.path)}
        <button type="button" class="picture" title={item.title || item.path} onclick={() => chooseVideo(item.path)}>
          {#if item.thumbnail}<img src={fileUrl(caseId, item.thumbnail)} alt={item.title || ''} loading="lazy" />{:else}<Icon name="video" size={16} />{/if}
        </button>
      {:else}
        <p class="note">No video or GIF in this case yet.</p>
      {/each}
    </div>
  </FloatingMenu>
{/if}

<style>
  .inspector { width: 100%; height: 100%; overflow-y: auto; padding: 10px 12px 16px; background: var(--bg-1); font-size: var(--fs-xs);
    container-type: inline-size; scrollbar-width: thin; }
  header { display: flex; align-items: center; gap: 2px; margin-bottom: 6px; }
  h3 { flex: 1; margin: 0 0 8px; font-size: var(--fs-sm); }
  header h3 { margin: 0; }
  /* a wide inspector sets its sections side by side, the element's name and its first fields across the top */
  @container (min-width: 540px) {
    .flow { columns: 2; column-gap: 22px; }
    .flow > h3, .flow > header, .flow > .element-name, .flow > .warn { column-span: all; }
    .rows, .checks, .days, .themes, .layers li, .legend-row { break-inside: avoid; }
  }
  .rows { display: grid; grid-template-columns: 74px minmax(0, 1fr); align-items: center; gap: 7px 8px; margin: 8px 0; }
  .key { color: var(--text-3); font-size: 11px; }
  select, input[type='number'], input:not([type]), .rename, textarea, .element-name { width: 100%; min-width: 0; height: 26px; padding: 3px 6px; font-size: var(--fs-xs); border-radius: var(--r-sm); }
  .element-name { margin-bottom: 4px; }
  textarea { height: auto; resize: vertical; line-height: 1.4; }
  input[type='color'] { flex: none; width: 34px; height: 22px; padding: 0; border: 1px solid var(--border); border-radius: var(--r-sm); background: none; }
  input[type='range'] { width: 100%; min-width: 0; }
  .colour, .pair { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .pair input[type='number'] { width: 70px; }
  .pair input[type='range'] { flex: 1; min-width: 0; }
  .pair .quiet { flex: none; white-space: nowrap; }
  .rename { flex: 1; }
  .segments { display: flex; border: 1px solid var(--border); border-radius: var(--r-sm); overflow: hidden; background: var(--bg-1); }
  .segments button { flex: 1; min-width: 0; padding: 4px 3px; color: var(--text-2); font-size: 11px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .segments.thin button { padding: 2px; font-size: 10px; }
  .segments button.short { flex: 0 0 26px; }
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
  .weight.role select { flex: 1; min-width: 0; }
  .weight input[type='range'] { flex: 1; }
  .quiet { color: var(--text-3); }
  .frame { width: 100%; justify-content: center; margin-bottom: 4px; }
  .frame.on { border-color: var(--accent); color: var(--accent); }
  .keep { margin: 2px 0 0; font-weight: 600; color: var(--text-1); }
  .checks .sub { padding-left: 20px; }
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
  .themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(62px, 1fr)); gap: 4px; }
  .theme { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 4px 2px; border: 1px solid var(--border); border-radius: var(--r-sm);
    color: var(--text-2); font-size: 9.5px; cursor: pointer; }
  .theme.on, .theme:hover { border-color: var(--accent); color: var(--text-1); }
  .sample { position: relative; display: flex; align-items: center; gap: 4px; width: 100%; height: 26px; padding: 3px; border: 1px solid var(--border);
    border-radius: 3px; font-size: 11px; overflow: hidden; }
  .sample b { flex: 1; text-align: center; font-weight: 700; }
  .sample i { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; }
  .tokens { display: flex; flex-wrap: wrap; gap: 3px; }
  .token { padding: 1px 5px; border: 1px solid var(--border); border-radius: 3px; background: var(--bg-1); color: var(--text-2);
    font-family: var(--font-mono); font-size: 10px; cursor: pointer; }
  .token:hover { border-color: var(--accent); color: var(--text-1); }
  .grounds { display: grid; grid-template-columns: repeat(auto-fill, minmax(70px, 1fr)); gap: 6px; }
  .ground-tile { display: flex; flex-direction: column; align-items: stretch; gap: 3px; padding: 3px; border: 1px solid var(--border);
    border-radius: var(--r-sm); background: var(--bg-1); color: var(--text-2); font-size: 10px; line-height: 1.2; text-align: left; cursor: pointer; }
  .ground-tile :global(svg.ground-swatch) { width: 100%; height: auto; aspect-ratio: 58 / 38; }
  .ground-tile span { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .ground-tile:hover { border-color: var(--border-strong, var(--text-3)); color: var(--text-1); }
  .s2-pick { display: flex; justify-content: flex-end; }
  .credit-list { margin: 0 0 6px; padding: 0; list-style: none; }
  .credit-list label { display: flex; align-items: flex-start; gap: 6px; padding: 2px 0; color: var(--text-1); font-size: 11px; line-height: 1.35; cursor: pointer; }
  .credit-list input { margin-top: 1px; }
  .credit-list input:disabled + span { color: var(--text-2); }
  .credit-list span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .ground-tile.locked { color: var(--text-3); }
  .ground-tile.locked :global(svg.ground-swatch) { opacity: .5; }
  .setup { margin: 0 0 6px; padding-left: 18px; color: var(--text-2); font-size: 10.5px; line-height: 1.45; }
  .ground-tile[aria-checked='true'] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); color: var(--text-1); }
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
