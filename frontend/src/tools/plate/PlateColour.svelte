<script>
  /**
   * A colour of a plate, picked from what the plate already speaks in: the page's
   * ink, paper and accent, the case's named colours (its layer palette, so a front
   * line on the page is the same red as on the map), and the last few picked here.
   * Any other colour is the browser's own picker, eyedropper included.
   */
  import { layerPalette } from '../../lib/map/layerPalette.svelte.js';

  let { value = '#000000', theme = {}, label = 'Colour', onpick, none = false } = $props();

  const RECENT = 'azimut:plate-colours';
  function recent() {
    try { return JSON.parse(localStorage.getItem(RECENT) ?? '[]').filter((hex) => /^#[0-9a-f]{6}$/i.test(hex)); } catch { return []; }
  }
  let kept = $state(recent());
  const swatches = $derived([...new Map([
    ...[theme.ink, theme.paper, theme.accent].filter(Boolean).map((hex) => [hex.toLowerCase(), 'The page']),
    ...layerPalette.colours.map((entry) => [entry.colour.toLowerCase(), entry.name]),
    ...kept.map((hex) => [hex.toLowerCase(), 'Picked lately']),
  ]).entries()].slice(0, 14));

  function pick(hex) {
    onpick?.(hex);
    const next = [hex.toLowerCase(), ...kept.filter((item) => item !== hex.toLowerCase())].slice(0, 6);
    kept = next;
    try { localStorage.setItem(RECENT, JSON.stringify(next)); } catch { /* this browser keeps nothing */ }
  }
</script>

<span class="colour-field">
  <input type="color" aria-label={label} {value} onchange={(event) => pick(event.currentTarget.value)}
    oninput={(event) => onpick?.(event.currentTarget.value)} />
  {#each swatches as [hex, name] (hex)}
    <button type="button" class="swatch" class:on={String(value).toLowerCase() === hex} style:background={hex}
      aria-label={`${label}: ${name}`} title={name} onclick={() => pick(hex)}></button>
  {/each}
  {#if none}<button type="button" class="clear" onclick={() => onpick?.(null)}>None</button>{/if}
</span>

<style>
  .colour-field { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; min-width: 0; }
  input[type='color'] { flex: none; width: 30px; height: 22px; padding: 0; border: 1px solid var(--border); border-radius: var(--r-sm); background: none; }
  .swatch { flex: none; width: 15px; height: 15px; padding: 0; border: 1px solid rgba(0, 0, 0, .25); border-radius: 50%; cursor: pointer; }
  .swatch.on { box-shadow: 0 0 0 2px var(--bg-1), 0 0 0 3px var(--accent); }
  .clear { padding: 0 4px; color: var(--text-2); font-size: 10.5px; text-decoration: underline; cursor: pointer; }
</style>
