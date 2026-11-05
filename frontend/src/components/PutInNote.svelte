<script>
  /**
   * The row a tool's own menu shows while a note is pinned to the side:
   * `Put in “Port strike”`, for one thing the tool offers (`lib/noteHere.svelte.js`).
   * It names the note it writes to, and draws nothing when no note is pinned, so a
   * tool with no note open stays as it was.
   *
   * It sits in the export, capture or ⋯ menu the tool already has, where the hand
   * already goes. `named` adds what is put (`Put this point in “…”`) for a menu that
   * holds two, and `say` words it whole (`Quote the post in “…”`); `onput` lets the
   * menu close itself.
   */
  import { pinned, putInNote, shortTitle } from '../lib/notes/putInNote.svelte.js';
  import Icon from './Icon.svelte';

  let { offer, class: className = 'fm-item', role = 'menuitem', named = false, say = '', icon = true, onput = () => {} } = $props();

  const target = $derived(pinned.current);
  const what = $derived(named && offer?.label ? `${offer.label.charAt(0).toLowerCase()}${offer.label.slice(1)} ` : '');
  const words = $derived(say ? `${say} in` : `Put ${what}in`);

  function press() {
    // read before the menu closes: the offer may come from state the closing clears
    const chosen = offer;
    onput();
    void putInNote(chosen);
  }
</script>

{#if target && offer}
  <button type="button" class={className} {role} title={offer.hint || `Put it in the note on the side`} data-put={offer.id}
    onclick={press}>
    {#if icon}<Icon name="note" size={13} />{/if}<span class="fm-grow">{words} “{shortTitle(target.title)}”</span>
  </button>
{/if}
