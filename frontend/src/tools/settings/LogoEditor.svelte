<script>
  /**
   * The logo editor of Settings › Publishing: a shape cut around the logo, a frame
   * along it, a background, a margin and a crop, previewed on paper and over a
   * picture. `lib/logoLook.js` draws both the preview and the saved logo, so what
   * shows here is what prints. It always starts from the picture as picked, never
   * from a logo already framed, and a look left plain saves that picture's own bytes.
   */
  import { untrack } from 'svelte';
  import Modal from '../../components/Modal.svelte';
  import HexField from '../../components/HexField.svelte';
  import { AMBER } from '../../lib/brandMark.js';
  import { recentColours } from '../../lib/recentColours.svelte.js';
  import { LIMITS, PLAIN, drawLogo, isPlain, logoLayout, normaliseLook, renderLogo } from '../../lib/logoLook.js';
  import { LOGO_MAX_BYTES, PUBLISHING_HELP as HELP } from '../../lib/publishingHelp.js';

  let { picture, look: startLook = null, onsave, onclose } = $props();

  let look = $state(untrack(() => normaliseLook(startLook)));
  let image = $state.raw(null);
  let problem = $state('');
  let busy = $state(false);
  let paper = $state(null);
  let dark = $state(null);

  const SHAPES = [
    ['rectangle', 'Rectangle'],
    ['rounded', 'Rounded'],
    ['circle', 'Circle'],
  ];
  // Each preview, in CSS px, and the air left around the logo inside it.
  const VIEW = { w: 236, h: 168, air: 14 };
  const PAPER = '#ffffff';
  const PICTURE = '#2b3038';

  $effect(() => {
    const url = URL.createObjectURL(picture);
    const img = new Image();
    let live = true;
    img.onload = () => { if (live) image = img; };
    img.onerror = () => { if (live) problem = 'This picture does not open. Pick another PNG.'; };
    img.src = url;
    return () => {
      live = false;
      URL.revokeObjectURL(url);
    };
  });

  const layout = $derived(image ? logoLayout(image.naturalWidth, image.naturalHeight, look) : null);
  const scale = $derived(layout ? Math.min((VIEW.w - 2 * VIEW.air) / layout.width, (VIEW.h - 2 * VIEW.air) / layout.height) : 1);

  function paint(canvas, background) {
    if (!canvas || !layout) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(VIEW.w * ratio);
    canvas.height = Math.round(VIEW.h * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const left = (VIEW.w - layout.width * scale) / 2;
    const top = (VIEW.h - layout.height * scale) / 2;
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * left, ratio * top);
    drawLogo(ctx, image, layout, look);
  }

  $effect(() => {
    paint(paper, PAPER);
    paint(dark, PICTURE);
  });

  // The two previews, each holding on to its canvas while it is on the page.
  const VIEWS = [
    ['On paper', (el) => { paper = el; return () => { paper = null; }; }],
    ['Over a picture', (el) => { dark = el; return () => { dark = null; }; }],
  ];

  const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));

  // Dragging a preview moves the picture inside its shape, in shares of its box.
  let drag = $state.raw(null);
  function grab(event) {
    if (!layout) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, from: { x: look.x, y: look.y } };
  }
  function slide(event) {
    if (!drag || !layout) return;
    look.x = clamp(drag.from.x + (event.clientX - drag.x) / scale / layout.content.w, LIMITS.x);
    look.y = clamp(drag.from.y + (event.clientY - drag.y) / scale / layout.content.h, LIMITS.y);
  }
  function drop() {
    drag = null;
  }
  // The arrow keys move it too, a step at a time.
  function nudge(event) {
    const step = event.shiftKey ? 0.1 : 0.02;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    look.x = clamp(look.x + move[0], LIMITS.x);
    look.y = clamp(look.y + move[1], LIMITS.y);
  }

  const swatches = $derived([...new Map([
    [PAPER, 'White'],
    ['#000000', 'Black'],
    [AMBER, 'Azimut amber'],
    ...recentColours.list.slice(0, 5).map((hex) => [hex, 'Picked lately']),
  ]).entries()]);

  function frameColour(hex, keep = true) {
    look.colour = hex;
    if (keep) recentColours.keep(hex);
  }
  function background(hex, keep = true) {
    look.fill = hex;
    if (keep) recentColours.keep(hex);
  }

  function startOver() {
    look = { ...PLAIN };
  }

  async function save() {
    if (!image || busy) return;
    busy = true;
    problem = '';
    try {
      const framed = normaliseLook(look);
      if (isPlain(framed)) await onsave({ logo: picture, look: null });
      else await onsave({ logo: await renderLogo(image, framed, { maxBytes: LOGO_MAX_BYTES }), look: framed });
    } catch (error) {
      problem = `Could not save the logo: ${error.message}`;
    } finally {
      busy = false;
    }
  }

  function close() {
    if (!busy) onclose?.();
  }
</script>

