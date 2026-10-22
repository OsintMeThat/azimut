<script>
  /**
   * Satellite's 3D view: the globe (lib/globe/globe.js) laid over the flat map
   * while the 3D switch is on.
   *
   * The surface owns the handover: the globe is handed to the tool's façade
   * when it is up (`onready`, with the canvas over it where the flat map's
   * names and marks stand) and taken back before it goes (`onteardown`), so
   * the camera passes from one engine to the other where it stood. This
   * component only keeps the globe drawing what the surface shows: the imagery,
   * the relief's scale, and the credits of both.
   *
   * The globe stays unseen until it stands where it was asked with a picture
   * on every tile (`onvisible`), so the flat map holds the screen meanwhile and
   * the switch never flashes bare ground or a camera on its way; after a few
   * seconds it shows whatever it has.
   */
  import { onMount } from 'svelte';
  import { createGlobe } from '../../lib/globe/globe.js';
  import { sourceMaxZoom, sourceMinZoom } from '../../lib/map/basemap.js';
  import { api } from '../../lib/api.js';

  let {
    /** What the surface shows: `{ provider, id, cell }` (`imagery.displayed`). */
    shown,
    exaggeration = 1,
    onready = () => {},
    /** The globe is drawn and placed, and takes the screen from the flat map. */
    onvisible = () => {},
    onteardown = () => {},
    /** The browser has no WebGL2, or lost the globe's: the surface has no 3D view, and says why. */
    onrefused = () => {},
    /** Billed tiles went out, which the meter counts. */
    onusage = () => {},
    /** A picture could not be read: `(error)`. */
    ontrouble = () => {},
  } = $props();

  let canvas = $state();
  let marks = $state();
  let globe = $state.raw(null);
  let visible = $state(false);
  let terrainCredit = $state('');
  /** ms the globe is given to be placed and pictured before it shows whatever it has. */
  const SHOW_ANYWAY = 4000;

  onMount(() => {
    let usageTimer = null;
    const made = createGlobe(canvas, {
      // one count a second however many billed tiles land in it
      onMetered: () => {
        usageTimer ??= setTimeout(() => {
          usageTimer = null;
          onusage();
        }, 1000);
      },
      onFailed: (_provider, error) => ontrouble(error),
    });
    if (!made) {
      onrefused();
      return;
    }
    globe = made;
    const show = () => {
      if (visible) return;
      visible = true;
      onvisible();
    };
    const offShown = made.on('shown', show);
    const offLost = made.on('lost', onrefused);
    const showAnyway = setTimeout(show, SHOW_ANYWAY);
    onready(made, { marks });
    api
      .get('/api/terrain/sources')
      .then((info) => (terrainCredit = info.sources?.[0]?.attribution ?? ''))
      .catch(() => {});
    return () => {
      offShown();
      offLost();
      clearTimeout(showAnyway);
      clearTimeout(usageTimer);
      onteardown(made);
      made.destroy();
      globe = null;
    };
  });

  $effect(() => {
    const provider = shown?.provider;
    if (!globe) return;
    if (!provider || provider.widget) {
      globe.setImagery(null);
      return;
    }
    const cell = shown.cell ?? 256;
    globe.setImagery({ id: shown.id, metered: Boolean(provider.meter), cell, deepest: sourceMaxZoom(provider, cell), shallowest: sourceMinZoom(provider, cell) });
  });

  $effect(() => {
    globe?.setExaggeration(exaggeration);
  });

  const credits = $derived(
    [shown?.provider?.attribution, terrainCredit ? `relief: ${terrainCredit}` : '']
      .filter(Boolean)
      .join(' · ')
  );
</script>

<div class="globe" class:waiting={!visible}>
  <canvas bind:this={canvas} aria-label="3D view of the imagery on its relief"></canvas>
  <canvas class="marks" bind:this={marks} aria-hidden="true"></canvas>
  {#if credits}
    <div class="credits">{credits}</div>
  {/if}
</div>

<style>
  /* Over the flat map, under everything a tool lays on the ground (500 and up). */
  .globe {
    position: absolute;
    inset: 0;
    z-index: 1;
    background: #c9d6e3;
  }
  /* drawn but unseen, and not in the way of the flat map that still shows */
  .globe.waiting {
    visibility: hidden;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    user-select: none;
    cursor: grab;
  }
  canvas:active {
    cursor: grabbing;
  }
  /* the names and marks standing on the ground: drawn over it, never in the hand's way */
  .marks {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .credits {
    position: absolute;
    right: 0;
    bottom: 0;
    max-width: 70%;
    padding: 1px 6px;
    font-size: 10px;
    line-height: 16px;
    color: #333;
    background: rgba(255, 255, 255, 0.7);
    border-top-left-radius: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }
</style>
