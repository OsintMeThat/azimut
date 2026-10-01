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
  import { RULE_COLOURS, sideOf } from '../../lib/map/analyzerRules.js';
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

  $effect(() => {
    const tiles = detail?.tiles ?? [];
    const size = detail?.size ?? 0;
    let cancelled = false;
    Promise.all(tiles.map(async (tile) => [`${tile.x},${tile.y}`, await decode(tile.mask, size)]))
      .then((pairs) => { if (!cancelled) decoded = Object.fromEntries(pairs); })
      .catch(() => { if (!cancelled) decoded = {}; });
    return () => { cancelled = true; };
  });

  const placed = $derived.by(() => {
    revision;
    const tiles = detail?.tiles ?? [];
    if (!engine?.frame || !element || !tiles.length) return [];
    const box = element.getBoundingClientRect();
    const frame = { ...engine.frame(), width: box.width || 1, height: box.height || 1 };
    const toScreen = invert(screenToMercator(frame));
    return tiles.filter((tile) => decoded[`${tile.x},${tile.y}`]).map((tile) => ({
      key: `${tile.x},${tile.y}`,
      bits: decoded[`${tile.x},${tile.y}`],
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
