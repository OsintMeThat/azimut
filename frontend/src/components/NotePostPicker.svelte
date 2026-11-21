<script>
  /**
   * `/` › Post from X or Bluesky: a pasted link, one per line for a thread, or a post the
   * case already holds (`lib/notes/postCards.js`). A pasted link is read once, on Add:
   * the block goes in the note at once and says how the read goes (`editor/postBlock.js`).
   * What the case holds needs no network: a post kept already, a file downloaded from a
   * post, or one of the analyst's own posts published from Post.
   */
  import { onMount } from 'svelte';
  import { postFromCase, postOffers } from '../lib/notes/postCards.js';
  import { pastedLinks } from '../lib/notes/editor/postText.js';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';

  /** `onlinks(links)` for pasted links, `onposts(ids)` for posts the case keeps. */
  let { caseId, onlinks, onposts, onclose, load = (id) => postOffers(id), keep = (id, from) => postFromCase(id, from) } = $props();

  let pasted = $state('');
  let offers = $state(null);
  let failed = $state('');
  let busy = $state('');
  /** The kept posts picked, in the order picked: a thread when there are several. */
  let picked = $state([]);

  onMount(async () => {
    try {
      offers = await load(caseId);
    } catch (error) {
      failed = error?.message || 'The case’s posts could not be read';
    }
  });

  const links = $derived(pastedLinks(pasted));
  const said = $derived(pasted.trim() && !links.length ? 'Not an X or Bluesky post address' : '');
  const held = $derived([...(offers?.kept ?? [])]);
  const others = $derived([...(offers?.downloaded ?? []).map((one) => ({ ...one, from: 'media' })),
    ...(offers?.mine ?? []).map((one) => ({ ...one, from: 'draft' }))]);

  function toggle(id) {
    picked = picked.includes(id) ? picked.filter((one) => one !== id) : [...picked, id];
  }

  function add(event) {
    event?.preventDefault();
    if (links.length) onlinks?.(links);
    else if (picked.length) onposts?.(picked);
  }

  /** A file downloaded from a post, or a published post, kept from what the case holds. */
  async function keepOne(row) {
    busy = row.url;
    try {
      const made = await keep(caseId, row.from === 'media' ? { media: row.path } : { draft: row.draft });
      onposts?.([...picked, made.id]);
    } catch (error) {
      failed = error?.message || 'That post could not be kept';
    } finally {
      busy = '';
    }
  }

  const SITE = { x: 'X', bluesky: 'Bluesky' };
</script>

<Modal title="Post from X or Bluesky" width="520px" align="top" {onclose}>
  <form class="post-picker" onsubmit={add}>
    <label class="field">
      <span>Link</span>
      <!-- svelte-ignore a11y_autofocus -->
      <textarea class="input links" rows="3" bind:value={pasted} autofocus spellcheck="false"
        placeholder="https://x.com/… or https://bsky.app/profile/…/post/…"
        onkeydown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) add(event); }}></textarea>
    </label>
    <p class="said" class:error={said}>
      {#if said}{said}{:else if links.length > 1}{links.length} posts, drawn as one thread in this order{:else}One link per line makes a thread. Its words, pictures and profile picture are read once and kept in the case.{/if}
    </p>

    {#if failed}
      <p class="said error">{failed}</p>
    {:else if !offers}
      <p class="said">Reading the case…</p>
    {:else if held.length || others.length}
      <div class="part">In the case</div>
      <div class="list">
        {#each held as row (row.id)}
          <label class="row" title={row.url}>
            <input type="checkbox" checked={picked.includes(row.id)} onchange={() => toggle(row.id)} />
            <span class="name" dir="auto">{row.label}</span>
            <small>{SITE[row.site] ?? row.site}</small>
          </label>
        {/each}
        {#each others as row (row.url)}
          <button type="button" class="row offer" title={row.from === 'media' ? 'From a file downloaded from this post' : 'Your own post, from its Post draft'}
            disabled={Boolean(busy)} onclick={() => keepOne(row)}>
            <Icon name={row.from === 'media' ? 'download' : 'post'} size={13} />
            <span class="name" dir="auto">{row.label}</span>
            <small>{busy === row.url ? 'Keeping…' : row.from === 'media' ? 'Downloaded' : 'Yours'}</small>
          </button>
        {/each}
      </div>
    {/if}

    <div class="actions">
      <button type="button" class="btn btn-ghost" onclick={() => onclose?.()}>Cancel</button>
      <button type="submit" class="btn btn-primary" disabled={!links.length && !picked.length}>
        {links.length ? (links.length > 1 ? 'Add the thread' : 'Add the post') : picked.length > 1 ? 'Add as a thread' : 'Add the post'}
      </button>
    </div>
  </form>
</Modal>

<style>
  .post-picker { display: flex; flex-direction: column; gap: 10px; }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-2); }
  .links { resize: vertical; min-height: 64px; font-family: var(--font-mono); font-size: 12.5px; }
  .said { margin: 0; font-size: 12px; color: var(--text-3); }
  .said.error { color: var(--danger); }
  .part { margin-top: 4px; font-size: 10.5px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); }
  .list { display: flex; flex-direction: column; max-height: 260px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; }
  .row { display: flex; align-items: center; gap: 8px; padding: 7px 10px; font: inherit; font-size: 13px; color: var(--text-1); cursor: pointer; text-align: left; }
  .list .row + .row { border-top: 1px solid var(--border); }
  .offer { border: none; background: none; }
  .offer:hover:not(:disabled) { background: var(--bg-3); }
  .offer:disabled { opacity: .6; cursor: default; }
  .row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row small { color: var(--text-3); }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
</style>
