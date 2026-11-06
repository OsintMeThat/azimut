<script>
  /**
   * How a note prints, set from the editor's header: its style, typeface and
   * text size, page size, accent, marking, cover, contents, numbering and the
   * list of sources at the end, shown as the style has it until it is set. Each
   * change is handed up at once (`onchange`), which saves it beside the note and
   * draws the Page pane again. A template's look keeps no picture and no day of a
   * case.
   *
   * Each typeface is shown in its own face, loaded from the server when the panel
   * first opens (`lib/notes/noteFonts.js`). The hover texts live in
   * `lib/notes/lookHelp.js`.
   *
   * The last section, folded, is the page's header and footer: three one-line slots
   * each, which wait for a pause or the field's end like the subtitle does, or a
   * logo in place of words. A band left empty shows what the style prints there.
   */
  import { tick, untrack } from 'svelte';
  import { LOOK_HELP } from '../../lib/notes/lookHelp.js';
  import {
    BANDS, BAND_MAX, COVERS, FONTS, PAGES, SIZES, SLOTS, SLOT_LOGOS, STYLES, SUBTITLE_MAX, TLPS, bandStyleOwn, coverChoice, coverFor, lookFont, normaliseLook,
    slotText, sourcesOn, styleLabel,
  } from '../../lib/notes/look.js';
  import { faceFamily, loadNoteFont, noteFonts } from '../../lib/notes/noteFonts.js';
  import { recentColours } from '../../lib/recentColours.svelte.js';
  import { foldText } from '../../lib/textFold.js';
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import HexField from '../../components/HexField.svelte';

  let { look = null, onchange, template = false, entities = [], disabled = false } = $props();

  let anchor = $state(null);
  let subtitle = $state('');
  let picking = $state(false);
  let pictureQuery = $state('');
  let panel = $state(null);
  let fonts = $state(FONTS);
  /** The faces drawn so far, by key. */
  let faces = $state({});
  let subtitleTimer;
  let bandsOpen = $state(false);
  /** What each slot's field holds, which the look keeps once typing pauses. */
  let drafts = $state({ header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' } });
  /** The slot whose logo choices are open, as `band.slot`. */
  let logoFor = $state('');
  const slotTimers = {};

  const whole = $derived(normaliseLook(look));
  const coverIs = $derived(coverChoice(whole));
  const COVER_HELP = { off: LOOK_HELP.coverOff, style: LOOK_HELP.coverStyle, own: LOOK_HELP.coverOwn };
  $effect(() => { subtitle = whole.cover.subtitle; });
  // a field takes what the look keeps, except while it only differs by the spaces the look trims
  $effect(() => {
    const kept = whole;
    untrack(() => {
      for (const band of BANDS) {
        for (const slot of SLOTS) {
          const saved = kept[band.id]?.[slot.id] ?? '';
          if (slotText(drafts[band.id][slot.id]) !== saved) drafts[band.id][slot.id] = saved;
        }
      }
    });
  });
  const bandsSet = $derived(BANDS.some((band) => whole[band.id]));
  /** What the style prints in a band the look leaves empty: shown in grey while it is. */
  const styleOwn = $derived(bandStyleOwn(whole.style));

  const pictures = $derived(entities
    .filter((entity) => (entity.type === 'media' || entity.type === 'capture') && entity.attrs?.path && entity.attrs?.kind !== 'video')
    .filter((entity) => foldText(entity.label).includes(foldText(pictureQuery.trim())))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, 60));
  const coverPicture = $derived(entities.find((entity) => entity.id === whole.cover.image) ?? null);
  const swatches = $derived(recentColours.list.slice(0, 6));
  const ownFont = $derived(lookFont({ style: whole.style }));
  /** The CSS family a card is drawn in: its face once it is here, the interface's until then. */
  const drawnIn = (key) => (faces[key] ? `"${faceFamily(key)}", var(--font-sans)` : null);

  // the faces are asked for the first time the panel opens, and kept for the tab
  $effect(() => {
    if (!anchor) return;
    let live = true;
    untrack(() => {
      noteFonts().then((list) => { if (live) fonts = list; });
      for (const font of FONTS) {
        if (!font.id || faces[font.id]) continue;
        loadNoteFont(font.id).then((ok) => { if (ok && live) faces = { ...faces, [font.id]: true }; });
      }
    });
    return () => { live = false; };
  });

  /** Open the panel with the style picked in focus, so the keyboard carries on inside it. */
  async function open(button) {
    anchor = button;
    await tick();
    (panel?.querySelector('[role="radio"][aria-checked="true"]') ?? panel?.querySelector('button'))?.focus({ preventScroll: true });
  }

  function set(change) {
    const next = normaliseLook({ ...whole, ...change, cover: { ...whole.cover, ...(change.cover ?? {}) } });
    if (JSON.stringify(next) !== JSON.stringify(whole)) onchange?.(next);
  }

  function accent(hex) {
    set({ accent: hex ?? '' });
    if (hex) recentColours.keep(hex);
  }

  function typedSubtitle(value) {
    subtitle = value;
    clearTimeout(subtitleTimer);
    subtitleTimer = setTimeout(() => set({ cover: { subtitle } }), 500);
  }
  function commitSubtitle() {
    clearTimeout(subtitleTimer);
    set({ cover: { subtitle } });
  }

  /** A band written from its three fields: what is kept stays whole even if a field is still being typed in. */
  function writeBand(band) {
    clearTimeout(slotTimers[`${band}.left`]);
    clearTimeout(slotTimers[`${band}.center`]);
    clearTimeout(slotTimers[`${band}.right`]);
    set({ [band]: { ...drafts[band] } });
  }
  function typedSlot(band, slot, value) {
    drafts[band][slot] = value;
    clearTimeout(slotTimers[`${band}.${slot}`]);
    slotTimers[`${band}.${slot}`] = setTimeout(() => writeBand(band), 500);
  }
  function putLogo(band, slot, id) {
    logoFor = '';
    drafts[band][slot] = id;
    writeBand(band);
  }

  function pickPicture(entity) {
    picking = false;
    pictureQuery = '';
    set({ cover: { image: entity?.id ?? '' } });
  }

  function close() {
    commitSubtitle();
    for (const band of BANDS) writeBand(band.id);
    logoFor = '';
    anchor = null;
    picking = false;
  }
</script>

<button type="button" class="btn btn-ghost btn-sm look-open" class:on={anchor} {disabled} aria-haspopup="dialog" aria-expanded={Boolean(anchor)}
  title={LOOK_HELP.open} data-guide="notebook.look"
  onclick={(event) => (anchor ? close() : open(event.currentTarget))}>
  <Icon name="brush" size={14} /> Look<span class="current">{styleLabel(whole.style)}</span>
</button>

{#if anchor}
  <FloatingMenu {anchor} align="end" width={330} role="dialog" label="Look" onclose={close}>
    <div class="look" bind:this={panel}>
      <div class="part" title={LOOK_HELP.style}>
        <span class="key">Style</span>
        <div class="styles" role="radiogroup" aria-label="Style">
          {#each STYLES as style (style.id)}
            <button type="button" class="style-card" class:on={whole.style === style.id} role="radio" aria-checked={whole.style === style.id}
              title={`${style.label}: ${style.note}`} onclick={() => set({ style: style.id })}>
              <span class="style-name">{style.label}</span><span class="style-note">{style.note}</span>
            </button>
          {/each}
        </div>
      </div>

      <div class="part">
        <div class="part-head">
          <span class="key" title={LOOK_HELP.font}>Text</span>
          <div class="seg" role="radiogroup" aria-label="Text size">
            {#each SIZES as size (size.id)}
              <button type="button" class:on={whole.size === size.id} role="radio" aria-checked={whole.size === size.id}
                title={LOOK_HELP.size} onclick={() => set({ size: size.id })}>{size.label}</button>
            {/each}
          </div>
        </div>
        <div class="fonts" role="radiogroup" aria-label="Typeface">
          {#each fonts as font (font.id)}
            {@const face = font.id || ownFont}
            <button type="button" class="font-card" class:on={whole.font === font.id} role="radio" aria-checked={whole.font === font.id}
              title={font.id ? `${font.label}: ${font.note}` : LOOK_HELP.fontOwn} onclick={() => set({ font: font.id })}>
              <span class="font-ag" style:font-family={drawnIn(face)}>Ag</span>
              <span class="font-name" style:font-family={font.id ? drawnIn(face) : null}>{font.label}</span>
            </button>
          {/each}
        </div>
      </div>

      <div class="row">
        <span class="key" title={LOOK_HELP.page}>Page</span>
        <div class="seg" role="radiogroup" aria-label="Page size">
          {#each PAGES as page (page.id)}
            <button type="button" class:on={whole.page === page.id} role="radio" aria-checked={whole.page === page.id}
              title={LOOK_HELP.page} onclick={() => set({ page: page.id })}>{page.label}</button>
          {/each}
        </div>
      </div>

      <div class="row">
        <span class="key" title={LOOK_HELP.accent}>Accent</span>
        <div class="accent">
          <input type="color" aria-label="Accent colour" title={LOOK_HELP.accent} value={whole.accent || '#808080'} class:unset={!whole.accent}
            onchange={(event) => accent(event.currentTarget.value)} />
          {#each swatches as hex (hex)}
            <button type="button" class="swatch" class:on={whole.accent === hex} style:background={hex}
              aria-label={`Accent ${hex}`} title={`${LOOK_HELP.accent}: ${hex}`} onclick={() => accent(hex)}></button>
          {/each}
          <HexField value={whole.accent} label="Accent colour code" placeholder="#hex" onpick={(hex) => accent(hex)} />
          <button type="button" class="own" class:on={!whole.accent} aria-pressed={!whole.accent} title={LOOK_HELP.accentOwn}
            onclick={() => accent('')}>Style's own</button>
        </div>
      </div>

      <div class="part">
        <span class="key" title={LOOK_HELP.tlp}>Marking</span>
        <div class="tlps" role="radiogroup" aria-label="TLP marking">
          {#each TLPS as tlp (tlp.id)}
            <button type="button" class="tlp" class:on={whole.tlp === tlp.id} class:none={!tlp.id} role="radio" aria-checked={whole.tlp === tlp.id}
              style:color={tlp.colour} title={tlp.id ? `${LOOK_HELP.tlp}: TLP:${tlp.label}` : LOOK_HELP.tlp}
              onclick={() => set({ tlp: tlp.id })}>{tlp.id ? `TLP:${tlp.label}` : tlp.label}</button>
          {/each}
        </div>
      </div>

      <div class="sep"></div>

      <div class="row">
        <span class="key" title={LOOK_HELP.cover}>Cover</span>
        <div class="seg" role="radiogroup" aria-label="Cover page">
          {#each COVERS as cover (cover.id)}
            <button type="button" class:on={coverIs === cover.id} role="radio" aria-checked={coverIs === cover.id}
              title={COVER_HELP[cover.id]} onclick={() => set({ cover: coverFor(cover.id) })}>{cover.label}</button>
          {/each}
        </div>
      </div>
      {#if coverIs === 'style'}
        <div class="cover">
          <label class="field" title={LOOK_HELP.subtitle}>
            <span>Subtitle</span>
            <input class="input" value={subtitle} maxlength={SUBTITLE_MAX} placeholder="A line under the title" title={LOOK_HELP.subtitle}
              oninput={(event) => typedSubtitle(event.currentTarget.value)} onblur={commitSubtitle}
              onkeydown={(event) => { if (event.key === 'Enter') commitSubtitle(); }} />
          </label>
          {#if !template}
            <div class="field" title={LOOK_HELP.image}>
              <span>Picture</span>
              <div class="picked">
                <button type="button" class="btn btn-sm pick" title={LOOK_HELP.image} onclick={() => (picking = !picking)}>
                  <Icon name="image" size={13} /><span>{coverPicture?.label ?? (whole.cover.image ? 'No longer in the case' : 'Choose a picture')}</span>
                </button>
                {#if whole.cover.image}
                  <button type="button" class="btn btn-ghost btn-sm" title="No picture on the cover" aria-label="No picture on the cover"
                    onclick={() => pickPicture(null)}><Icon name="x" size={12} /></button>
                {/if}
              </div>
              {#if picking}
                <div class="pictures">
                  <!-- svelte-ignore a11y_autofocus -->
                  <input class="input" bind:value={pictureQuery} placeholder="Find a picture…" autofocus title={LOOK_HELP.image}
                    onkeydown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); picking = false; } }} />
                  <div class="picture-list">
                    {#each pictures as entity (entity.id)}
                      <button type="button" class="picture-row" class:on={entity.id === whole.cover.image} title={entity.label}
                        onclick={() => pickPicture(entity)}><Icon name="image" size={12} /><span>{entity.label}</span></button>
                    {/each}
                    {#if !pictures.length}<p class="none">No picture in the case matches.</p>{/if}
                  </div>
                </div>
              {/if}
            </div>
            {@render day()}
          {/if}
        </div>
      {:else if coverIs === 'own'}
        <div class="cover">
          <p class="said">{LOOK_HELP.coverOwn}.</p>
          <label class="switch" title={LOOK_HELP.centred}>
            <input type="checkbox" role="switch" checked={!whole.cover.top} title={LOOK_HELP.centred}
              onchange={(event) => set({ cover: { top: !event.currentTarget.checked } })} />
            <span class="track" aria-hidden="true"><span class="knob"></span></span>
            Centred down the page
          </label>
          {#if !template}{@render day()}{/if}
        </div>
      {/if}
      <label class="check" title={LOOK_HELP.toc}>
        <input type="checkbox" checked={whole.toc} title={LOOK_HELP.toc} onchange={(event) => set({ toc: event.currentTarget.checked })} />
        Contents page
      </label>
      <label class="check" title={LOOK_HELP.numbered}>
        <input type="checkbox" checked={whole.numbered} title={LOOK_HELP.numbered} onchange={(event) => set({ numbered: event.currentTarget.checked })} />
        Numbered headings
      </label>
      <div class="row">
        <span class="key" title={LOOK_HELP.sources}>Sources</span>
        <label class="switch" title={LOOK_HELP.sources}>
          <input type="checkbox" role="switch" checked={sourcesOn(whole)} title={LOOK_HELP.sources}
            onchange={(event) => set({ sources: event.currentTarget.checked ? 'on' : 'off' })} />
          <span class="track" aria-hidden="true"><span class="knob"></span></span>
          List sources at the end
        </label>
      </div>

      <div class="sep"></div>

      <div class="part">
        <button type="button" class="fold" aria-expanded={bandsOpen} title={LOOK_HELP.bands} onclick={() => (bandsOpen = !bandsOpen)}>
          <Icon name={bandsOpen ? 'chevronDown' : 'chevronRight'} size={12} />
          <span class="key">Header and footer</span>
          {#if bandsSet}<span class="current">On</span>{/if}
        </button>
        {#if bandsOpen}
          {#each BANDS as band (band.id)}
            {@const own = whole[band.id] ? null : styleOwn[band.id]}
            <div class="band" role="group" aria-label={band.label}>
              <span class="key">{band.label}</span>
              <div class="slots">
                {#each SLOTS as slot (slot.id)}
                  {@const place = `${band.id}.${slot.id}`}
                  {@const logo = SLOT_LOGOS.find((item) => item.id === slotText(drafts[band.id][slot.id]))}
                  <div class="slot">
                    <div class="slot-head">
                      <span class="slot-name">{slot.label}</span>
                      {#if !logo}
                        <button type="button" class="slot-logo" class:on={logoFor === place} aria-expanded={logoFor === place}
                          title={LOOK_HELP.slotLogo} aria-label={`${band.label} ${slot.label.toLowerCase()}: a logo`}
                          onclick={() => (logoFor = logoFor === place ? '' : place)}><Icon name="image" size={12} /></button>
                      {/if}
                    </div>
                    {#if logo}
                      <span class="slot-chip">
                        <span>{logo.label}</span>
                        <button type="button" class="chip-x" title={LOOK_HELP.slotLogoClear} aria-label={`Take the logo out of the ${band.label.toLowerCase()} ${slot.label.toLowerCase()}`}
                          onclick={() => putLogo(band.id, slot.id, '')}><Icon name="x" size={10} /></button>
                      </span>
                    {:else}
                      <input class="input" value={drafts[band.id][slot.id]} maxlength={BAND_MAX} placeholder={own?.[slot.id] ?? ''}
                        aria-label={`${band.label} ${slot.label.toLowerCase()}`} title={LOOK_HELP.slot}
                        oninput={(event) => typedSlot(band.id, slot.id, event.currentTarget.value)} onblur={() => writeBand(band.id)}
                        onkeydown={(event) => { if (event.key === 'Enter') writeBand(band.id); }} />
                    {/if}
                    {#if logoFor === place}
                      <div class="logo-pick">
                        {#each SLOT_LOGOS as item (item.id)}
                          <button type="button" class="picture-row" title={LOOK_HELP.slotLogo} onclick={() => putLogo(band.id, slot.id, item.id)}>{item.label}</button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/each}
          <p class="said">{LOOK_HELP.bandWords}</p>
        {/if}
      </div>
    </div>
  </FloatingMenu>
{/if}

{#snippet day()}
  <label class="field" title={LOOK_HELP.date}>
    <span>Day</span>
    <input class="input" type="date" value={whole.cover.date} title={LOOK_HELP.date}
      onchange={(event) => set({ cover: { date: event.currentTarget.value } })} />
  </label>
{/snippet}

<style>
  .look-open { gap: 5px; }
  .look-open.on { color: var(--text-1); background: var(--bg-3); }
  .current { color: var(--text-3); font-size: var(--fs-xs); margin-left: 2px; }
  .look { display: flex; flex-direction: column; gap: 10px; padding: 6px 6px 8px; font-size: var(--fs-sm); }
  .part { display: flex; flex-direction: column; gap: 6px; }
  .row { display: flex; align-items: center; gap: 10px; }
  .part-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .fonts { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 5px; }
  .font-card {
    display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; padding: 6px 3px 5px;
    border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-2); color: var(--text-1); cursor: pointer; font: inherit;
  }
  .font-card:hover { border-color: var(--border-strong); }
  .font-card.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .font-ag { font-size: 19px; line-height: 1.1; }
  .font-name {
    max-width: 100%; color: var(--text-2); font-size: 10px; line-height: 1.2; text-align: center; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .font-card.on .font-name { color: var(--text-1); }
  .key { color: var(--text-3); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; min-width: 52px; }
  .styles { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .style-card {
    display: flex; flex-direction: column; gap: 2px; padding: 7px 9px; border: 1px solid var(--border); border-radius: var(--r-md);
    background: var(--bg-2); color: var(--text-1); text-align: left; cursor: pointer; font: inherit;
  }
  .style-card:hover { border-color: var(--border-strong); }
  .style-card.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .style-name { font-weight: 600; font-size: var(--fs-sm); }
  .style-note { color: var(--text-3); font-size: 11px; line-height: 1.3; }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
  .seg button {
    padding: 3px 12px; border: none; border-left: 1px solid var(--border); background: var(--bg-2); color: var(--text-2);
    font: inherit; font-size: var(--fs-xs); cursor: pointer;
  }
  .seg button:first-child { border-left: none; }
  .seg button.on { background: var(--accent); color: var(--accent-text); font-weight: 600; }
  .accent { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; min-width: 0; }
  .accent input[type='color'] {
    flex: none; width: 28px; height: 22px; padding: 0; border: 1px solid var(--border); border-radius: var(--r-sm); background: none; cursor: pointer;
  }
  .accent input.unset { opacity: .45; }
  .swatch { flex: none; width: 15px; height: 15px; padding: 0; border: 1px solid rgba(0, 0, 0, .25); border-radius: 50%; cursor: pointer; }
  .swatch.on { box-shadow: 0 0 0 2px var(--bg-1), 0 0 0 3px var(--accent); }
  .own {
    padding: 2px 7px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); color: var(--text-2);
    font: inherit; font-size: 11px; cursor: pointer;
  }
  .own.on { color: var(--text-1); border-color: var(--accent); }
  .tlps { display: flex; flex-wrap: wrap; gap: 4px; }
  .tlp {
    padding: 2px 7px; border: 1px solid #000; border-radius: var(--r-sm); background: #000; font: inherit; font-family: var(--font-mono);
    font-size: 10.5px; font-weight: 700; letter-spacing: .02em; cursor: pointer; opacity: .55;
  }
  .tlp.none { background: var(--bg-2); border-color: var(--border); color: var(--text-2); font-family: inherit; font-weight: 500; }
  .tlp:hover, .tlp.on { opacity: 1; }
  .tlp.on { box-shadow: 0 0 0 2px var(--bg-1), 0 0 0 3px var(--accent); }
  .sep { height: 1px; background: var(--border); margin: 2px 0; }
  .check { display: flex; align-items: center; gap: 8px; color: var(--text-1); cursor: pointer; }
  .check input { accent-color: var(--accent); margin: 0; }
  .switch { position: relative; display: flex; align-items: center; gap: 8px; color: var(--text-1); cursor: pointer; }
  /* the box lies over the track, unseen, so the track is what is pressed */
  .switch input { position: absolute; left: 0; width: 26px; height: 15px; margin: 0; opacity: 0; cursor: pointer; z-index: 1; }
  .track {
    position: relative; flex: none; width: 26px; height: 15px; border-radius: 999px; background: var(--bg-3);
    box-shadow: inset 0 0 0 1px var(--border-strong); transition: background .15s;
  }
  .knob {
    position: absolute; top: 2px; left: 2px; width: 11px; height: 11px; border-radius: 50%; background: var(--text-3);
    transition: transform .15s var(--ease);
  }
  .switch input:checked + .track { background: var(--accent); box-shadow: none; }
  .switch input:checked + .track .knob { transform: translateX(11px); background: var(--accent-text); }
  .switch input:focus-visible + .track { outline: 2px solid var(--accent); outline-offset: 2px; }
  .cover { display: flex; flex-direction: column; gap: 7px; margin: -2px 0 2px 62px; }
  .said { margin: 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.4; }
  .field { display: flex; flex-direction: column; gap: 3px; color: var(--text-3); font-size: var(--fs-xs); }
  .field .input { font-size: var(--fs-sm); }
  .picked { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .pick { flex: 1; min-width: 0; justify-content: flex-start; }
  .pick span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pictures { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
  .picture-list { max-height: 170px; overflow: auto; display: flex; flex-direction: column; }
  .picture-row {
    display: flex; align-items: center; gap: 6px; padding: 4px 6px; border: none; border-radius: var(--r-sm); background: none;
    color: var(--text-1); font: inherit; font-size: var(--fs-sm); text-align: left; cursor: pointer;
  }
  .picture-row:hover, .picture-row.on { background: var(--bg-3); }
  .picture-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .none { margin: 4px 6px; color: var(--text-3); font-size: var(--fs-xs); }
  .fold {
    display: flex; align-items: center; gap: 6px; padding: 0; border: none; background: none; color: var(--text-2); font: inherit; cursor: pointer;
  }
  .fold:hover { color: var(--text-1); }
  .fold .key { min-width: 0; cursor: inherit; }
  .fold .current { margin-left: 0; }
  .band { display: flex; flex-direction: column; gap: 4px; }
  .slots { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .slot { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .slot-head { display: flex; align-items: center; justify-content: space-between; min-height: 16px; color: var(--text-3); font-size: 11px; }
  .slot .input { min-width: 0; font-size: var(--fs-xs); padding: 3px 6px; }
  .slot-logo, .chip-x {
    display: inline-flex; align-items: center; justify-content: center; padding: 1px 3px; border: none; border-radius: var(--r-sm);
    background: none; color: var(--text-3); cursor: pointer;
  }
  .slot-logo:hover, .slot-logo.on, .chip-x:hover { color: var(--text-1); background: var(--bg-3); }
  .slot-chip {
    display: flex; align-items: center; justify-content: space-between; gap: 4px; min-width: 0; padding: 3px 4px 3px 8px;
    border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-3); color: var(--text-1); font-size: var(--fs-xs);
  }
  .slot-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .logo-pick { display: flex; flex-direction: column; }
</style>
