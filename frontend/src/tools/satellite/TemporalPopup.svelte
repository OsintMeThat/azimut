<script>
  /**
   * What one point holds inside the Timeline window, when you click it.
   *
   * The same card as the saved index's, read for a different question: not "what do
   * I already have here?" but "what does this window put here?". So a row leads with
   * what it is — a photograph shows itself — and then says when.
   *
   * Two ways out of every row, because a mark on the map is not the end of the
   * gesture: the entry on the axis it came from, and the thing itself in the tool
   * that owns it.
   */
  import Icon from '../../components/Icon.svelte';
  import { entityIcon, mediaKindOf } from '../../lib/entityIcon.js';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { ENTITY_TOOL, openEntity, opensInFileManager } from '../../lib/navigate.js';
  import { TIMELINE_CATEGORIES, formatTemporalValue, zonedStamp } from '../../lib/timeline.js';

  let { place = null, items = [], caseId = '', onopen, onleave } = $props();

  const CATEGORY = Object.fromEntries(
    TIMELINE_CATEGORIES.map((category) => [category.id, category.short])
  );
  const TOOL = {
    media: 'Media', proof: 'Proof', place: 'Map', post: 'Post',
    'inspect-session': 'Inspect', note: 'Notebook', bookmark: 'the source',
    capture: 'Map',
  };

  const ordered = $derived(
    [...items].sort((left, right) => String(left.earliest).localeCompare(String(right.earliest)))
  );

  const owner = (item) => item.owner ?? { id: item.owner_id, type: item.owner_type, attrs: {} };
  const preview = (item) => {
    const held = owner(item);
    return held.thumb && caseId && mediaKindOf(held) !== 'file' ? fileUrl(caseId, held.thumb) : '';
  };

  /**
   * The file itself, for a tab of its own.
   *
   * Only what the browser can actually show: handed a PDF or a spreadsheet a new tab
   * downloads it, which quietly makes a second copy the case knows nothing about.
   * Those open in the folder instead, which is what following the row already does.
   */
  function rawFile(item) {
    const held = owner(item);
    const path = held.attrs?.path;
    return held.type === 'media' && path && caseId && mediaKindOf(held) !== 'file'
      ? fileUrl(caseId, path)
      : '';
  }

  /**
   * When, short enough to sit beside the title.
   *
   * The full reading names the timezone and every recorded decimal, which is right in
   * the inspector and four wrapped lines wide in a card this size.
   */
  function when(item) {
    if (!item.raw) return '';
    if (!item.raw.includes('T')) return formatTemporalValue(item.raw).label;
    const stamp = zonedStamp(item.earliest);
    return stamp ? `${stamp.slice(8, 10)} ${stamp.slice(5, 7)} · ${stamp.slice(11, 16)}` : '';
  }

  /** Where this row's own thing is read, when the app has somewhere to read it. */
  function opensIn(item) {
    const held = owner(item);
    if (opensInFileManager(held)) return 'the folder';
    if (held.type === 'bookmark' && !held.attrs?.url) return '';
    return TOOL[held.type] ?? (held.id ? 'Board' : '');
  }

  function follow(item) {
    const held = owner(item);
    if (!held?.id) return;
    onleave?.();
    openEntity(held);
  }
</script>

<div class="pop">
  <header>
    <span class="where">{place?.label || 'Place'}</span>
    {#if ordered.length > 1}<span class="tally">{ordered.length} here</span>{/if}
  </header>

  <div class="stack" class:scrolls={ordered.length > 2}>
    {#each ordered as item (item.id)}
      {@const held = owner(item)}
      {@const shot = preview(item)}
      {@const tool = opensIn(item)}
      {@const raw = rawFile(item)}
      <div class="entry">
        <button
          type="button"
          class="preview"
          title={tool ? `Open in ${tool}` : 'Open on the Timeline'}
          onclick={() => (tool ? follow(item) : onopen(item))}
        >
          {#if shot}
            <img src={shot} alt="" loading="lazy" decoding="async" />
            {#if mediaKindOf(held) === 'video'}<span class="play"><Icon name="play" size={13} /></span>{/if}
          {:else}
            <Icon name={entityIcon(held) ?? 'clock'} size={18} />
          {/if}
        </button>
        <div class="body">
          <button type="button" class="title" onclick={() => onopen(item)}>
            {item.label || 'Untitled'}
          </button>
          <p class="meta">
            {#if when(item)}<span class="mono">{when(item)}</span>{/if}
            <span class="kind">{CATEGORY[item.category] ?? item.category}</span>
            {#if item.uncertain}<span title="Recorded as uncertain">uncertain</span>{/if}
            {#if item.approximate}<span title="Recorded as approximate">approximate</span>{/if}
          </p>
          <p class="acts">
            <button type="button" class="link" onclick={() => onopen(item)}>On the Timeline</button>
            {#if tool}
              <button type="button" class="link" onclick={() => follow(item)}>Open in {tool}</button>
            {/if}
            {#if raw}
              <a
                class="link out"
                href={raw}
                target="_blank"
                rel="noopener noreferrer"
                title="Open the file in a new tab"
              ><Icon name="external" size={10} /></a>
            {/if}
          </p>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .pop { width: 292px; font-family: var(--font-sans); }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }
  .where { color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; }
  .tally { color: var(--accent); font-size: var(--fs-xs); white-space: nowrap; }
  .stack { display: flex; flex-direction: column; }
  /* two entries fit; past that the card scrolls rather than growing off-map */
  .stack.scrolls { max-height: 244px; overflow-y: auto; }
  .entry { display: flex; gap: 9px; padding: 8px 0; }
  .entry + .entry { border-top: 1px solid var(--border); }
  .preview {
    position: relative;
    flex: 0 0 auto;
    display: grid;
    width: 66px;
    height: 48px;
    place-items: center;
    overflow: hidden;
    border: 0;
    border-radius: var(--r-sm);
    background: var(--bg-3);
    color: var(--text-3);
    cursor: pointer;
  }
  .preview img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .preview:hover { box-shadow: 0 0 0 1px var(--accent); }
  .play {
    position: absolute;
    display: grid;
    width: 22px;
    height: 22px;
    place-items: center;
    border-radius: 50%;
    background: rgba(0, 0, 0, .58);
    color: #fff;
  }
  .body { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .title {
    overflow: hidden;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-1);
    font: inherit;
    font-size: var(--fs-xs);
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .title:hover { color: var(--accent); }
  .meta { display: flex; flex-wrap: wrap; gap: 6px; color: var(--text-3); font-size: 9px; }
  .meta .mono { font-family: var(--mono); }
  .kind { text-transform: capitalize; }
  .acts { display: flex; flex-wrap: wrap; gap: 8px; }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 9px;
    cursor: pointer;
  }
  .link:hover { text-decoration: underline; }
  .out { display: inline-grid; place-items: center; text-decoration: none; }
  .out:hover { color: var(--text-1); }
</style>
