<script>
  /**
   * Editor for one proof template, a proof's house style: the sample proof drawn in
   * it on the left, the settings on the right in the groups of Geo Proof's Style tab
   * (Page, Text, Footer, Signature, Colours). Content-free: it never holds panels,
   * marks, a legend's words or coordinates.
   *
   * `data` is the template's style (bindable); the parent owns save and delete.
   * Remount it per template with {#key} so the local palette is seeded again.
   *
   * A template opened here and saved untouched writes back what it held, the keys
   * this editor does not show included (a dragged logo's offsets, a handle's
   * opacity). `sceneBadge` and `footerCredits` stay null, which says nothing, until
   * their switch is pressed.
   */
  import { untrack } from 'svelte';
  import {
    ANNO_COLORS, BG, PANEL_DIRECTIONS, SIG_ANCHORS, SIG_OPACITY, SIG_SCALE, SIG_TEXT_SIZE,
    newAzimutMark, newSignature, newSignatureText, normalizeAzimutMark, normalizePreferredColors,
    normalizeProofStyle, normSpace, replacePreferredColor, textColors, FOOTER_LINE,
  } from '../lib/composer.js';
  import { PROOF_FONTS } from '../lib/proofFonts.js';
  import { PROOF_TEMPLATE_HELP as HELP } from '../lib/proofTemplateHelp.js';
  import { prefs } from '../lib/state.svelte.js';
  import Icon from './Icon.svelte';
  import ProofStylePreview from './ProofStylePreview.svelte';

  let { data = $bindable(), sampleLegend = null } = $props();
  // Fill what an older template never stated, keeping what it did.
  for (const [key, value] of Object.entries(normalizeProofStyle(data))) {
    if (!(key in data) || key === 'palette') data[key] = value;
  }

  // A few one-press grounds; the colour well covers anything else.
  const GROUNDS = [
    { colour: '#0d1117', name: 'Night' },
    { colour: '#000000', name: 'Black' },
    { colour: '#1b2a4a', name: 'Navy' },
    { colour: '#f4f1ea', name: 'Paper' },
    { colour: '#ffffff', name: 'White' },
  ];

  // Seven drawing colours. A shorter palette is completed from the shipped ones
  // without disturbing its saved order.
  let palette = $state(normalizePreferredColors([...(Array.isArray(data.palette) ? data.palette : []), ...ANNO_COLORS]));
  let picking = $state(null);
  let customColour = $state(ANNO_COLORS[0]);
  function commitPalette() {
    data.palette = [...palette];
    // Early template drafts stored legend content here. It belongs to proofs.
    delete data.notes;
    delete data.legendOrder;
  }
  commitPalette();
  function openColour(index) {
    picking = picking === index ? null : index;
    customColour = palette[index];
  }
  function replaceColour(colour) {
    if (picking == null) return;
    palette = replacePreferredColor(palette, picking, colour);
    commitPalette();
    picking = null;
  }

  const space = $derived(normSpace(data.space));
  function setSpace(key, value) {
    data.space = { ...space, [key]: Math.max(0, Math.min(200, Number(value) || 0)) };
  }
  const setNumber = (key, min, max) => (event) => {
    const number = Number(event.currentTarget.value);
    if (Number.isFinite(number)) data[key] = Math.max(min, Math.min(max, number));
  };

  // A slider's far end, past it when a template already holds more, so the thumb never jumps.
  const reach = (limit, value) => Math.max(limit, Number(value) || 0);

  const ground = $derived(data.bg ?? BG);
  const auto = $derived(textColors(ground));
  const footerOn = $derived(data.footerEnabled !== false);
  const textOn = $derived(data.footerText !== false);

  // The signature: corner, size and opacity. A new corner starts from the corner
  // itself, since an offset was measured from the old one.
  function setCorner(key, anchor) {
    data[key] = { ...data[key], anchor, dx: 0, dy: 0, xRatio: undefined, yRatio: undefined };
  }
  const mark = $derived(normalizeAzimutMark(data.azimutMark));
  function toggleMark(on) {
    data.azimutMark = on ? newAzimutMark(data.signature?.anchor ?? data.signatureText?.anchor ?? 'br') : null;
  }
  const setMark = (patch) => { data.azimutMark = { ...mark, ...patch }; };

  // The sample's legend: its words are each proof's own, so the sample can show it or
  // not. A start says which; another template shows one if it captions its pictures.
  let showLegend = $state(untrack(() => sampleLegend ?? data.captionsEnabled !== false));
  let logoMissing = $state(false);
  const handleSet = $derived(Boolean(prefs.signatureHandle?.trim()));
