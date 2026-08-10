<script>
  /** Read-only detail for an entity copied into an analysis snapshot. */
  import { entityIcon } from '../lib/entityIcon.js';
  import { entityLabel } from '../lib/entityTypes.svelte.js';
  import { loadRelationTypes, relationVerb } from '../lib/relations.svelte.js';
  import Icon from './Icon.svelte';

  loadRelationTypes();

  let { entity, entities = [], links = [] } = $props();

  const byId = $derived(new Map(entities.map((item) => [item.id, item])));
  const relations = $derived(
    links.filter((link) => link.from === entity.id || link.to === entity.id)
  );
  const fields = $derived(
    Object.entries(entity.attrs ?? {}).filter(([, value]) => value != null && value !== '')
  );
  const label = (key) => key.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
  const value = (held) =>
    typeof held === 'object' ? JSON.stringify(held, null, 2) : String(held);
</script>

<div class="snapshot-detail">
  <p class="notice"><Icon name="clock" size={13} /> Captured data. Nothing here edits the case.</p>

  <header>
    <Icon name={entityIcon(entity)} size={22} />
    <div>
      <h3>{entity.label}</h3>
      <p>{entityLabel(entity.type)}</p>
    </div>
  </header>

  {#if entity.snapshot_images?.length}
    <section>
      <h4>Captured photos</h4>
      <div class="photos">
        {#each entity.snapshot_images as image (image.id)}
          <figure>
            <img src={image.data} alt={image.title} />
            <figcaption>{image.title}</figcaption>
          </figure>
        {/each}
      </div>
    </section>
  {/if}

  {#if fields.length}
    <section>
      <h4>Fields</h4>
      <dl>
        {#each fields as [key, held] (key)}
          <div><dt>{label(key)}</dt><dd><pre>{value(held)}</pre></dd></div>
        {/each}
      </dl>
    </section>
  {/if}

  <section>
    <h4>Provenance</h4>
    <dl>
      {#if entity.provenance?.by}<div><dt>Filed by</dt><dd>{entity.provenance.by}</dd></div>{/if}
      {#if entity.provenance?.at}<div><dt>Filed at</dt><dd>{entity.provenance.at}</dd></div>{/if}
      {#if entity.provenance?.status}<div><dt>Status</dt><dd>{entity.provenance.status}</dd></div>{/if}
      {#if entity.provenance?.source}<div><dt>Source</dt><dd>{entity.provenance.source}</dd></div>{/if}
    </dl>
  </section>

  {#if relations.length}
    <section>
      <h4>Captured relations</h4>
      <ul>
        {#each relations as relation (relation.id)}
          {@const otherId = relation.from === entity.id ? relation.to : relation.from}
          <li>
            <span>{relation.from === entity.id ? relationVerb(relation.type) : 'linked from'}</span>
            <strong>{byId.get(otherId)?.label ?? otherId}</strong>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .snapshot-detail { display: grid; gap: 16px; }
  .notice { display: flex; align-items: center; gap: 6px; margin: 0; padding: 8px 10px; border-radius: var(--r-sm); background: var(--accent-soft); color: var(--text-2); font-size: var(--fs-xs); }
  header { display: flex; align-items: center; gap: 10px; }
  h3, h4, p { margin: 0; }
  header p { margin-top: 2px; color: var(--text-3); font-size: var(--fs-sm); }
  h4 { margin-bottom: 8px; color: var(--text-2); font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: .04em; }
  .photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
  figure { margin: 0; }
  img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: var(--r-sm); background: var(--bg-0); }
  figcaption { margin-top: 3px; overflow: hidden; color: var(--text-3); font-size: var(--fs-xs); text-overflow: ellipsis; white-space: nowrap; }
  dl { display: grid; gap: 1px; margin: 0; }
  dl > div { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--border); }
  dt { color: var(--text-3); font-size: var(--fs-xs); }
  dd { min-width: 0; margin: 0; color: var(--text-1); font-size: var(--fs-sm); }
  pre { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; font: inherit; }
  ul { margin: 0; padding: 0; list-style: none; }
  li { display: flex; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: var(--fs-sm); }
  li span { color: var(--text-3); }
</style>
