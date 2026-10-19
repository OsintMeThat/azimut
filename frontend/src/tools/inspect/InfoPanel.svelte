<script>
  import { api } from '../../lib/api.js';
  import { fmtCoords } from '../../lib/state.svelte.js';
  import { copyText } from '../../lib/clipboard.js';
  import { openMapAt } from '../../lib/navigate.js';
  import { infoSections, metadataRows } from '../../lib/inspectInfo.js';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';
  import Icon from '../../components/Icon.svelte';

  // The Info tab: what the open file says about itself, and about the frame
  // picked from it. The sidecar is read once per file; the probe comes from the
  // player, which opened the file with it.
  let { caseId, source, probe = null, frame = null } = $props();

  let item = $state(null);
  let loadedPath = null;

  $effect(() => {
    const path = source?.path;
    if (!caseId || !path || path === loadedPath) return;
    loadedPath = path;
    item = null;
    api.get(`/api/cases/${caseId}/media/item?path=${encodeURIComponent(path)}`)
      .then((found) => {
        if (loadedPath === path) item = found;
      })
      .catch(() => {});
  });

  const sections = $derived(infoSections({ item, probe, frame, fileKind: source?.kind }));
  const dump = $derived(metadataRows(item));
</script>

<div class="info">
  {#each sections as section (section.title)}
    <section>
      <h4>{section.title}</h4>
      <dl>
        {#each section.rows as row (row.k)}
          <dt>{row.k}</dt>
          <dd>
            {#if row.kind === 'hash'}
              <span class="mono hash" title={row.v}>{row.v}</span>
              <button class="btn btn-ghost btn-xs" onclick={() => copyText(row.v)} title={INSPECT_HELP.copyHash} aria-label="Copy the SHA-256">
                <Icon name="copy" size={12} />
              </button>
            {:else if row.kind === 'link'}
              <a class="mono link" href={row.v} target="_blank" rel="noreferrer" title={row.v}>{row.v}</a>
            {:else if row.kind === 'gps'}
              <span class="mono">{fmtCoords(row.v.lat, row.v.lon)}</span>
              <span class="gps-actions">
                <button class="btn btn-ghost btn-xs" onclick={() => openMapAt('satellite', { lat: row.v.lat, lon: row.v.lon, zoom: 16 })} title={INSPECT_HELP.showOnMap}>
                  <Icon name="satellite" size={12} /> Map
                </button>
                <button class="btn btn-ghost btn-xs" onclick={() => copyText(`${row.v.lat}, ${row.v.lon}`)} title={INSPECT_HELP.copyCoords} aria-label="Copy the coordinates">
                  <Icon name="copy" size={12} />
                </button>
              </span>
            {:else}
              {row.v}
            {/if}
          </dd>
        {/each}
      </dl>
    </section>
  {/each}
  {#if item && !item.taken_at && !item.gps}
    <p class="hint">The file carries no capture date or position.</p>
  {/if}
  {#if dump.length}
    <details class="dump">
      <summary title={INSPECT_HELP.allMetadata}>All metadata <span class="count">{dump.length}</span></summary>
      <dl>
        {#each dump as [k, v] (k)}
          <dt title={k}>{k}</dt>
          <dd class="raw">{v}</dd>
        {/each}
      </dl>
    </details>
  {/if}
</div>

<style>
  .info {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  h4 {
    margin: 0 0 6px;
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  dl {
    display: grid;
    grid-template-columns: 86px 1fr;
    gap: 4px 10px;
    margin: 0;
    font-size: var(--fs-sm);
  }
  dt {
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  dd {
    margin: 0;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-1);
    overflow-wrap: anywhere;
  }
  .hash,
  .link {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-xs);
  }
  .link {
    color: var(--accent);
  }
  .gps-actions {
    display: inline-flex;
    margin-left: auto;
  }
  .hint {
    margin: 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .dump summary {
    cursor: pointer;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-2);
    margin-bottom: 6px;
  }
  .count {
    color: var(--text-3);
    font-weight: 400;
  }
  .dump dl {
    font-size: var(--fs-xs);
  }
  .raw {
    color: var(--text-2);
    display: block;
  }
</style>
