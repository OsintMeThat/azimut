<script module>
  /** The tab the panel last stood on, which the next one opens on: kept for the visit, never stored. */
  let lastTab = 'style';
  let made = 0;
</script>

<script>
  /**
   * How a note prints, set from the editor's header: a panel of five tabs, one
   * section at a time. Style (what the document is for: Report, Web article, Brief,
   * Journal or Plain, each in a line; then what it includes, folded into one line until
   * Change… opens it: the sources and which list the document ends on (the generated
   * one, the note's own section or both, following the note until set), the five
   * annexes, how its sources are written and how strictly its links are checked, each
   * the style's own until changed here and marked so with a Reset; the contents
   * and numbering switches; and the HTML page's layout, an article or a story),
   * Text (size and typeface), Page (paper, accent, marking), Cover and the page's
   * Header & footer. A tab whose section holds something set wears a dot. Each
   * change is handed up at once (`onchange`), which saves it beside the note and
   * draws the Page pane again. A template's look keeps no picture and no day of a
   * case. The panel stays under its button and left of the Notebook's Page pane, scrolled
   * in the room there, so the pages it is changing stay in view (`FloatingMenu`, `below`
   * and `clear`).
   *
   * Each typeface is shown in its own face, loaded from the server when the Text
   * tab first shows (`lib/notes/noteFonts.js`). The hover texts live in
   * `lib/notes/lookHelp.js`.
   *
   * The header and the footer are three one-line slots each, which wait for a
   * pause or the field's end like the subtitle does, or hold a logo in place of
   * words. A band left empty shows what the style prints there.
   */
  import { tick, untrack } from 'svelte';
  import { LOOK_HELP } from '../../lib/notes/lookHelp.js';
  import {
    ANNEXES, BANDS, BAND_MAX, COVERS, FONTS, LINK_CHECKS, PAGES, SIZES, SLOTS, SLOT_LOGOS, SOURCES_LISTS, SOURCES_STYLES, STYLES, SUBTITLE_MAX, TLPS,
    OWN_SECTIONS, WEBS, annexListOf, bandStyleOwn, coverChoice, coverFor, includesSummary, lookFont, normaliseLook, ownSection, ownSources, profileChanged,
    profileOf, sectionsSet, slotText, styleLabel, styleOwn as ownWords, stylesTable, withProfile,
  } from '../../lib/notes/look.js';
  import { prefs } from '../../lib/state.svelte.js';
  import { faceFamily, loadNoteFont, noteFonts } from '../../lib/notes/noteFonts.js';
  import { recentColours } from '../../lib/recentColours.svelte.js';
  import { COUNTER_SAID, COUNTER_STEPS, GOATCOUNTER_SIGNUP, counterCode } from '../../lib/goatcounterSetup.js';
  import { foldText } from '../../lib/textFold.js';
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import HexField from '../../components/HexField.svelte';

  /** `text` is the note's, read for a Sources or References heading of its own. */
  let { look = null, onchange, template = false, entities = [], disabled = false, text = '' } = $props();

  // the panel follows the space: a window narrower than it is wide (the extension's panel) gets a narrower one
  let viewport = $state(typeof window === 'undefined' ? 1024 : window.innerWidth);
  const panelWidth = $derived(Math.max(240, Math.min(440, viewport - 16)));

  let anchor = $state(null);
  /** The Page pane beside the note in the Notebook, which the panel leaves in view. */
  let pane = $state(null);
  let subtitle = $state('');
  let picking = $state(false);
  let pictureQuery = $state('');
  let panel = $state(null);
  let fonts = $state(FONTS);
  /** The faces drawn so far, by key. */
  let faces = $state({});
  let subtitleTimer;
  let tab = $state(lastTab);
  /** What it includes, open past its one line: folded again each time the panel opens. */
  let includesOpen = $state(false);
  const uid = `look-${(made += 1)}`;
  const TABS = [
    { id: 'style', label: 'Style', title: LOOK_HELP.tabStyle },
    { id: 'text', label: 'Text', title: LOOK_HELP.tabText },
    { id: 'page', label: 'Page', title: LOOK_HELP.tabPage },
    { id: 'cover', label: 'Cover', title: LOOK_HELP.cover },
    { id: 'bands', label: 'Header & footer', title: LOOK_HELP.bands },
  ];
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
  const marked = $derived(sectionsSet(whole));
  /** What each style carries on this machine (Settings › Publishing › Styles), and what this note carries. */
  const table = $derived(stylesTable(prefs.noteStyles));
  const profile = $derived(profileOf(whole, table));
  const changed = $derived(profileChanged(whole));
  const ANNEX_HELP = {
    geolocations: LOOK_HELP.annexGeolocations, credits: LOOK_HELP.annexCredits, method: LOOK_HELP.annexMethod,
    limits: LOOK_HELP.annexLimits, editions: LOOK_HELP.annexEditions,
  };
  const SOURCES_HELP = { academic: LOOK_HELP.sourcesAcademic, web: LOOK_HELP.sourcesWeb, short: LOOK_HELP.sourcesShort };
  const LIST_HELP = { generated: LOOK_HELP.sourcesListGenerated, own: LOOK_HELP.sourcesListOwn, both: LOOK_HELP.sourcesListBoth };
  const ANNEX_LIST_HELP = { generated: LOOK_HELP.annexListGenerated, own: LOOK_HELP.annexListOwn, both: LOOK_HELP.annexListBoth };
  /** The list the note ends on unless the look says: its own section once it has a Sources or References heading. */
  const followed = $derived(ownSources(text) ? 'own' : 'generated');
  const listing = $derived(whole.sources_list || followed);
  /** The same for the two annexes a note may write its own section of: what it follows, what it prints. */
  const annexFollowed = $derived(Object.fromEntries(Object.keys(OWN_SECTIONS).map((which) => [which, ownSection(text, which) ? 'own' : 'generated'])));
  const annexLists = $derived(Object.fromEntries(Object.keys(OWN_SECTIONS).map((which) => [which, annexListOf(whole, text, which)])));
  const ANNEX_LISTS = {
    method: { label: 'Method section', help: LOOK_HELP.methodList, auto: LOOK_HELP.methodListAuto },
    geolocations: { label: 'Geolocations section', help: LOOK_HELP.geolocationsList, auto: LOOK_HELP.geolocationsListAuto },
  };
  const summary = $derived(includesSummary(profile, listing, annexLists));
  const CHECK_HELP = { each: LOOK_HELP.linkEach, grouped: LOOK_HELP.linkGrouped };

  /** One profile switch for this note, or back to its style's (`null`). */
  function setProfile(key, value) {
    const next = withProfile(whole, key, value);
    if (JSON.stringify(next) !== JSON.stringify(whole)) onchange?.(next);
  }
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

  // the faces are asked for when the Text tab shows, and kept for the tab
  $effect(() => {
    if (!anchor || tab !== 'text') return;
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

  /** Open the panel on the tab last used, that tab in focus, so the arrows move between sections and Tab goes into one. */
  async function open(button) {
    tab = lastTab;
    includesOpen = false;
    pane = button.closest('.notebook')?.querySelector('.page-pane') ?? null;
    anchor = button;
    await tick();
    panel?.querySelector('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
  }

  function choose(id) {
    tab = id;
    lastTab = id;
  }

  /** The arrows, Home and End move along the tabs, each shown as it is reached. */
  function tabKey(event) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key) || !event.target.closest?.('[role="tab"]')) return;
    const at = TABS.findIndex((item) => item.id === tab);
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1
      : (at + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    event.preventDefault();
    choose(TABS[to].id);
    event.currentTarget.querySelectorAll('[role="tab"]')[to]?.focus();
  }

  function set(change) {
    const next = normaliseLook({ ...whole, ...change, cover: { ...whole.cover, ...(change.cover ?? {}) } });
    if (JSON.stringify(next) !== JSON.stringify(whole)) onchange?.(next);
  }

  function accent(hex) {
    set({ accent: hex ?? '' });
    if (hex) recentColours.keep(hex);
  }

  /** What the counter's field holds, kept once it is left, and whether what it holds names no site. */
  let counterDraft = $state('');
  let counterWrong = $state(false);
  $effect(() => { counterDraft = whole.counter ?? ''; });
  function commitCounter() {
    const code = counterCode(counterDraft);
    if (code === null) { counterWrong = true; return; }
    counterWrong = false;
    counterDraft = code;
    set({ counter: code });
  }
  const WEB_HELP = { '': LOOK_HELP.webArticle, story: LOOK_HELP.webStory, map: LOOK_HELP.webMap };

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
  <Icon name="brush" size={14} /> <span class="word">Look</span><span class="current">{styleLabel(whole.style)}</span>
</button>

<svelte:window bind:innerWidth={viewport} />

{#if anchor}
  <FloatingMenu {anchor} align="end" below clear={pane} width={panelWidth} role="dialog" label="Look" onclose={close}>
    <div class="look" class:narrow={panelWidth < 420} bind:this={panel}>
      <div class="tabs" role="tablist" aria-label="Look sections" tabindex="-1" onkeydown={tabKey}>
        {#each TABS as item (item.id)}
          <button type="button" class="tab" class:on={tab === item.id} role="tab" id={`${uid}-tab-${item.id}`} aria-selected={tab === item.id}
            aria-controls={`${uid}-section`} tabindex={tab === item.id ? 0 : -1} title={item.title} onclick={() => choose(item.id)}>
            {item.label}{#if marked[item.id]}<span class="dot" role="img" aria-label="Set" title={LOOK_HELP.tabSet}></span>{/if}
          </button>
        {/each}
      </div>

      <div class="section" role="tabpanel" id={`${uid}-section`} aria-labelledby={`${uid}-tab-${tab}`}>
        {#if tab === 'style'}
          <div class="stack">
            <span class="key" title={LOOK_HELP.for}>For</span>
            <div class="styles" role="radiogroup" aria-label="For" title={LOOK_HELP.style}>
              {#each STYLES as style (style.id)}
                <button type="button" class="style-card" class:on={whole.style === style.id} role="radio" aria-checked={whole.style === style.id}
                  data-style={style.id} title={`${style.label}: ${style.note}`} onclick={() => set({ style: style.id })}>
                  <span class="style-name">{style.label}</span><span class="style-note">{style.note}</span>
                </button>
              {/each}
            </div>
            <p class="said">{LOOK_HELP.forSaid}.</p>
          </div>
          <div class="group" role="group" aria-label="In the document">
            <span class="key">In the document</span>
            {@render toggle('Contents page', LOOK_HELP.toc, whole.toc, (on) => set({ toc: on }))}
            {@render toggle('Numbered headings', LOOK_HELP.numbered, whole.numbered, (on) => set({ numbered: on }))}
          </div>
          <div class="group includes" role="group" aria-label="What it includes">
            <div class="includes-head">
              <span class="key" title={LOOK_HELP.includes}>What it includes</span>
              {#if includesOpen}
                <button type="button" class="fold" aria-expanded="true" aria-controls={`${uid}-includes`} title={LOOK_HELP.includesFold}
                  onclick={() => (includesOpen = false)}>Fold</button>
              {/if}
            </div>
            {#if includesOpen}
              <div class="includes-body" id={`${uid}-includes`}>
                {@render switchRow('sources', 'Sources', listing === 'own' ? 'links checked' : 'numbered, linked', LOOK_HELP.sources)}
                {#if profile.sources}{@render listRow()}{/if}
                {#each ANNEXES as annex (annex.id)}
                  {@render switchRow(annex.id, annex.label, annex.note, ANNEX_HELP[annex.id])}
                  {#if ANNEX_LISTS[annex.id] && profile[annex.id]}{@render annexListRow(annex.id)}{/if}
                {/each}
                {@render segRow('sources_style', 'Sources written as', SOURCES_STYLES, SOURCES_HELP, LOOK_HELP.sourcesStyle)}
                {@render segRow('link_check', 'Link check', LINK_CHECKS, CHECK_HELP, LOOK_HELP.linkCheck)}
              </div>
            {:else}
              <button type="button" class="summary" aria-expanded="false" aria-controls={`${uid}-includes`} title={LOOK_HELP.includesChange}
                onclick={() => (includesOpen = true)}>
                <span class="summary-words">{summary}</span><span class="change">Change…</span>
              </button>
            {/if}
          </div>
          <div class="row web">
            <span class="key" title={LOOK_HELP.web}>Web page</span>
            <div class="seg" role="radiogroup" aria-label="Web page" title={LOOK_HELP.web}>
              {#each WEBS as web (web.id)}
                <button type="button" class:on={whole.web === web.id} role="radio" aria-checked={whole.web === web.id}
                  title={WEB_HELP[web.id]} onclick={() => set({ web: web.id })}>{web.label}</button>
              {/each}
            </div>
          </div>
          {#if whole.web === 'map'}
            <!-- a map page's one setting of its own: the reader count, optional, its setup said here -->
            <div class="map-page">
              <p class="said">{LOOK_HELP.webMap}.</p>
              <label class="row" title={LOOK_HELP.counter}>
                <span class="key">View counter</span>
                <input class="input" value={counterDraft} placeholder="GoatCounter code" spellcheck="false" autocomplete="off"
                  aria-invalid={counterWrong} title={LOOK_HELP.counter}
                  oninput={(event) => { counterDraft = event.currentTarget.value; counterWrong = false; }} onblur={commitCounter}
                  onkeydown={(event) => { if (event.key === 'Enter') commitCounter(); }} />
              </label>
              {#if counterWrong}<p class="said wrong">That is not a GoatCounter code: letters, digits and hyphens, as in mycode.goatcounter.com.</p>{/if}
              <details class="counter-how">
                <summary>How to get one</summary>
                <ol>
                  {#each COUNTER_STEPS as [step, how] (step)}<li><b>{step}.</b> {how}</li>{/each}
                </ol>
                <p class="said">{COUNTER_SAID} <a href={GOATCOUNTER_SIGNUP} target="_blank" rel="noreferrer">Open GoatCounter</a></p>
              </details>
            </div>
          {/if}
          <p class="said settings-said" title={LOOK_HELP.stylesSettings}><Icon name="settings" size={12} /> What each style carries by default: Settings › Publishing › Styles</p>

        {:else if tab === 'text'}
          <div class="row">
            <span class="key" title={LOOK_HELP.size}>Size</span>
            <div class="seg" role="radiogroup" aria-label="Text size">
              {#each SIZES as size (size.id)}
                <button type="button" class:on={whole.size === size.id} role="radio" aria-checked={whole.size === size.id}
                  title={LOOK_HELP.size} onclick={() => set({ size: size.id })}>{size.label}</button>
              {/each}
            </div>
          </div>
          <div class="stack">
            <span class="key" title={LOOK_HELP.font}>Typeface</span>
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

        {:else if tab === 'page'}
          <div class="row">
            <span class="key" title={LOOK_HELP.page}>Paper</span>
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
          <div class="row top">
            <span class="key" title={LOOK_HELP.tlp}>Marking</span>
            <div class="tlps" role="radiogroup" aria-label="TLP marking">
              {#each TLPS as tlp (tlp.id)}
                <button type="button" class="tlp" class:on={whole.tlp === tlp.id} class:none={!tlp.id} role="radio" aria-checked={whole.tlp === tlp.id}
                  style:color={tlp.colour} title={tlp.id ? `${LOOK_HELP.tlp}: TLP:${tlp.label}` : LOOK_HELP.tlp}
                  onclick={() => set({ tlp: tlp.id })}>{tlp.id ? `TLP:${tlp.label}` : tlp.label}</button>
              {/each}
            </div>
          </div>

        {:else if tab === 'cover'}
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
            <label class="row" title={LOOK_HELP.subtitle}>
              <span class="key">Subtitle</span>
              <input class="input" value={subtitle} maxlength={SUBTITLE_MAX} placeholder="A line under the title" title={LOOK_HELP.subtitle}
                oninput={(event) => typedSubtitle(event.currentTarget.value)} onblur={commitSubtitle}
                onkeydown={(event) => { if (event.key === 'Enter') commitSubtitle(); }} />
            </label>
            {#if !template}
              <div class="row top" title={LOOK_HELP.image}>
                <span class="key">Picture</span>
                <div class="picture">
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
              </div>
              {@render day()}
            {/if}
          {:else if coverIs === 'own'}
            <p class="said">{LOOK_HELP.coverOwn}.</p>
            <p class="said">{LOOK_HELP.coverCorner}.</p>
            <div class="row">
              <span class="key" title={LOOK_HELP.centred}>Position</span>
              {@render toggle('Centred down the page', LOOK_HELP.centred, !whole.cover.top, (on) => set({ cover: { top: !on } }))}
            </div>
            {#if !template}{@render day()}{/if}
          {/if}

        {:else}
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

{#snippet toggle(label, help, checked, change)}
  <label class="switch" title={help}>
    <input type="checkbox" role="switch" {checked} title={help} onchange={(event) => change(event.currentTarget.checked)} />
    <span class="track" aria-hidden="true"><span class="knob"></span></span>
    {label}
  </label>
{/snippet}

{#snippet own(key)}
  {#if changed[key]}
    <span class="own-said changed">Changed here ·
      <button type="button" class="reset" title={LOOK_HELP.profileReset} aria-label={`Reset to ${ownWords(whole.style)}`}
        onclick={() => setProfile(key, null)}>Reset</button></span>
  {:else}
    <span class="own-said">{ownWords(whole.style)}</span>
  {/if}
{/snippet}

{#snippet switchRow(key, label, note, help)}
  <div class="include" data-include={key}>
    <label class="switch" title={help}>
      <input type="checkbox" role="switch" checked={profile[key]} title={help}
        onchange={(event) => setProfile(key, event.currentTarget.checked === table[whole.style][key] ? null : event.currentTarget.checked)} />
      <span class="track" aria-hidden="true"><span class="knob"></span></span>
      <span class="include-label">{label} <span class="include-note">{note}</span></span>
    </label>
    {@render own(key)}
  </div>
{/snippet}

{#snippet segRow(key, label, choices, helps, help)}
  <div class="include seg-row" data-include={key}>
    <span class="include-label" title={help}>{label}</span>
    <div class="seg" role="radiogroup" aria-label={label} title={help}>
      {#each choices as choice (choice.id)}
        <button type="button" class:on={profile[key] === choice.id} role="radio" aria-checked={profile[key] === choice.id}
          title={helps[choice.id]} onclick={() => setProfile(key, choice.id === table[whole.style][key] ? null : choice.id)}>{choice.label}</button>
      {/each}
    </div>
    {@render own(key)}
  </div>
{/snippet}

{#snippet listRow()}
  <div class="include seg-row list-row" data-include="sources_list">
    <span class="include-label" title={LOOK_HELP.sourcesList}>Sources list</span>
    <div class="seg" role="radiogroup" aria-label="Sources list" title={LOOK_HELP.sourcesList}>
      {#each SOURCES_LISTS as choice (choice.id)}
        <button type="button" class:on={listing === choice.id} role="radio" aria-checked={listing === choice.id} title={LIST_HELP[choice.id]}
          onclick={() => set({ sources_list: choice.id === followed ? '' : choice.id })}>{choice.label}</button>
      {/each}
    </div>
    {#if whole.sources_list}
      <span class="own-said changed">Changed here ·
        <button type="button" class="reset" title={LOOK_HELP.sourcesListReset} aria-label="Reset to following the note"
          onclick={() => set({ sources_list: '' })}>Reset</button></span>
    {:else}
      <span class="own-said" title={LOOK_HELP.sourcesListAuto}>Follows the note</span>
    {/if}
  </div>
{/snippet}

{#snippet annexListRow(which)}
  {@const key = OWN_SECTIONS[which].key}
  {@const said = ANNEX_LISTS[which]}
  <div class="include seg-row list-row" data-include={key}>
    <span class="include-label" title={said.help}>{said.label}</span>
    <div class="seg" role="radiogroup" aria-label={said.label} title={said.help}>
      {#each SOURCES_LISTS as choice (choice.id)}
        <button type="button" class:on={annexLists[which] === choice.id} role="radio" aria-checked={annexLists[which] === choice.id}
          title={ANNEX_LIST_HELP[choice.id]} onclick={() => set({ [key]: choice.id === annexFollowed[which] ? '' : choice.id })}>{choice.label}</button>
      {/each}
    </div>
    {#if whole[key]}
      <span class="own-said changed">Changed here ·
        <button type="button" class="reset" title={LOOK_HELP.sourcesListReset} aria-label="Reset to following the note"
          onclick={() => set({ [key]: '' })}>Reset</button></span>
    {:else}
      <span class="own-said" title={said.auto}>Follows the note</span>
    {/if}
  </div>
{/snippet}

{#snippet day()}
  <label class="row" title={LOOK_HELP.date}>
    <span class="key">Day</span>
    <input class="input" type="date" value={whole.cover.date} title={LOOK_HELP.date}
      onchange={(event) => set({ cover: { date: event.currentTarget.value } })} />
  </label>
{/snippet}

<style>
  .look-open { gap: 5px; }
  .look-open.on { color: var(--text-1); background: var(--bg-3); }
  .current { color: var(--text-3); font-size: var(--fs-xs); margin-left: 2px; }
  .look { display: flex; flex-direction: column; font-size: var(--fs-sm); }

  /* the sections, one at a time */
  .tabs { display: flex; flex-wrap: wrap; gap: 0 2px; padding: 0 2px; border-bottom: 1px solid var(--border); }
  .tab {
    display: inline-flex; align-items: center; margin-bottom: -1px; padding: 8px 10px 7px; border: none; border-bottom: 2px solid transparent;
    background: none; color: var(--text-3); font: inherit; font-size: var(--fs-xs); font-weight: 600; white-space: nowrap; cursor: pointer;
  }
  /* in a narrow panel the five tabs share the width: tighter, then onto a second row rather than cut */
  .narrow .tab { padding: 8px 6px 7px; }
  .narrow .section { padding-left: 4px; padding-right: 4px; }
  .tab:hover { color: var(--text-1); }
  .tab.on { color: var(--text-1); border-bottom-color: var(--accent); }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: var(--r-sm); }
  .dot { flex: none; width: 6px; height: 6px; margin-left: 6px; border-radius: 50%; background: var(--accent); }
  .section { display: flex; flex-direction: column; gap: 16px; padding: 16px 8px 8px; }

  /* a label on the left and its control on the right, on one column */
  .row { display: grid; grid-template-columns: 72px minmax(0, 1fr); align-items: center; gap: 8px; color: var(--text-3); font-size: var(--fs-xs); }
  .row.top { align-items: start; }
  .row.top > .key { padding-top: 5px; }
  .stack { display: flex; flex-direction: column; gap: 8px; }
  .key { color: var(--text-3); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .row .input { min-width: 0; font-size: var(--fs-sm); }
  .group, .web { padding-top: 16px; border-top: 1px solid var(--border); }
  .group { display: flex; flex-direction: column; gap: 8px; }
  /* what it includes: one line until Change… opens the switches under it */
  .includes-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .includes-body { display: flex; flex-direction: column; gap: 8px; }
  .fold {
    padding: 0; border: none; background: none; color: var(--text-2); font: inherit; font-size: 11px; text-decoration: underline; cursor: pointer;
  }
  .fold:hover { color: var(--text-1); }
  .summary {
    display: flex; align-items: baseline; justify-content: space-between; gap: 10px; width: 100%; padding: 7px 10px;
    border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-2); color: var(--text-1);
    font: inherit; font-size: var(--fs-sm); text-align: left; cursor: pointer;
  }
  .summary:hover { border-color: var(--border-strong); }
  .summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .summary-words { min-width: 0; }
  .change { flex: none; color: var(--text-2); font-size: var(--fs-xs); }
  .summary:hover .change { color: var(--text-1); }
  /* three choices beside their label: what the note follows goes under them rather than squeezing them */
  .list-row { flex-wrap: wrap; row-gap: 4px; }

  .fonts { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
  .font-card {
    display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; padding: 8px 3px 6px;
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
  .styles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  /* what the document includes: each switch on its line, the style's own or Changed here on the right */
  .include { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 22px; }
  .include .switch { flex: 1; min-width: 0; }
  .include-label { color: var(--text-1); font-size: var(--fs-sm); }
  .include-note { color: var(--text-3); font-size: var(--fs-xs); }
  .seg-row .include-label { flex: none; width: 118px; }
  .seg-row .seg { margin-right: auto; }
  .seg-row .seg button { padding: 4px 9px; }
  /* in a narrow panel the style's own goes under the choices rather than squeezing them */
  .narrow .seg-row { flex-wrap: wrap; }
  .own-said { flex: none; color: var(--text-3); font-size: 11px; white-space: nowrap; }
  .own-said.changed { color: var(--accent); }
  .reset { padding: 0; border: none; background: none; color: inherit; font: inherit; text-decoration: underline; cursor: pointer; }
  .settings-said { display: flex; align-items: center; gap: 6px; padding-top: 12px; border-top: 1px solid var(--border); }
  .style-card {
    display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--r-md);
    background: var(--bg-2); color: var(--text-1); text-align: left; cursor: pointer; font: inherit;
  }
  .style-card:hover { border-color: var(--border-strong); }
  .style-card.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .style-name { font-weight: 600; font-size: var(--fs-sm); }
  .style-note { color: var(--text-3); font-size: 11px; line-height: 1.3; }
  .seg { display: inline-flex; justify-self: start; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
  .seg button {
    padding: 4px 12px; border: none; border-left: 1px solid var(--border); background: var(--bg-2); color: var(--text-2);
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
  .switch { position: relative; display: flex; align-items: center; gap: 8px; color: var(--text-1); font-size: var(--fs-sm); cursor: pointer; }
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
  .said { margin: 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.4; }
  .said.wrong { color: var(--danger); }
  .map-page { display: flex; flex-direction: column; gap: 8px; margin-top: -4px; }
  .counter-how { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.45; }
  .counter-how > summary { width: fit-content; cursor: pointer; color: var(--text-2); }
  .counter-how ol { margin: 6px 0; padding-left: 18px; }
  .counter-how li + li { margin-top: 3px; }
  .counter-how b { color: var(--text-2); font-weight: 600; }
  .picture { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .picked { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .pick { flex: 1; min-width: 0; justify-content: flex-start; }
  .pick span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pictures { display: flex; flex-direction: column; gap: 4px; }
  .picture-list { max-height: 170px; overflow: auto; display: flex; flex-direction: column; }
  .picture-row {
    display: flex; align-items: center; gap: 6px; padding: 4px 6px; border: none; border-radius: var(--r-sm); background: none;
    color: var(--text-1); font: inherit; font-size: var(--fs-sm); text-align: left; cursor: pointer;
  }
  .picture-row:hover, .picture-row.on { background: var(--bg-3); }
  .picture-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .none { margin: 4px 6px; color: var(--text-3); font-size: var(--fs-xs); }

  /* the header and the footer: a label over each row of three slots */
  .band { display: flex; flex-direction: column; gap: 8px; }
  .slots { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .slot { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .slot-head { display: flex; align-items: center; justify-content: space-between; min-height: 16px; color: var(--text-3); font-size: 11px; }
  .slot .input { min-width: 0; font-size: var(--fs-xs); padding: 4px 6px; }
  .slot-logo, .chip-x {
    display: inline-flex; align-items: center; justify-content: center; padding: 1px 3px; border: none; border-radius: var(--r-sm);
    background: none; color: var(--text-2); cursor: pointer;
  }
  .slot-logo:hover, .slot-logo.on, .chip-x:hover { color: var(--text-1); background: var(--bg-3); }
  .chip-x:hover { background: var(--bg-2); }
  .slot-chip {
    display: flex; align-items: center; justify-content: space-between; gap: 4px; min-width: 0; padding: 4px 4px 4px 8px;
    border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-3); color: var(--text-1); font-size: var(--fs-xs);
  }
  .slot-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .logo-pick { display: flex; flex-direction: column; }
</style>