</script>

<div class="pte">
  <div class="pte-stage">
    <div class="pte-bar">
      <span class="pte-bar-title">Sample proof</span>
      <span class="pte-bar-hint">
        {#if data.signature || (data.signatureText && handleSet)}Drag the logo or the handle to place them.{/if}
      </span>
      <label class="pte-bar-check" title={HELP.sampleLegend}>
        <input type="checkbox" bind:checked={showLegend} /> Legend
      </label>
    </div>
    <div class="pte-canvas">
      <ProofStylePreview bind:style={data} legend={showLegend} interactive bind:logoMissing />
    </div>
  </div>

  <div class="pte-side">
    <section class="pte-group" aria-labelledby="pte-page">
      <h4 id="pte-page"><Icon name="image" size={13} /> Page</h4>
      <div class="pte-row" title={HELP.background}>
        <span class="pte-label">Background</span>
        <span class="pte-grounds">
          {#each GROUNDS as one (one.colour)}
            <button type="button" class="pte-ground" class:on={ground.toLowerCase() === one.colour}
              style:background={one.colour} title={one.name} aria-label={`Background ${one.name}`}
              onclick={() => (data.bg = one.colour)}></button>
          {/each}
          <input class="pte-well" type="color" value={ground} title="Another colour" aria-label="Background colour"
            oninput={(e) => (data.bg = e.currentTarget.value)} />
        </span>
      </div>
      <div class="pte-row" title={HELP.layout}>
        <span class="pte-label">Layout</span>
        <span class="pte-seg" role="radiogroup" aria-label="Layout">
          <button type="button" role="radio" aria-checked={data.layout !== 'free'} class:on={data.layout !== 'free'}
            onclick={() => (data.layout = 'grid')}>Grid</button>
          <button type="button" role="radio" aria-checked={data.layout === 'free'} class:on={data.layout === 'free'}
            onclick={() => (data.layout = 'free')}>Free</button>
        </span>
      </div>
      <div class="pte-row" title={HELP.direction}>
        <span class="pte-label">First two pictures</span>
        <span class="pte-seg" role="radiogroup" aria-label="First two pictures">
          {#each PANEL_DIRECTIONS as direction (direction.id)}
            {@const on = (data.panelDirection ?? 'horizontal') === direction.id}
            <button type="button" role="radio" aria-checked={on} class:on onclick={() => (data.panelDirection = direction.id)}>
              {direction.label}
            </button>
          {/each}
        </span>
      </div>
      <div class="pte-slider" title={HELP.outerMargin}>
        <span class="pte-label">Outer margin</span>
        <input type="range" min="0" max={reach(80, space.pad)} step="1" value={space.pad} aria-label="Outer margin"
          oninput={(e) => setSpace('pad', e.currentTarget.value)} />
        <span class="pte-val">{space.pad}</span>
      </div>
      <div class="pte-slider" title={HELP.betweenPictures}>
        <span class="pte-label">Between pictures</span>
        <input type="range" min="0" max={reach(80, space.gap)} step="1" value={space.gap} aria-label="Between pictures"
          oninput={(e) => setSpace('gap', e.currentTarget.value)} />
        <span class="pte-val">{space.gap}</span>
      </div>
      <div class="pte-slider" title={HELP.betweenRows}>
        <span class="pte-label">Between rows</span>
        <input type="range" min="0" max={reach(80, space.rowGap)} step="1" value={space.rowGap} aria-label="Between rows"
          oninput={(e) => setSpace('rowGap', e.currentTarget.value)} />
        <span class="pte-val">{space.rowGap}</span>
      </div>
    </section>

    <section class="pte-group" aria-labelledby="pte-text">
      <h4 id="pte-text"><Icon name="text" size={13} /> Text</h4>
      <div class="pte-row" title={HELP.font}>
        <span class="pte-label">Font</span>
        <select class="input pte-select" value={data.font} aria-label="Font"
          onchange={(e) => (data.font = e.currentTarget.value)}>
          {#each PROOF_FONTS as face (face.id)}<option value={face.id}>{face.label}</option>{/each}
        </select>
      </div>
      <label class="pte-check" title={HELP.bold}><input type="checkbox" checked={data.fontBold !== false}
        onchange={(e) => (data.fontBold = e.currentTarget.checked)} /> Labels, callouts and tags in bold</label>
      <label class="pte-check" title={HELP.captions}><input type="checkbox" checked={data.captionsEnabled !== false}
        onchange={(e) => (data.captionsEnabled = e.currentTarget.checked)} /> Caption new panels</label>
      <div class="pte-slider" title={HELP.captionSize}>
        <span class="pte-label">Caption size</span>
        <input type="range" min="8" max={reach(40, data.captionSize)} step="1" value={data.captionSize} aria-label="Caption size"
          oninput={setNumber('captionSize', 8, 80)} />
        <span class="pte-val">{data.captionSize}</span>
      </div>
      <div class="pte-row" title={HELP.captionColour}>
        <span class="pte-label">Caption colour</span>
        <span class="pte-colour">
          <input class="pte-well" type="color" value={data.captionColor ?? auto.dim} aria-label="Caption colour"
            oninput={(e) => (data.captionColor = e.currentTarget.value)} />
          {#if data.captionColor}
            <button type="button" class="pte-link" onclick={() => (data.captionColor = null)}>Auto</button>
          {:else}
            <span class="pte-said">Auto</span>
          {/if}
        </span>
      </div>
      <div class="pte-slider" title={HELP.legendSize}>
        <span class="pte-label">Legend size</span>
        <input type="range" min="8" max={reach(40, data.legendSize)} step="1" value={data.legendSize} aria-label="Legend size"
          oninput={setNumber('legendSize', 8, 80)} />
        <span class="pte-val">{data.legendSize}</span>
      </div>
      <label class="pte-check" title={HELP.sceneBadge}><input type="checkbox" checked={data.sceneBadge === true}
        onchange={(e) => (data.sceneBadge = e.currentTarget.checked)} /> Scene time on the picture</label>
      {#if data.sceneBadge == null}
        <p class="pte-hint">Not set, so each proof keeps its own.</p>
      {/if}
    </section>

    <section class="pte-group" aria-labelledby="pte-footer">
      <h4 id="pte-footer"><Icon name="alignBottom" size={13} /> Footer</h4>
      <label class="pte-check" title={HELP.footer}><input type="checkbox" checked={footerOn}
        onchange={(e) => (data.footerEnabled = e.currentTarget.checked)} /> Show footer</label>
      {#if footerOn}
        <div class="pte-slider" title={HELP.footerSize}>
          <span class="pte-label">Footer size</span>
          <input type="range" min="8" max={reach(60, data.footerSize)} step="1" value={data.footerSize} aria-label="Footer size"
            oninput={setNumber('footerSize', 8, 80)} />
          <span class="pte-val">{data.footerSize}</span>
        </div>
        <label class="pte-check" title={HELP.footerCoords}><input type="checkbox" checked={data.footerCoords === true}
          onchange={(e) => (data.footerCoords = e.currentTarget.checked)} /> Show coordinates</label>
        <label class="pte-check" title={HELP.footerText}><input type="checkbox" checked={textOn}
          onchange={(e) => (data.footerText = e.currentTarget.checked)} /> Show text</label>
        {#if textOn}
          <label class="pte-check" title={HELP.footerCredits}><input type="checkbox" checked={data.footerCredits === true}
            onchange={(e) => (data.footerCredits = e.currentTarget.checked)} /> Imagery credits</label>
          {#if data.footerCredits == null}
            <p class="pte-hint">Not set, so each proof keeps its own.</p>
          {/if}
          <input class="input pte-text" type="text" maxlength="200" placeholder={FOOTER_LINE}
            title={HELP.footerLine} aria-label="Footer text" bind:value={data.footer} />
        {/if}
        <div class="pte-row" title={HELP.footerColour}>
          <span class="pte-label">Colour</span>
          <span class="pte-colour">
            <input class="pte-well" type="color" value={data.footerColor ?? auto.faint} aria-label="Footer colour"
              oninput={(e) => (data.footerColor = e.currentTarget.value)} />
            {#if data.footerColor}
              <button type="button" class="pte-link" onclick={() => (data.footerColor = null)}>Auto</button>
            {:else}
              <span class="pte-said">Auto</span>
            {/if}
          </span>
        </div>
        <div class="pte-row" title={HELP.footerAlign}>
          <span class="pte-label">Alignment</span>
          <span class="pte-seg" role="radiogroup" aria-label="Footer alignment">
            <button type="button" role="radio" aria-checked={data.footerAlign !== 'right'} class:on={data.footerAlign !== 'right'}
              onclick={() => (data.footerAlign = 'left')}>Left</button>
            <button type="button" role="radio" aria-checked={data.footerAlign === 'right'} class:on={data.footerAlign === 'right'}
              onclick={() => (data.footerAlign = 'right')}>Right</button>
          </span>
        </div>
      {:else}
        <p class="pte-hint">No band under the pictures. Set the margins to 0 for the pictures alone.</p>
      {/if}
    </section>

    <section class="pte-group" aria-labelledby="pte-signature">
      <h4 id="pte-signature"><Icon name="edit" size={13} /> Signature</h4>
      <label class="pte-check" title={HELP.logo}><input type="checkbox" checked={Boolean(data.signature)}
        onchange={(e) => (data.signature = e.currentTarget.checked ? (data.signature ?? newSignature()) : null)} /> Logo</label>
      {#if data.signature}
        <div class="pte-nest">
          <div class="pte-corners" role="radiogroup" aria-label="Logo corner" title={HELP.logoCorner}>
            {#each SIG_ANCHORS as corner (corner.id)}
              <button type="button" role="radio" aria-checked={data.signature.anchor === corner.id}
                class:on={data.signature.anchor === corner.id} onclick={() => setCorner('signature', corner.id)}>{corner.label}</button>
            {/each}
          </div>
          <div class="pte-slider" title={HELP.logoSize}>
            <span class="pte-label">Size</span>
            <input type="range" min="0.03" max={reach(0.3, data.signature.scale)} step="0.01" value={data.signature.scale ?? SIG_SCALE} aria-label="Size"
              oninput={(e) => (data.signature = { ...data.signature, scale: Number(e.currentTarget.value) })} />
            <span class="pte-val">{Math.round((data.signature.scale ?? SIG_SCALE) * 100)}%</span>
          </div>
          <div class="pte-slider" title={HELP.logoOpacity}>
            <span class="pte-label">Opacity</span>
            <input type="range" min="0" max="1" step="0.05" value={data.signature.opacity ?? SIG_OPACITY} aria-label="Opacity"
              oninput={(e) => (data.signature = { ...data.signature, opacity: Number(e.currentTarget.value) })} />
            <span class="pte-val">{Math.round((data.signature.opacity ?? SIG_OPACITY) * 100)}%</span>
          </div>
          {#if logoMissing}
            <p class="pte-hint warn"><Icon name="alert" size={12} /> No logo saved yet. Add one in Settings → Publishing.</p>
          {/if}
        </div>
      {/if}

      <label class="pte-check" title={HELP.handle}><input type="checkbox" checked={Boolean(data.signatureText)}
        onchange={(e) => (data.signatureText = e.currentTarget.checked ? (data.signatureText ?? newSignatureText()) : null)} /> Add account handle</label>
      {#if data.signatureText}
        <div class="pte-nest">
          <div class="pte-corners" role="radiogroup" aria-label="Handle corner" title={HELP.handleCorner}>
            {#each SIG_ANCHORS as corner (corner.id)}
              <button type="button" role="radio" aria-checked={data.signatureText.anchor === corner.id}
                class:on={data.signatureText.anchor === corner.id} onclick={() => setCorner('signatureText', corner.id)}>{corner.label}</button>
            {/each}
          </div>
          <div class="pte-slider" title={HELP.handleSize}>
            <span class="pte-label">Size</span>
            <input type="range" min="12" max={reach(120, data.signatureText.size)} step="1" value={data.signatureText.size ?? SIG_TEXT_SIZE} aria-label="Handle size"
              oninput={(e) => (data.signatureText = { ...data.signatureText, size: Number(e.currentTarget.value) })} />
            <span class="pte-val">{data.signatureText.size ?? SIG_TEXT_SIZE}</span>
          </div>
          <div class="pte-row" title={HELP.handleColour}>
            <span class="pte-label">Colour</span>
            <input class="pte-well" type="color" value={data.signatureText.color ?? '#ffffff'} aria-label="Handle colour"
              oninput={(e) => (data.signatureText = { ...data.signatureText, color: e.currentTarget.value })} />
          </div>
          {#if !handleSet}
            <p class="pte-hint">Add your handle in Settings → Publishing.</p>
          {/if}
        </div>
      {/if}

      <label class="pte-check" title={HELP.mark}><input type="checkbox" checked={Boolean(mark)}
        onchange={(e) => toggleMark(e.currentTarget.checked)} /> Azimut mark</label>
      {#if mark}
        <div class="pte-nest">
          <div class="pte-corners" role="radiogroup" aria-label="Mark corner" title={HELP.markCorner}>
            {#each SIG_ANCHORS as corner (corner.id)}
              <button type="button" role="radio" aria-checked={mark.anchor === corner.id}
                class:on={mark.anchor === corner.id} onclick={() => setMark({ anchor: corner.id })}>{corner.label}</button>
            {/each}
          </div>
          <div class="pte-slider" title={HELP.markSize}>
            <span class="pte-label">Size</span>
            <input type="range" min="12" max={reach(96, mark.size)} step="1" value={mark.size} aria-label="Mark size"
              oninput={(e) => setMark({ size: Number(e.currentTarget.value) })} />
            <span class="pte-val">{mark.size}</span>
          </div>
          <label class="pte-check" title={HELP.markName}><input type="checkbox" checked={mark.name}
            onchange={(e) => setMark({ name: e.currentTarget.checked })} /> With the name</label>
        </div>
      {/if}
    </section>

    <section class="pte-group" aria-labelledby="pte-colours">
      <h4 id="pte-colours"><Icon name="brush" size={13} /> Drawing colours</h4>
      <div class="pte-palette" title={HELP.palette}>
        {#each palette as colour, i (colour)}
          <button type="button" class="pte-swatch" class:on={picking === i} style:background={colour}
            title={`Change ${colour}`} aria-label={`Change colour ${i + 1}, currently ${colour}`}
            onclick={() => openColour(i)}></button>
        {/each}
      </div>
      {#if picking != null}
        <div class="pte-pick">
          {#each ANNO_COLORS as colour (colour)}
            <button type="button" class="pte-swatch small" style:background={colour} title={colour}
              aria-label={`Use colour ${colour}`} onclick={() => replaceColour(colour)}></button>
          {/each}
          <input class="pte-well" type="color" bind:value={customColour} aria-label="Choose another colour"
            title="Another colour" onchange={(e) => replaceColour(e.currentTarget.value)} />
        </div>
      {:else}
        <p class="pte-hint">Press one to change it.</p>
      {/if}
    </section>
  </div>
</div>

<style>
  .pte {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    height: 100%;
    min-height: 0;
  }
  .pte-stage {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border-right: 1px solid var(--border);
    background:
      radial-gradient(circle at 1px 1px, rgba(148, 163, 196, 0.08) 1px, transparent 0) 0 0 / 22px 22px,
      var(--bg-0);
  }
  .pte-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-1);
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .pte-bar-title { font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-2); }
  .pte-bar-hint { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pte-bar-check { display: flex; align-items: center; gap: 5px; color: var(--text-2); cursor: pointer; }
  .pte-canvas { position: relative; flex: 1; min-height: 0; margin: 22px; }

  .pte-side { overflow-y: auto; padding: 4px 16px 16px; min-height: 0; }
  .pte-group { padding: 12px 0 14px; border-bottom: 1px solid var(--border); }
  .pte-group:last-child { border-bottom: 0; }
  .pte-group h4 {
    display: flex; align-items: center; gap: 6px; margin: 0 0 8px;
    font-size: var(--fs-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-2);
  }
  .pte-row, .pte-slider {
    display: flex; align-items: center; gap: 8px; min-height: 28px; margin-bottom: 4px;
    font-size: var(--fs-xs); color: var(--text-3);
  }
  .pte-label { width: 112px; flex-shrink: 0; white-space: nowrap; }
  .pte-slider input[type='range'] { flex: 1; min-width: 0; accent-color: var(--accent); }
  .pte-val { min-width: 32px; text-align: right; color: var(--text-2); font-variant-numeric: tabular-nums; }
  .pte-select { flex: 1; min-width: 0; font-size: var(--fs-xs); padding: 4px 6px; }
  .pte-text { width: 100%; margin: 4px 0 6px; font-size: var(--fs-xs); padding: 5px 8px; }
  .pte-check {
    display: flex; align-items: center; gap: 7px; margin: 6px 0; font-size: var(--fs-xs); color: var(--text-1); cursor: pointer;
  }
  .pte-hint { margin: 0 0 4px 21px; font-size: 11px; color: var(--text-3); line-height: 1.4; }
  .pte-hint.warn { color: var(--warn, #e0a33e); display: flex; align-items: center; gap: 5px; margin-left: 0; }
  .pte-nest { margin: 2px 0 8px 21px; }

  .pte-grounds { display: flex; align-items: center; gap: 6px; }
  .pte-ground, .pte-swatch {
    width: 22px; height: 22px; padding: 0; border-radius: 6px; cursor: pointer;
    border: 1px solid color-mix(in srgb, var(--text-1) 22%, transparent);
  }
  .pte-ground.on, .pte-swatch.on { outline: 2px solid var(--accent); outline-offset: 2px; }
  .pte-well {
    width: 30px; height: 24px; padding: 0; cursor: pointer;
    border: 1px solid var(--border); border-radius: 6px; background: none;
  }
  .pte-colour { display: flex; align-items: center; gap: 8px; }
  .pte-said { color: var(--text-3); }
  .pte-link {
    padding: 0; border: 0; background: none; color: var(--accent); font: inherit; font-size: var(--fs-xs); cursor: pointer;
  }
  .pte-link:hover { text-decoration: underline; }

  .pte-seg { display: flex; border: 1px solid var(--border); border-radius: var(--r-md, 6px); overflow: hidden; }
  .pte-seg button {
    padding: 4px 11px; border: 0; border-left: 1px solid var(--border); background: var(--bg-2);
    color: var(--text-2); font: inherit; font-size: var(--fs-xs); cursor: pointer;
  }
  .pte-seg button:first-child { border-left: 0; }
  .pte-seg button:hover { background: var(--bg-3); color: var(--text-1); }
  .pte-seg button.on { background: var(--accent); color: var(--accent-text); font-weight: 600; }

  .pte-corners { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin: 2px 0 6px; }
  .pte-corners button {
    padding: 4px 6px; font: inherit; font-size: 11px; color: var(--text-2); cursor: pointer;
    background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--r-sm, 4px);
  }
  .pte-corners button:hover { color: var(--text-1); }
  .pte-corners button.on { color: var(--accent); border-color: var(--accent); }

  .pte-palette { display: flex; gap: 7px; margin-bottom: 6px; }
  .pte-palette .pte-swatch { width: 26px; height: 26px; border-radius: 50%; }
  .pte-pick {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px;
    border: 1px solid var(--border); border-radius: 6px; background: var(--bg-2);
  }
  .pte-swatch.small { width: 20px; height: 20px; border-radius: 50%; }

  @media (max-width: 860px) {
    .pte { grid-template-columns: 1fr; grid-template-rows: 46% 1fr; }
    .pte-stage { border-right: 0; border-bottom: 1px solid var(--border); }
  }
</style>