{#snippet colours(value, label, help, pick)}
  <div class="colours">
    {#each swatches as [hex, name] (hex)}
      <button type="button" class="swatch" class:on={value === hex} style:background={hex}
        aria-label={`${label}: ${name}`} title={name} onclick={() => pick(hex)}></button>
    {/each}
    <input type="color" class="any-colour" aria-label={`${label}, any colour`} title={help} value={value || PAPER}
      oninput={(event) => pick(event.currentTarget.value, false)} onchange={(event) => pick(event.currentTarget.value)} />
    <HexField {value} label={`${label} code`} placeholder="#hex" onpick={(hex) => pick(hex)} />
  </div>
{/snippet}

<Modal title="Edit logo" onclose={close} width="560px">
  <div class="previews">
    {#each VIEWS as [caption, keep] (caption)}
      <figure>
        <canvas
          {@attach keep}
          class="view"
          class:dragging={!!drag}
          style:width="{VIEW.w}px"
          style:height="{VIEW.h}px"
          tabindex="0"
          aria-label={`Your logo ${caption.toLowerCase()}. Drag or use the arrow keys to move it`}
          title={HELP.logoMove}
          onpointerdown={grab}
          onpointermove={slide}
          onpointerup={drop}
          onpointercancel={drop}
          onkeydown={nudge}
        ></canvas>
        <figcaption>{caption}</figcaption>
      </figure>
    {/each}
  </div>

  <div class="fields">
    <span class="name" title={HELP.logoShape}>Shape</span>
    <div class="choice" role="group" aria-label="Shape">
      {#each SHAPES as [id, label] (id)}
        <button type="button" class="choice-btn" class:on={look.shape === id} aria-pressed={look.shape === id}
          title={HELP.logoShape} onclick={() => (look.shape = id)}>{label}</button>
      {/each}
    </div>

    {#if look.shape === 'rounded'}
      <label class="name" for="logo-corners" title={HELP.logoCorners}>Corners</label>
      <input id="logo-corners" type="range" min={LIMITS.radius[0]} max={LIMITS.radius[1]} step="0.01"
        bind:value={look.radius} title={HELP.logoCorners} />
    {/if}

    <label class="name" for="logo-frame" title={HELP.logoFrame}>Frame</label>
    <div class="stack">
      <input id="logo-frame" type="range" min={LIMITS.border[0]} max={LIMITS.border[1]} step="0.005"
        bind:value={look.border} title={HELP.logoFrame} />
      {#if look.border > 0}
        {@render colours(look.colour, 'Frame colour', HELP.logoFrameColour, frameColour)}
      {/if}
    </div>

    <span class="name" title={HELP.logoBackground}>Background</span>
    <div class="colours">
      <button type="button" class="none" class:on={!look.fill} aria-pressed={!look.fill} title={HELP.logoNoBackground}
        onclick={() => (look.fill = '')}>None</button>
      {@render colours(look.fill, 'Background', HELP.logoBackground, background)}
    </div>

    <label class="name" for="logo-margin" title={HELP.logoMargin}>Margin</label>
    <input id="logo-margin" type="range" min={LIMITS.padding[0]} max={LIMITS.padding[1]} step="0.005"
      bind:value={look.padding} title={HELP.logoMargin} />

    <label class="name" for="logo-zoom" title={HELP.logoZoom}>Zoom</label>
    <input id="logo-zoom" type="range" min={LIMITS.zoom[0]} max={LIMITS.zoom[1]} step="0.01"
      bind:value={look.zoom} title={HELP.logoZoom} />
  </div>

  {#if problem}<p class="problem" role="alert">{problem}</p>{/if}

  <div class="actions">
    <button type="button" class="btn btn-ghost btn-sm" title={HELP.logoReset} disabled={busy || isPlain(look)}
      onclick={startOver}>Start over</button>
    <div class="grow"></div>
    <button type="button" class="btn" title={HELP.logoCancel} disabled={busy} onclick={close}>Cancel</button>
    <button type="button" class="btn btn-primary" title={HELP.logoSave} disabled={busy || !image} onclick={save}>
      {busy ? 'Saving…' : 'Save'}
    </button>
  </div>
</Modal>

<style>
  .previews {
    display: flex;
    gap: 12px;
    justify-content: center;
  }
  figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .view {
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    cursor: grab;
    touch-action: none;
  }
  .view.dragging {
    cursor: grabbing;
  }
  .view:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  figcaption {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .fields {
    display: grid;
    grid-template-columns: 92px 1fr;
    align-items: center;
    gap: 10px 12px;
    margin-top: 16px;
  }
  .name {
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }
  .choice {
    display: flex;
    justify-self: start;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    overflow: hidden;
  }
  .choice-btn {
    padding: 5px 12px;
    border: 0;
    border-left: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .choice-btn:first-child {
    border-left: 0;
  }
  .choice-btn:hover {
    background: var(--bg-3);
    color: var(--text-1);
  }
  .choice-btn.on {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }
  .colours {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .swatch {
    flex: none;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 1px solid rgba(0, 0, 0, 0.3);
    border-radius: 50%;
    cursor: pointer;
  }
  .swatch.on {
    box-shadow: 0 0 0 2px var(--bg-1), 0 0 0 3px var(--accent);
  }
  .any-colour {
    flex: none;
    width: 28px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: none;
  }
  .none {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .none.on {
    border-color: var(--accent);
    color: var(--text-1);
  }
  .problem {
    margin-top: 12px;
    color: var(--danger);
    font-size: var(--fs-xs);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 18px;
  }
  .grow {
    flex: 1;
  }
</style>
