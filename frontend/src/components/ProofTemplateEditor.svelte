<script>
  /**
   * Editor for one proof-style template (a proof's "house style"): background,
   * panel spacing, text sizes, footer line, signature placement and preferred
   * colours. Content-free — it never touches panels, shapes or coordinates.
   *
   * `data` is the template's style blob (bindable); the parent owns save/delete.
   * Remount it per template with {#key} so the local palette re-seeds.
   */
  import {
    ANNO_COLORS, SIG_ANCHORS, PANEL_DIRECTIONS, BG, textColors, normSpace,
    newSignature, newSignatureText, SIG_SCALE, SIG_TEXT_SIZE,
    normalizePreferredColors, normalizeProofStyle, replacePreferredColor,
  } from '../lib/composer.js';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import ProofPreview from './ProofPreview.svelte';

  let { data = $bindable() } = $props();
  Object.assign(data, normalizeProofStyle(data));

  // A few one-click backgrounds; the colour input covers anything else.
  const BG_PRESETS = ['#0d1117', '#000000', '#ffffff', '#f4f1ea', '#1b2a4a'];

  // Templates always expose seven drawing slots. Older or partial palettes are
  // completed from the shipped colours without disturbing their saved order.
  let palette = $state(normalizePreferredColors([
    ...(Array.isArray(data.palette) ? data.palette : []),
    ...ANNO_COLORS,
  ]));
  let customColor = $state(ANNO_COLORS[0]);
  let selectedColor = $state(null);

  function commitPalette() {
    data.palette = [...palette];
    // Early template drafts stored legend content here. It belongs to proofs.
    delete data.notes;
    delete data.legendOrder;
  }

  function openColor(index) {
    selectedColor = selectedColor === index ? null : index;
    customColor = palette[index];
  }

  function replaceColor(color) {
    if (selectedColor == null) return;
    palette = replacePreferredColor(palette, selectedColor, color);
    commitPalette();
    selectedColor = null;
  }
  commitPalette();

  const space = $derived(normSpace(data.space));
  function setSpace(key, value) {
    data.space = { ...space, [key]: Math.max(0, Math.min(200, Number(value) || 0)) };
  }

  function setTextSize(key, value, fallback) {
    const number = Number(value);
    data[key] = Number.isFinite(number) ? Math.max(8, Math.min(80, number)) : fallback;
  }

  const signed = $derived(!!data.signature);
  function toggleSignature(on) {
    data.signature = on
      ? (data.signature ?? newSignature())
      : null;
  }
  function setSig(key, value) {
    data.signature = key === 'anchor'
      ? { ...data.signature, anchor: value, dx: 0, dy: 0, xRatio: undefined, yRatio: undefined }
      : { ...data.signature, [key]: value };
  }

  // Text signature — the Settings handle laid over the panels, positioned by drag.
  const signedText = $derived(!!data.signatureText);
  function toggleSignatureText(on) {
    data.signatureText = on ? (data.signatureText ?? newSignatureText()) : null;
  }
  function setSigText(key, value) {
    data.signatureText = key === 'anchor'
      ? { ...data.signatureText, anchor: value, dx: 0, dy: 0, xRatio: undefined, yRatio: undefined }
      : { ...data.signatureText, [key]: value };
  }

  // Footer switch + colour (null colour → auto from the background).
  const footerOn = $derived(data.footerEnabled !== false);
  const autoFooterColor = $derived(textColors(data.bg ?? BG).faint);

  // Default caption for newly added panels.
  const captionsOn = $derived(data.captionsEnabled !== false);

  // Set by the preview when the signature is on but no logo file is saved.
  let logoMissing = $state(false);
  // The zoomed, roomier preview for precise drag/resize.
  let expanded = $state(false);
</script>

