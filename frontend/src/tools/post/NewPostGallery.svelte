<script>
  /**
   * New post: the four starts, one card each (`lib/post.js` POST_KINDS). Geolocation is
   * the composer Post has always been and comes first, marked as the usual one. A start
   * this version cannot open yet keeps its card, greyed and saying it comes next, so the
   * gallery reads the same once it arrives.
   */
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';
  import { POST_KINDS, STARTABLE_POST_KINDS } from '../../lib/post.js';

  let { onpick, onclose } = $props();
</script>

<Modal title="New post" width="640px" {onclose}>
  <p class="np-lead">Pick what the post is made from. Its template and its fields follow.</p>
  <div class="np-grid">
    {#each POST_KINDS as kind (kind.id)}
      {@const ready = STARTABLE_POST_KINDS.includes(kind.id)}
      <button type="button" class="np-card" class:usual={kind.id === 'geolocation'} disabled={!ready}
        aria-describedby={`np-${kind.id}`} onclick={() => onpick?.(kind.id)}>
        <span class="np-icon"><Icon name={kind.icon} size={20} /></span>
        <span class="np-words">
          <span class="np-name">
            {kind.label}
            {#if kind.id === 'geolocation'}<span class="np-tag">Usual</span>{/if}
            {#if !ready}<span class="np-tag soon">Coming next</span>{/if}
          </span>
          <span class="np-text" id={`np-${kind.id}`}>{kind.text}</span>
        </span>
      </button>
    {/each}
  </div>
</Modal>

<style>
  .np-lead { margin: 0 0 14px; color: var(--text-2); font-size: var(--fs-sm); }
  .np-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .np-card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    min-height: 92px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--bg-2);
    text-align: left;
    transition: border-color 0.14s var(--ease), transform 0.14s var(--ease), box-shadow 0.14s var(--ease);
  }
  .np-card:not(:disabled):hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: var(--shadow-2); }
  .np-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .np-card.usual { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); background: color-mix(in srgb, var(--accent) 7%, var(--bg-2)); }
  .np-card:disabled { cursor: default; opacity: 0.62; }
  .np-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .np-card:disabled .np-icon { background: var(--bg-3); color: var(--text-3); }
  .np-words { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .np-name { display: flex; align-items: center; gap: 8px; color: var(--text-1); font-size: var(--fs-md); font-weight: 650; }
  .np-text { color: var(--text-2); font-size: var(--fs-xs); line-height: 1.45; }
  .np-tag {
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 10.5px;
    font-weight: 600;
  }
  .np-tag.soon { background: var(--bg-3); color: var(--text-2); }
</style>
