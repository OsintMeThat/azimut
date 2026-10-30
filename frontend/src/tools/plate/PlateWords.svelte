<script>
  /**
   * The words of the picked element, set the same way whatever writes them: their
   * size, face, weight, style, colour, and what stands behind them. Each is written
   * where that kind keeps it (`lib/plate/words.js`).
   */
  import PlateColour from './PlateColour.svelte';
  import PlateSection from './PlateSection.svelte';
  import { FONTS } from '../../lib/plate/page.js';
  import { backChoices, wordControls, wordsOf, wordsPatch } from '../../lib/plate/words.js';

  let {
    element,
    theme,
    /** `(key)` once a setting is written, for a label whose box follows its words. */
    onchange = null,
  } = $props();

  const controls = $derived(wordControls(element));
  const words = $derived(wordsOf(element, theme));
  const backs = $derived(backChoices(element.kind));

  function set(key, value) {
    Object.assign(element, wordsPatch(element, key, value, theme));
    onchange?.(key);
  }
</script>

{#if controls.length}
  <PlateSection title="Words" summary={controls.includes('size') ? `${words.size} pt` : ''}>
  <div class="rows">
    {#if controls.includes('size')}
      <span class="key">Size</span>
      <input type="number" aria-label="Text size" min="4" max="200" step="0.5" value={words.size}
        oninput={(event) => { const value = Number(event.currentTarget.value); if (value >= 4 && value <= 200) set('size', value); }} />
    {/if}
    {#if controls.includes('font')}
      <span class="key">Font</span>
      <select aria-label="Element font" value={words.font} onchange={(event) => set('font', event.currentTarget.value)}>
        <option value="">The page's</option>
        {#each Object.entries(FONTS) as [id, font] (id)}<option value={id}>{font.label}</option>{/each}
      </select>
    {/if}
    {#if controls.includes('weight')}
      <span class="key">Weight</span>
      <div class="segments" role="group" aria-label="Text weight">
        {#each [[400, 'Regular'], [600, 'Semi'], [700, 'Bold']] as [value, label] (value)}
          <button type="button" aria-pressed={words.weight === value} onclick={() => set('weight', value)}>{label}</button>
        {/each}
      </div>
    {/if}
    {#if controls.includes('style')}
      <span class="key">Style</span>
      <div class="segments" role="group" aria-label="Text style">
        <button type="button" aria-pressed={words.italic} onclick={() => set('italic', !words.italic)}><i>Italic</i></button>
        <button type="button" aria-pressed={words.upper} onclick={() => set('upper', !words.upper)}>CAPS</button>
      </div>
    {/if}
    {#if controls.includes('colour')}
      <span class="key">Colour</span>
      <PlateColour label="Text colour" value={words.colour} {theme} onpick={(hex) => set('colour', hex)} />
    {/if}
    {#if controls.includes('back')}
      <span class="key">Behind</span>
      <div class="segments" role="group" aria-label="What stands behind the words">
        {#each backs as [value, label] (value)}
          <button type="button" aria-pressed={words.back === value} onclick={() => set('back', value)}>{label}</button>
        {/each}
      </div>
      {#if words.back === 'box' || (element.kind === 'label' && words.back === 'halo')}
        <span class="key">{element.kind === 'video' ? 'Band' : element.kind === 'label' ? 'Halo' : 'Box'}</span>
        <PlateColour label="Box colour" value={words.backColour} {theme} onpick={(hex) => set('backColour', hex)} />
      {/if}
    {/if}
  </div>
  </PlateSection>
{/if}

<style>
  .rows { display: grid; grid-template-columns: 74px minmax(0, 1fr); align-items: center; gap: 7px 8px; margin: 8px 0; }
  .key { color: var(--text-3); font-size: 11px; }
  select, input[type='number'] { width: 100%; min-width: 0; height: 26px; padding: 3px 6px; font-size: var(--fs-xs); border-radius: var(--r-sm); }
  .segments { display: flex; border: 1px solid var(--border); border-radius: var(--r-sm); overflow: hidden; background: var(--bg-1); }
  .segments button { flex: 1; min-width: 0; padding: 4px 3px; color: var(--text-2); font-size: 11px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .segments button + button { border-left: 1px solid var(--border); }
  .segments button[aria-pressed='true'] { background: var(--accent-soft); color: var(--text-1); font-weight: 600; }
</style>