<div class="pt-editor">
  <div class="pt-grid">
    <div class="pt-fields">
      <label class="fld">
        <span>Background</span>
        <span class="bg-row">
          <input type="color" value={data.bg ?? BG} oninput={(e) => (data.bg = e.target.value)} />
          {#each BG_PRESETS as c}
            <button
              type="button"
              class="sw"
              class:active={(data.bg ?? BG).toLowerCase() === c}
              style:background={c}
              title={c}
              aria-label={`Background ${c}`}
              onclick={() => (data.bg = c)}
            ></button>
          {/each}
        </span>
      </label>

      <fieldset class="fld">
        <span>Margins (px)</span>
        <div class="triple">
          <label>Outer
            <input type="number" min="0" max="200" value={space.pad}
              oninput={(e) => setSpace('pad', e.target.value)} />
          </label>
          <label>Between panels
            <input type="number" min="0" max="200" value={space.gap}
              oninput={(e) => setSpace('gap', e.target.value)} />
          </label>
          <label>Between rows
            <input type="number" min="0" max="200" value={space.rowGap}
              oninput={(e) => setSpace('rowGap', e.target.value)} />
          </label>
        </div>
      </fieldset>

      <fieldset class="fld">
        <span>Text sizes (px)</span>
        <div class="triple">
          <label>Captions
            <input type="number" min="8" max="80" value={data.captionSize}
              oninput={(e) => setTextSize('captionSize', e.target.value, 20)} />
          </label>
          <label>Legend
            <input type="number" min="8" max="80" value={data.legendSize}
              oninput={(e) => setTextSize('legendSize', e.target.value, 20)} />
          </label>
          <label>Footer
            <input type="number" min="8" max="80" value={data.footerSize}
              oninput={(e) => setTextSize('footerSize', e.target.value, 15)} />
          </label>
        </div>
      </fieldset>

      <fieldset class="fld">
        <span>
          <label class="chk"><input type="checkbox" checked={captionsOn}
            onchange={(e) => (data.captionsEnabled = e.target.checked)} /> Caption new panels</label>
        </span>
        <p class="hint">Off: panels are added blank. A caption can still be typed on any panel.</p>
      </fieldset>

      <fieldset class="fld">
        <span>
          <label class="chk"><input type="checkbox" checked={footerOn}
            onchange={(e) => (data.footerEnabled = e.target.checked)} /> Show footer</label>
        </span>
        {#if footerOn}
          <input type="text" placeholder="Composed with Azimut" maxlength="200"
            bind:value={data.footer} />
          <div class="color-row">
            <span>Colour</span>
            <input type="color" value={data.footerColor ?? autoFooterColor}
              oninput={(e) => (data.footerColor = e.target.value)} />
            {#if data.footerColor}
              <button type="button" class="btn btn-ghost btn-sm"
                onclick={() => (data.footerColor = null)}>Auto</button>
            {/if}
          </div>
          <div class="radio-row">
            <span>Alignment</span>
            <label><input type="radio" value="left" checked={(data.footerAlign ?? 'left') === 'left'}
              onchange={() => (data.footerAlign = 'left')} /> Left</label>
            <label><input type="radio" value="right" checked={data.footerAlign === 'right'}
              onchange={() => (data.footerAlign = 'right')} /> Right</label>
          </div>
        {:else}
          <p class="hint">No band under the panels. Drop all margins for panels-only output.</p>
        {/if}
      </fieldset>

      <fieldset class="fld">
        <span>Layout</span>
        <div class="radio-row">
          <label><input type="radio" value="grid" bind:group={data.layout} /> Grid rows</label>
          <label><input type="radio" value="free" bind:group={data.layout} /> Free (overlap)</label>
        </div>
        {#if data.layout !== 'free'}
          <div class="radio-row">
            <span>First two panels</span>
            {#each PANEL_DIRECTIONS as direction}
              <label><input type="radio" value={direction.id}
                checked={(data.panelDirection ?? 'horizontal') === direction.id}
                onchange={() => (data.panelDirection = direction.id)} /> {direction.label}</label>
            {/each}
          </div>
        {/if}
      </fieldset>

      <fieldset class="fld">
        <span>
          <label class="chk"><input type="checkbox" checked={signed}
            onchange={(e) => toggleSignature(e.target.checked)} /> Stamp the logo</label>
        </span>
        {#if signed}
          <div class="triple">
            <label>Corner
              <select value={data.signature.anchor} onchange={(e) => setSig('anchor', e.target.value)}>
                {#each SIG_ANCHORS as a}<option value={a.id}>{a.label}</option>{/each}
              </select>
            </label>
            <label>Size
              <input type="range" min="0.03" max="0.3" step="0.01"
                value={data.signature.scale ?? SIG_SCALE}
                oninput={(e) => setSig('scale', Number(e.target.value))} />
            </label>
            <label>Opacity
              <input type="range" min="0.2" max="1" step="0.05"
                value={data.signature.opacity ?? 0.9}
                oninput={(e) => setSig('opacity', Number(e.target.value))} />
            </label>
          </div>
          {#if logoMissing}
            <p class="warn"><Icon name="alert" /> No logo saved yet. Add one in Settings → Preferences.</p>
          {:else}
            <p class="hint">The logo comes from Settings → Preferences; drag it in the preview.</p>
          {/if}
        {/if}
      </fieldset>

      <fieldset class="fld">
        <span>
          <label class="chk"><input type="checkbox" checked={signedText}
            onchange={(e) => toggleSignatureText(e.target.checked)} /> Add account handle</label>
        </span>
        {#if signedText}
          <div class="triple">
            <label>Corner
              <select value={data.signatureText.anchor} onchange={(e) => setSigText('anchor', e.target.value)}>
                {#each SIG_ANCHORS as a}<option value={a.id}>{a.label}</option>{/each}
              </select>
            </label>
            <label>Size
              <input type="number" min="12" max="160"
                value={data.signatureText.size ?? SIG_TEXT_SIZE}
                oninput={(e) => setSigText('size', Math.max(12, Math.min(160, Number(e.target.value) || SIG_TEXT_SIZE)))} />
            </label>
            <label>Colour
              <input type="color" value={data.signatureText.color ?? '#ffffff'}
                oninput={(e) => setSigText('color', e.target.value)} />
            </label>
          </div>
          <p class="hint">The account handle comes from Settings → Preferences; drag it into place in the preview.</p>
        {/if}
      </fieldset>

      <fieldset class="fld">
        <span>Preferred colour palette</span>
        <p class="hint">Select a colour to replace it.</p>
        <div class="preferred-palette" aria-label="Preferred colours">
          {#each palette as color, i (color)}
            <button type="button" class="preferred-colour" class:active={selectedColor === i}
              title={`Change ${color}`} aria-label={`Change colour ${i + 1}, currently ${color}`}
              onclick={() => openColor(i)}>
              <span>{i + 1}</span>
              <span class="dot" style:background={color}></span>
              <code>{color}</code>
            </button>
          {/each}
        </div>
        {#if selectedColor != null}
          <div class="colour-picker">
            <span>Replace with</span>
            <div class="colour-choices">
              {#each ANNO_COLORS as color (color)}
                <button type="button" class="sw colour-choice" style:background={color}
                  title={color} aria-label={`Use colour ${color}`}
                  onclick={() => replaceColor(color)}></button>
              {/each}
              <label class="custom-choice" title="Choose another colour">
                <input type="color" bind:value={customColor}
                  onchange={(e) => replaceColor(e.currentTarget.value)} aria-label="Choose another colour" />
              </label>
            </div>
          </div>
        {/if}
      </fieldset>
    </div>

    <div class="pt-preview">
      <ProofPreview bind:style={data} bind:logoMissing />
      <button type="button" class="btn btn-ghost btn-sm zoom-btn" onclick={() => (expanded = true)}>
        <Icon name="maximize" /> Zoom to edit
      </button>
    </div>
  </div>
</div>

{#if expanded}
  <Modal title="Proof preview" width="min(1100px, 92vw)" onclose={() => (expanded = false)}>
    <div class="pt-zoom">
      <ProofPreview bind:style={data} bind:logoMissing />
    </div>
  </Modal>
{/if}

<style>
  .pt-editor { display: block; }
  .pt-grid { display: grid; grid-template-columns: 1fr 320px; gap: 16px; align-items: start; }
  .pt-fields { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .fld { display: flex; flex-direction: column; gap: 6px; border: 0; margin: 0; padding: 0; }
  .fld > span { font-size: 12px; color: var(--text-2); font-weight: 600; }
  .fld input[type='text'], .fld input[type='number'], .fld select {
    background: var(--bg-2); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text-1); padding: 6px 8px; font: inherit; width: 100%;
  }
  .bg-row { display: flex; align-items: center; gap: 6px; }
  .bg-row input[type='color'], .color-row input[type='color'], .triple input[type='color'] {
    width: 34px; height: 28px; padding: 0; border: 1px solid var(--border); border-radius: 6px; background: none;
  }
  .color-row { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-3); }
  .sw { width: 22px; height: 22px; border-radius: 5px; border: 1px solid var(--border); cursor: pointer; }
  .sw.active { outline: 2px solid var(--accent); outline-offset: 1px; }
  .triple { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .triple label { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--text-3); }
  .radio-row, .chk { display: flex; gap: 14px; align-items: center; font-size: 13px; color: var(--text-2); }
  .chk { gap: 6px; }
  .hint { margin: 0; font-size: 11px; color: var(--text-3); }
  .warn {
    margin: 0; font-size: 11px; color: var(--warn, #e0a33e);
    display: flex; align-items: center; gap: 5px;
  }
  .pt-preview { display: flex; flex-direction: column; gap: 8px; position: sticky; top: 0; }
  .zoom-btn { align-self: flex-start; }
  .pt-zoom { width: min(1040px, 88vw); }
  .preferred-palette { display: flex; flex-direction: column; gap: 4px; }
  .preferred-colour {
    display: grid; grid-template-columns: 18px 14px 1fr; gap: 7px; align-items: center;
    min-height: 26px; width: 100%; padding: 2px 5px; font-size: 11px;
    color: var(--text-3); text-align: left; background: transparent;
    border: 1px solid transparent; border-radius: 5px; cursor: pointer;
  }
  .preferred-colour:hover { background: var(--bg-2); }
  .preferred-colour.active { border-color: var(--accent); background: var(--bg-2); }
  .preferred-colour code { color: var(--text-2); }
  .colour-picker {
    display: flex; flex-direction: column; gap: 6px; padding: 8px;
    border: 1px solid var(--border); border-radius: 6px; background: var(--bg-2);
  }
  .colour-picker > span { font-size: 11px; color: var(--text-3); }
  .colour-choices { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .colour-choice { padding: 0; }
  .custom-choice {
    display: block; width: 28px; height: 24px; cursor: pointer;
  }
  .custom-choice input {
    width: 28px; height: 24px; padding: 0; border: 1px solid var(--border);
    border-radius: 5px; background: none; cursor: pointer;
  }
  .dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
</style>
