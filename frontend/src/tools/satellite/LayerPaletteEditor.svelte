<script>
  /**
   * The case's key, edited in place: what blue and orange mean in this
   * investigation, and what each icon stands for. Every layer of the case
   * offers the named colours, and the legends count by the names.
   *
   * It lists what is `colours` and `worn` (icons) where it was opened, each
   * named or not, and a colour added here; what the case names elsewhere is kept
   * as it is, folded under one line. A row left without a name is not kept.
   * `look(key)` draws an own icon, an app badge drawing itself.
   */
  import { untrack } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import HexField from '../../components/HexField.svelte';
  import MarkerSymbol from './MarkerSymbol.svelte';
  import choices from '../../lib/map/layerSymbols.json';
  import { layerPalette } from '../../lib/map/layerPalette.svelte.js';
  import { iconLibrary } from '../../lib/iconLibrary.svelte.js';
  import { toast } from '../../lib/state.svelte.js';

  let { caseId, colours = [], worn = [], look = null, onclose } = $props();
  const badges = new Map(choices.map((choice) => [choice.id, choice.label]));
  const hexOf = (value) => String(value ?? '').toLowerCase();
  /** The colours worn here, then the case's other names (`elsewhere`), then those added (`added`). */
  let rows = $state(untrack(() => {
    const here = [...new Set(colours.map(hexOf).filter((hex) => /^#[0-9a-f]{6}$/.test(hex)))];
    return [...here.map((colour) => ({ colour, name: layerPalette.nameOf(colour), elsewhere: false, added: false })),
      ...layerPalette.colours.filter((entry) => !here.includes(entry.colour))
        .map((entry) => ({ ...entry, elsewhere: true, added: false }))];
  }));
  let marks = $state(untrack(() => {
    const here = [...new Set(worn.filter(Boolean))];
    return [...here.map((key) => ({ key, name: layerPalette.iconNameOf(key), elsewhere: false })),
      ...layerPalette.icons.filter((entry) => !here.includes(entry.key)).map((entry) => ({ ...entry, elsewhere: true }))];
  }));
  /** Whether the names the case gives beyond this layer are shown. */
  let others = $state(false);
  let busy = $state(false);
  const elsewhere = $derived(rows.filter((row) => row.elsewhere).length + marks.filter((mark) => mark.elsewhere).length);
  const drawn = (key) => (badges.has(key) ? null : look?.(key) ?? iconLibrary.look(key, { caseId }));

  async function save() {
    busy = true;
    try {
      await layerPalette.save(caseId, rows.filter((row) => row.name.trim()).map((row) => ({ name: row.name.trim(), colour: hexOf(row.colour) })),
        marks.filter((mark) => mark.name.trim()).map((mark) => ({ name: mark.name.trim(), key: mark.key })));
      onclose?.();
    } catch (error) { toast(error.message, 'danger'); }
    finally { busy = false; }
  }
</script>

<div class="palette-editor" role="group" aria-label="Named colours and icons">
  <p class="note">Name what each colour and icon stands for in this case: legends then read “Side A: 12”, not a bare blue.</p>
  <p class="head">Colours</p>
  {#each rows as row, index (index)}
    {#if !row.elsewhere || others}
      {@const nth = rows.slice(0, index + 1).filter((one) => one.added).length}
      <div class="row" class:elsewhere={row.elsewhere}>
        {#if row.added}
          <input type="color" aria-label={`Colour added ${nth}`} title="Any colour" bind:value={row.colour} />
          <HexField value={row.colour} label={`Code of colour added ${nth}`} onpick={(hex) => (row.colour = hex)} />
        {:else}
          <span class="dot" style={`--swatch:${row.colour}`} title={row.colour}></span>
        {/if}
        <input aria-label={row.added ? `Name of colour added ${nth}` : `Name of colour ${row.colour}`} title="What this colour stands for"
          placeholder={row.added ? 'Side A, Unknown…' : `What ${row.colour} stands for`} maxlength="40" bind:value={row.name} />
        {#if row.added}
          <button type="button" class="icon-act" aria-label={`Remove colour added ${nth}`} title="Remove"
            onclick={() => (rows = rows.filter((_, at) => at !== index))}><Icon name="x" size={11} /></button>
        {:else if row.name}
          <button type="button" class="icon-act" aria-label={`Clear the name of ${row.colour}`} title="Clear"
            onclick={() => (rows[index].name = '')}><Icon name="x" size={11} /></button>
        {/if}
      </div>
    {/if}
  {/each}
  {#if !rows.some((row) => !row.elsewhere)}<p class="empty">No colour here yet.</p>{/if}
  {#if rows.length < 12}
    <button type="button" class="text-act" onclick={() => (rows = [...rows, { colour: '#cc79a7', name: '', elsewhere: false, added: true }])}>
      <Icon name="plus" size={11} /> Add a colour</button>
  {/if}
  <p class="head">Icons</p>
  {#each marks as mark, index (mark.key)}
    {#if !mark.elsewhere || others}
      {@const label = badges.get(mark.key) ?? drawn(mark.key)?.name ?? 'Own icon'}
      <div class="row" class:elsewhere={mark.elsewhere}>
        <span class="mark" title={label}><MarkerSymbol symbol={badges.has(mark.key) ? mark.key : 'pin'} colour="#5b6470" icon={drawn(mark.key)} size={20} /></span>
        <input aria-label={`Name of icon ${label}`} title="What this icon stands for" placeholder={label} maxlength="40" bind:value={mark.name} />
        {#if mark.name}
          <button type="button" class="icon-act" aria-label={`Clear the name of icon ${label}`} title="Clear"
            onclick={() => (marks[index].name = '')}><Icon name="x" size={11} /></button>
        {/if}
      </div>
    {/if}
  {/each}
  {#if !marks.some((mark) => !mark.elsewhere)}<p class="empty">No icon here yet.</p>{/if}
  {#if elsewhere}
    <button type="button" class="text-act" aria-expanded={others} onclick={() => (others = !others)}>
      <Icon name={others ? 'chevronDown' : 'chevronRight'} size={11} />
      {elsewhere === 1 ? '1 other name' : `${elsewhere} other names`} in this case</button>
  {/if}
  <div class="actions">
    <button type="button" class="btn btn-sm" onclick={() => onclose?.()}>Cancel</button>
    <button type="button" class="btn btn-sm btn-primary" disabled={busy} onclick={save}>Save names</button>
  </div>
</div>

<style>
  .palette-editor { padding: 2px 3px 3px; }
  .note { margin: 0 0 6px; color: var(--text-3); font-size: 10.5px; line-height: 1.4; }
  .head { margin: 8px 0 2px; color: var(--text-3); font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
  .row { display: flex; align-items: center; gap: 5px; margin-top: 4px; }
  .row.elsewhere { opacity: .8; }
  .row input:not([type='color']) { flex: 1; min-width: 0; height: 25px; padding: 3px 6px; font-size: var(--fs-xs); }
  input[type='color'] { width: 26px; height: 24px; padding: 1px; border: 1px solid var(--border); background: var(--bg-1); cursor: pointer; }
  .dot { flex: none; width: 16px; height: 16px; margin: 0 5px; border-radius: 50%; background: var(--swatch); border: 1px solid #0003; }
  .mark { display: grid; place-items: center; flex: none; width: 26px; height: 24px; }
  .icon-act { display: grid; place-items: center; flex: none; width: 22px; height: 22px; color: var(--text-3); cursor: pointer; }
  .text-act { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; color: var(--text-3); font-size: 10px; cursor: pointer; }
  .text-act:hover { color: var(--text-1); }
  .empty { margin: 2px 0 0; color: var(--text-3); font-size: 10.5px; }
  .actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
</style>
