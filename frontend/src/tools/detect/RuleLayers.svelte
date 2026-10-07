<script>
  /**
   * What each rule of the analyzer being built keeps, painted on the ground a
   * test judged. The engine sends one byte a pixel for each tile it read (a bit
   * per rule, detect_rules.py); this lays each on the ground through the map's
   * own frame, so it stays put however the map is panned, zoomed or turned, and
   * repaints only when a rule is shown, hidden or hovered.
   *
   * The ground a test measured is tinted, so a place no rule kept still reads as
   * tested, and cloud or missing imagery stays clear. When the map is split
   * between two passes, what reads the before pass is painted on the before
   * half, what reads the after pass on the after half, and a change across both.
   * After the rules or the pins change the picture is dimmed: it answers for
   * what they were.
   */
  import { RULE_COLOURS, redrawRule, sideOf } from '../../lib/map/analyzerRules.js';
  import { compose, cssMatrix, imageToMercator, invert, screenToMercator } from '../../lib/map/groundFrame.js';
  import RuleTile from './RuleTile.svelte';

  let {
    engine,
    element,
    /** What a test sent back: `{ size, tiles: [{ x, y, box, mask }] }`. */
    detail = null,
    rules = [],
    shown = [],
    hover = null,
    colours = RULE_COLOURS,
    split = false,
    /** Where the split sits, as a percentage of the map from its left edge. */
    divider = 50,
    stale = false,
    /**
     * Rules whose reading the engine has sent: `[{ index, reading }]`. Their
     * ground is drawn from the reading rather than from the test's verdict, so
     * their line can move and the picture follows without asking again.
     */
    live = [],
  } = $props();

  /** The tint over ground the test measured, out of 255. */
  const VEIL = 30;

  let revision = $state(0);
  let decoded = $state({});

  $effect(() => {
    if (!engine) return;
    return engine.on('view-move', () => revision++);
  });

  /** One byte a pixel out of the PNG the engine sent: its first channel. */
  async function decode(base64, size) {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const scratch = document.createElement('canvas');
    scratch.width = size;
    scratch.height = size;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, size, size).data;
    const out = new Uint8Array(size * size);
    for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4];
    return out;
  }

  /**
   * One rule's reading out of its PNG: sixteen bits split over two channels.
   *
   * A canvas hands back eight-bit RGBA whatever the file held, so the engine
   * writes the high byte on red and the low byte on green rather than a 16-bit
   * greyscale that would be truncated on the way in (`detect_rules._value_png`).
   */
  async function decodeValues(base64, size, { low, high, steps }) {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const scratch = document.createElement('canvas');
    scratch.width = size;
    scratch.height = size;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, size, size).data;
    const out = new Float64Array(size * size);
    const step = (high - low) / steps;
    for (let i = 0; i < out.length; i++) out[i] = low + (rgba[i * 4] * 256 + rgba[i * 4 + 1]) * step;
    return out;
  }

  $effect(() => {
    const tiles = detail?.tiles ?? [];
    const size = detail?.size ?? 0;
    let cancelled = false;
    Promise.all(tiles.map(async (tile) => [`${tile.x},${tile.y}`, await decode(tile.mask, size)]))
      .then((pairs) => { if (!cancelled) decoded = Object.fromEntries(pairs); })
      .catch(() => { if (!cancelled) decoded = {}; });
    return () => { cancelled = true; };
  });

  /** Per rule index, its reading per tile. Decoded once; the line moves, this does not. */
  let readings = $state({});

  $effect(() => {
    const wanted = live;
    let cancelled = false;
    Promise.all(wanted.map(async ({ index, reading }) => [index, Object.fromEntries(
      await Promise.all((reading.tiles ?? []).map(async (tile) => [
        `${tile.x},${tile.y}`, await decodeValues(tile.values, reading.size, reading),
      ])),
    )]))
      .then((pairs) => { if (!cancelled) readings = Object.fromEntries(pairs); })
      .catch(() => { if (!cancelled) readings = {}; });
    return () => { cancelled = true; };
  });

  /**
   * The mask each tile is painted from: the test's, with every live rule's own
   * bit redrawn at the line it sits on now.
   *
   * Its own derivation rather than part of `placed`, which also follows the
   * camera: panning the map must not redraw five million pixels.
   */
  const painted = $derived.by(() => {
    const base = decoded;
    const held = readings;
    const rows = live.filter(({ index }) => held[index] && rules[index]);
    if (!rows.length) return base;
    const out = {};
    for (const [key, bits] of Object.entries(base)) {
      let next = bits;
      for (const { index } of rows) {
        const values = held[index][key];
        if (values) next = redrawRule(next, index, values, rules[index]);
      }
      out[key] = next;
    }
    return out;
  });

  const placed = $derived.by(() => {
    revision;
    const tiles = detail?.tiles ?? [];
    if (!engine?.frame || !element || !tiles.length) return [];
    const box = element.getBoundingClientRect();
    const frame = { ...engine.frame(), width: box.width || 1, height: box.height || 1 };
    const toScreen = invert(screenToMercator(frame));
    return tiles.filter((tile) => painted[`${tile.x},${tile.y}`]).map((tile) => ({
      key: `${tile.x},${tile.y}`,
      bits: painted[`${tile.x},${tile.y}`],
      transform: cssMatrix(compose(toScreen, imageToMercator(tile.box, detail.size, detail.size))),
    }));
  });

  const parts = $derived(split ? ['shared', 'before', 'after'] : ['shared']);
  /** What a part paints: the rules that belong to it, or none when another rule is hovered. */
  const shownIn = (part) => rules.map((rule, i) => !!shown[i] && sideOf(rule, split) === part);
  const hoverIn = (part) => (hover !== null && rules[hover] && sideOf(rules[hover], split) === part ? hover : null);
  const hoveredElsewhere = (part) => hover !== null && !!rules[hover] && sideOf(rules[hover], split) !== part;
</script>

{#if placed.length}
  <div class="rule-layers" class:stale style:--divider={`${divider}%`} aria-label="What each rule keeps">
    {#each parts as part (part)}
      <div class="part {part}">
        {#each placed as tile (tile.key)}
          <RuleTile bits={tile.bits} size={detail.size} transform={tile.transform} {colours}
            shown={hoveredElsewhere(part) ? [] : shownIn(part)} hover={hoverIn(part)} veil={part === 'shared' ? VEIL : 0} />
        {/each}
      </div>
    {/each}
  </div>
{/if}

<style>
  .rule-layers {
    position: absolute;
    inset: 0;
    z-index: 540;
    pointer-events: none;
    transition: opacity 0.15s var(--ease);
  }
  .rule-layers.stale { opacity: 0.4; }
  .part { position: absolute; inset: 0; }
  .part.before { clip-path: inset(0 calc(100% - var(--divider)) 0 0); }
  .part.after { clip-path: inset(0 0 0 var(--divider)); }
</style>
