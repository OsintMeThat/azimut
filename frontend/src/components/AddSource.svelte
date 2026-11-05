<script>
  /**
   * A web source for the pinned note: a link pasted or typed, looked up in the case
   * (`lib/notes/sources.js`). An item already filed for it is cited; else the link is
   * kept as a bookmark named from its address, or the post is downloaded, which is the
   * one press here that reaches the network.
   */
  import { onDestroy } from 'svelte';
  import { lookupSource, citeOffer, bookmarkOffer, downloadOffer, sourceAddress } from '../lib/notes/sources.js';
  import Icon from './Icon.svelte';
  import FloatingMenu from './FloatingMenu.svelte';

  let { caseId, anchor, onpick = () => {}, onclose = () => {}, lookup = lookupSource } = $props();

  let typed = $state('');
  let answer = $state(null);
  let error = $state('');
  let asking = $state(false);
  let timer = null;
  let asked = 0;

  const address = $derived(sourceAddress(typed));
  const found = $derived(answer?.url === address ? answer.found ?? [] : []);
  const ready = $derived(Boolean(address && answer?.url === address));

  function read() {
    clearTimeout(timer);
    error = '';
    if (!address) {
      answer = null;
      return;
    }
    const wanted = address;
    const ask = (asked += 1);
    timer = setTimeout(async () => {
      asking = true;
      try {
        const result = await lookup(caseId, wanted);
        if (ask === asked) answer = { ...result, url: wanted };
      } catch (problem) {
        if (ask === asked) error = problem.message || 'The link could not be read';
      } finally {
        if (ask === asked) asking = false;
      }
    }, 200);
  }
  onDestroy(() => clearTimeout(timer));

  function pick(offer) {
    onpick(offer);
  }

  function key(event) {
    if (event.key !== 'Enter' || !ready) return;
    event.preventDefault();
    pick(found.length ? citeOffer(found[0]) : bookmarkOffer(caseId, answer));
  }
</script>

<FloatingMenu {anchor} width={320} label="A source" role="dialog" align="end" {onclose}>
  <div class="source">
    <!-- svelte-ignore a11y_autofocus -->
    <input class="input" type="url" bind:value={typed} oninput={read} onkeydown={key} autofocus
      placeholder="Paste a link" aria-label="Link to cite" spellcheck="false" />
    {#if typed.trim() && !address}
      <p class="said">A link starts with http:// or https://</p>
    {:else if error}
      <p class="said bad">{error}</p>
    {:else if ready && found.length}
      <p class="said">Already in the case</p>
      {#each found.slice(0, 3) as entity (entity.id)}
        <button type="button" class="fm-item" title="Cite it in the note" onclick={() => pick(citeOffer(entity))}>
          <Icon name={entity.type === 'bookmark' ? 'bookmark' : entity.attrs?.kind === 'video' ? 'video' : 'image'} size={13} />
          <span class="fm-grow">Cite “{entity.label}”</span>
        </button>
      {/each}
    {:else if ready}
      <p class="said" title={answer.url}>{answer.title}</p>
      <button type="button" class="fm-item" title="Keep the link in the case and cite it. Nothing is fetched"
        onclick={() => pick(bookmarkOffer(caseId, answer))}>
        <Icon name="bookmark" size={13} /><span class="fm-grow">Bookmark</span><small>offline</small>
      </button>
      <button type="button" class="fm-item" title="Download the post into the case, with its hash and date, and cite it"
        onclick={() => pick(downloadOffer(caseId, answer.url))}>
        <Icon name="download" size={13} /><span class="fm-grow">Download</span>
      </button>
    {:else if asking}
      <p class="said">Looking in the case…</p>
    {:else}
      <p class="said">Looked up in the case first, so nothing is filed twice.</p>
    {/if}
  </div>
</FloatingMenu>

<style>
  .source { display: flex; flex-direction: column; gap: 4px; padding: 4px; }
  .source .input { width: 100%; box-sizing: border-box; margin-bottom: 2px; }
  .said { margin: 2px 6px; color: var(--text-3); font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .said.bad { color: var(--danger); white-space: normal; }
  small { color: var(--text-3); font-size: var(--fs-xs); }
</style>
