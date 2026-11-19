<script>
  /**
   * Settings › Publishing › Styles: what each note style carries, set once for every
   * note that keeps its style's own. A column per style, a row per thing a document
   * adds after its text (the sources list and the five annexes), then how its sources
   * are written and how strictly its links are checked. A note changes any of these in
   * its Look, and a template keeps its own.
   *
   * The table comes with the settings (`prefs.noteStyles`, Azimut's own where nothing
   * changed it) and goes back whole on each change; the server keeps only what differs
   * from Azimut's own, which the settings backup carries. The hover texts live in
   * `lib/publishingHelp.js`.
   */
  import { prefs } from '../../lib/state.svelte.js';
  import { PUBLISHING_HELP as HELP } from '../../lib/publishingHelp.js';
  import { ANNEXES, LINK_CHECKS, SOURCES_STYLES, STYLES, STYLE_DEFAULTS, stylesTable } from '../../lib/notes/look.js';

  let { savePrefs } = $props();

  const table = $derived(stylesTable(prefs.noteStyles));
  const ROWS = [
    { id: 'sources', label: 'Sources', note: 'numbered, linked from the text', help: HELP.styleSources },
    ...ANNEXES.map((annex) => ({
      id: annex.id,
      label: annex.label,
      note: { geolocations: 'every proof cited', credits: 'imagery, maps, terrain, footage', method: 'generated facts, never prose',
        limits: 'the Limits boxes, gathered', editions: 'earlier editions, what changed' }[annex.id],
      help: { geolocations: HELP.styleGeolocations, credits: HELP.styleCredits, method: HELP.styleMethod,
        limits: HELP.styleLimits, editions: HELP.styleEditions }[annex.id],
    })),
  ];
  const changedAny = $derived(JSON.stringify(table) !== JSON.stringify(stylesTable(STYLE_DEFAULTS)));

  async function put(style, key, value) {
    const next = stylesTable(table);
    next[style] = { ...next[style], [key]: value };
    const saved = await savePrefs?.({ note_styles: next });
    if (!saved) prefs.noteStyles = table;
  }

  function reset() {
    savePrefs?.({ note_styles: {} });
  }
</script>

<section class="group note-styles" data-guide="settings.note-styles">
  <h3>Styles</h3>
  <p class="note">
    What each style carries, for every note that keeps its style's own. A note changes any of these in its Look,
    and a template keeps its own. The settings backup carries this table.
  </p>
  <div class="grid" role="table" aria-label="What each style carries">
    <div class="line head" role="row">
      <span class="cell name" role="columnheader"></span>
      {#each STYLES as style (style.id)}
        <span class="cell" role="columnheader" data-style={style.id}>{style.label}</span>
      {/each}
    </div>
    <div class="line part" role="row"><span class="cell name" role="rowheader">At the end</span></div>
    {#each ROWS as row (row.id)}
      <div class="line" role="row" data-row={row.id}>
        <span class="cell name" role="rowheader" title={row.help}>{row.label}<span class="hint">{row.note}</span></span>
        {#each STYLES as style (style.id)}
          <span class="cell" role="cell">
            <label class="switch" title={`${style.label}: ${row.help}`}>
              <input type="checkbox" role="switch" checked={table[style.id][row.id]} title={`${style.label}: ${row.help}`}
                aria-label={`${style.label}: ${row.label}`} onchange={(event) => put(style.id, row.id, event.currentTarget.checked)} />
              <span class="track" aria-hidden="true"><span class="knob"></span></span>
            </label>
          </span>
        {/each}
      </div>
    {/each}
    <div class="line part" role="row"><span class="cell name" role="rowheader">Sources</span></div>
    <div class="line" role="row" data-row="sources_style">
      <span class="cell name" role="rowheader" title={HELP.styleWritten}>Written as</span>
      {#each STYLES as style (style.id)}
        <span class="cell" role="cell">
          <select class="input pick" value={table[style.id].sources_style} title={`${style.label}: ${HELP.styleWritten}`}
            aria-label={`${style.label}: sources written as`} onchange={(event) => put(style.id, 'sources_style', event.currentTarget.value)}>
            {#each SOURCES_STYLES as choice (choice.id)}<option value={choice.id}>{choice.label}</option>{/each}
          </select>
        </span>
      {/each}
    </div>
    <div class="line" role="row" data-row="link_check">
      <span class="cell name" role="rowheader" title={HELP.styleCheck}>Link check before export<span class="hint">while sources are listed</span></span>
      {#each STYLES as style (style.id)}
        <span class="cell" role="cell">
          <select class="input pick" value={table[style.id].link_check} title={`${style.label}: ${HELP.styleCheck}`}
            aria-label={`${style.label}: link check`} onchange={(event) => put(style.id, 'link_check', event.currentTarget.value)}>
            {#each LINK_CHECKS as choice (choice.id)}<option value={choice.id}>{choice.label}</option>{/each}
          </select>
        </span>
      {/each}
    </div>
  </div>
  <div class="foot">
    <button type="button" class="btn btn-sm" title={HELP.stylesReset} disabled={!changedAny} onclick={reset}>Reset to Azimut's defaults</button>
    <span class="row-hint">Plain prints as it always did. A change here reaches a note's next export, never a file already written.</span>
  </div>
</section>

<style>
  .grid { display: flex; flex-direction: column; margin-top: 8px; overflow-x: auto; }
  .line { display: grid; grid-template-columns: minmax(136px, 1.2fr) repeat(5, minmax(88px, 1fr)); align-items: center; border-bottom: 1px solid var(--border); }
  .line.head { border-bottom-color: var(--border-strong); }
  .line.head .cell { padding: 8px 4px; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; }
  .line.part { border-bottom: none; }
  .line.part .name { padding: 14px 0 4px; color: var(--text-3); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .cell { display: flex; justify-content: center; padding: 7px 3px; min-width: 0; }
  .cell.name { flex-direction: column; justify-content: center; align-items: flex-start; color: var(--text-1); font-size: var(--fs-sm); }
  .hint { color: var(--text-3); font-size: var(--fs-xs); }
  .pick { width: 100%; max-width: 104px; padding: 3px 2px 3px 6px; font-size: 11px; }
  .foot { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
  .switch { position: relative; display: inline-flex; cursor: pointer; }
  .switch input { position: absolute; inset: 0; width: 26px; height: 15px; margin: 0; opacity: 0; cursor: pointer; z-index: 1; }
  .track {
    position: relative; flex: none; width: 26px; height: 15px; border-radius: 999px; background: var(--bg-3);
    box-shadow: inset 0 0 0 1px var(--border-strong); transition: background .15s;
  }
  .knob { position: absolute; top: 2px; left: 2px; width: 11px; height: 11px; border-radius: 50%; background: var(--text-3); transition: transform .15s var(--ease); }
  .switch input:checked + .track { background: var(--accent); box-shadow: none; }
  .switch input:checked + .track .knob { transform: translateX(11px); background: var(--accent-text); }
  .switch input:focus-visible + .track { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
