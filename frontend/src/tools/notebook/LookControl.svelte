<script>
  /**
   * How a note prints, set from the editor's header: its style, page size,
   * accent, marking, cover, contents and numbering. Each change is handed up at
   * once (`onchange`), which saves it beside the note and draws the Page pane
   * again. A template's look keeps no picture and no day of a case.
   *
   * The hover texts live in `lib/notes/lookHelp.js`.
   */
  import { LOOK_HELP } from '../../lib/notes/lookHelp.js';
  import { PAGES, STYLES, SUBTITLE_MAX, TLPS, normaliseLook, styleLabel } from '../../lib/notes/look.js';
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
  let subtitleTimer;

  const whole = $derived(normaliseLook(look));
  $effect(() => { subtitle = whole.cover.subtitle; });

  const pictures = $derived(entities
    .filter((entity) => (entity.type === 'media' || entity.type === 'capture') && entity.attrs?.path && entity.attrs?.kind !== 'video')
    .filter((entity) => foldText(entity.label).includes(foldText(pictureQuery.trim())))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, 60));
  const coverPicture = $derived(entities.find((entity) => entity.id === whole.cover.image) ?? null);
  const swatches = $derived(recentColours.list.slice(0, 6));

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

  function pickPicture(entity) {
    picking = false;
    pictureQuery = '';
    set({ cover: { image: entity?.id ?? '' } });
  }

  function close() {
    commitSubtitle();
    anchor = null;
    picking = false;
  }
</script>

<button type="button" class="btn btn-ghost btn-sm look-open" class:on={anchor} {disabled} aria-haspopup="dialog" aria-expanded={Boolean(anchor)}
  title={LOOK_HELP.open} data-guide="notebook.look"
  onclick={(event) => (anchor ? close() : (anchor = event.currentTarget))}>
  <Icon name="brush" size={14} /> Look<span class="current">{styleLabel(whole.style)}</span>
</button>

{#if anchor}
  <FloatingMenu {anchor} align="end" width={330} role="dialog" label="Look" onclose={close}>
    <div class="look">
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

      <label class="check" title={LOOK_HELP.cover}>
        <input type="checkbox" checked={whole.cover.on} title={LOOK_HELP.cover} onchange={(event) => set({ cover: { on: event.currentTarget.checked } })} />
        Cover page
      </label>
      {#if whole.cover.on}
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
            <label class="field" title={LOOK_HELP.date}>
              <span>Day</span>
              <input class="input" type="date" value={whole.cover.date} title={LOOK_HELP.date}
                onchange={(event) => set({ cover: { date: event.currentTarget.value } })} />
            </label>
          {/if}
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
    </div>
  </FloatingMenu>
{/if}

<style>
  .look-open { gap: 5px; }
  .look-open.on { color: var(--text-1); background: var(--bg-3); }
  .current { color: var(--text-3); font-size: var(--fs-xs); margin-left: 2px; }
  .look { display: flex; flex-direction: column; gap: 10px; padding: 6px 6px 8px; font-size: var(--fs-sm); }
  .part { display: flex; flex-direction: column; gap: 6px; }
  .row { display: flex; align-items: center; gap: 10px; }
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
  .cover { display: flex; flex-direction: column; gap: 7px; margin: -2px 0 2px 22px; }
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
</style>
