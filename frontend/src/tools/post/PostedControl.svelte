<script>
  /**
   * Where the open post stands, in the header beside Saved, and the one place to say it
   * went out. A draft shows **Mark as posted**, which opens its popover (`MarkPosted`):
   * the link when the analyst has it, or none. Once marked, a green pill says
   * **Posted · 9 Nov**, or an amber one **Changed since posted**, and its menu opens the
   * post, copies its link, adds or changes the link, or takes it back (**Not posted**).
   * After Publish, Reply or the extension's hand-off, the button wears a soft accent until
   * the post is marked or closed. A link the extension caught for this post stands here
   * as a proposal, never kept by itself: **Keep** or **Not this one**.
   *
   * At the header's narrowest step (`iconOnly`) it shows its icon, its words in the hover.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import { copyText } from '../../lib/clipboard.js';
  import { shortLink } from './postHome.js';
  import MarkPosted from './MarkPosted.svelte';

  let {
    /** 'draft', 'posted' or 'changed' (`lib/post.js` `postState`). */
    standing = 'draft',
    /** Its link, once posted with one. */
    url = null,
    /** The day it went out, as `postedDay` says it. */
    day = '',
    /** The site was opened with it and it is not marked yet. */
    accent = false,
    iconOnly = false,
    /** `{ url }`: a link the extension caught for this post, waiting for a word. */
    proposal = null,
    /** `(url)`: marked posted, with this link or none (null). */
    onmark,
    onunmark,
    onkeep,
    ondismiss,
  } = $props();

  let opener = $state(null);
  let asking = $state(false);
  let menu = $state(false);

  /** Open the popover, for a proof the home says is posted already. */
  export function ask() {
    menu = false;
    asking = true;
  }

  const posted = $derived(standing !== 'draft');
  const said = $derived(standing === 'changed' ? 'Changed since posted' : `Posted${day ? ` · ${day}` : ''}`);

  function submit(link) {
    asking = false;
    onmark?.(link);
    opener?.focus();
  }

  function act(what) {
    menu = false;
    if (what === 'copy') copyText(url, { said: 'Link copied' });
    else if (what === 'link') asking = true;
    else if (what === 'unmark') onunmark?.();
  }
</script>

{#if proposal}
  <span class="pc-caught" role="group" aria-label="Link caught" title={proposal.url}>
    <Icon name="link" size={12} />
    <span class="pc-caught-said">{#if iconOnly}Link caught{:else}Link caught: <span class="pc-caught-url">{shortLink(proposal.url)}</span>{/if}</span>
    <button type="button" class="btn btn-primary btn-xs" title="Mark this post posted at that link" onclick={() => onkeep?.()}>Keep</button>
    <button type="button" class="btn btn-ghost btn-xs" title="Leave that link out" onclick={() => ondismiss?.()}>Not this one</button>
  </span>
{:else if !posted}
  <button type="button" class="btn btn-sm pc-mark" class:accent bind:this={opener}
    aria-haspopup="dialog" aria-expanded={asking} aria-label="Mark as posted"
    title={iconOnly ? 'Mark as posted' : 'Say it went out, with its link if you have it'} onclick={() => (asking = !asking)}>
    <Icon name="check" size={13} />{#if !iconOnly}<span>Mark as posted</span>{/if}
  </button>
{:else}
  <button type="button" class="pc-pill {standing}" bind:this={opener} aria-haspopup="menu" aria-expanded={menu}
    aria-label={said} title={standing === 'changed' ? `Edited after it went out${day ? ` on ${day}` : ''}` : said}
    onclick={() => (menu = !menu)}>
    <Icon name={standing === 'changed' ? 'alert' : 'check'} size={12} />{#if !iconOnly}<span>{said}</span>{/if}<Icon name="chevronDown" size={11} />
  </button>
{/if}

{#if menu && opener}
  <FloatingMenu anchor={opener} width={210} label="Where this post stands" onclose={() => (menu = false)}>
    {#if url}
      <a class="fm-item" href={url} target="_blank" rel="noreferrer" onclick={() => (menu = false)}>
        <Icon name="external" size={14} /><span class="fm-grow">Open the post</span></a>
      <button type="button" class="fm-item" onclick={() => act('copy')}><Icon name="copy" size={14} /><span class="fm-grow">Copy link</span></button>
    {/if}
    <button type="button" class="fm-item" onclick={() => act('link')}>
      <Icon name="link" size={14} /><span class="fm-grow">{url ? 'Change link…' : 'Add the link…'}</span></button>
    <div class="fm-sep"></div>
    <button type="button" class="fm-item" title="Back to Draft, for a post marked posted by mistake" onclick={() => act('unmark')}>
      <Icon name="undo" size={14} /><span class="fm-grow">Not posted</span></button>
  </FloatingMenu>
{/if}

{#if asking && opener}
  <MarkPosted anchor={opener} link={url ?? ''} submitLabel={posted ? 'Save link' : 'Mark as posted'}
    onsubmit={submit} oncancel={() => (asking = false)} />
{/if}

<style>
  .pc-mark { flex: none; gap: 5px; }
  /* the site was opened with it: a soft accent until it is marked or closed */
  .pc-mark.accent { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); background: var(--accent-soft); color: var(--accent); }
  :global(:root[data-theme='light']) .pc-mark.accent { color: color-mix(in srgb, var(--accent) 60%, var(--text-1)); }
  .pc-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: none;
    height: 24px;
    padding: 0 8px 0 9px;
    border-radius: 999px;
    font-size: var(--fs-xs);
    font-weight: 650;
    white-space: nowrap;
  }
  .pc-pill.posted { background: color-mix(in srgb, var(--ok) 18%, transparent); color: var(--ok); }
  .pc-pill.changed { background: color-mix(in srgb, var(--warn) 20%, transparent); color: var(--warn); }
  /* green and amber on their own soft ground are too faint on white: darkened there */
  :global(:root[data-theme='light']) .pc-pill.posted { color: color-mix(in srgb, var(--ok) 70%, var(--text-1)); }
  :global(:root[data-theme='light']) .pc-pill.changed { color: color-mix(in srgb, var(--warn) 60%, var(--text-1)); }
  .pc-pill:hover { filter: brightness(1.12); }
  .pc-pill:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .pc-caught {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 0 1 auto;
    min-width: 0;
    height: 26px;
    padding: 0 3px 0 9px;
    border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--text-1);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .pc-caught > :global(svg) { flex: none; color: var(--accent); }
  .pc-caught-said { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .pc-caught-url { font-family: var(--font-mono); }
  .pc-caught .btn { flex: none; }
  .pc-caught .btn-xs { border-radius: 999px; }
</style>
