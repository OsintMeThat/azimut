<script>
  /**
   * To Post, in the Notebook's header beside PDF: the note's public edition, or the
   * stretch selected in it, opened in Post as a Free post thread to read, edit and
   * publish (`lib/notes/toPost.js`). Nothing is posted from here.
   */
  import { toast } from '../../lib/state.svelte.js';
  import { noteToPost } from '../../lib/notes/toPost.js';
  import Icon from '../../components/Icon.svelte';

  let {
    caseId,
    /** The note's id, `case` for the case notes. */
    noteId,
    /** The note as the editor holds it. */
    text = '',
    /** The stretch selected in it, `{ from, to }`, or null for the whole note. */
    selection = null,
    /** Whether the note is read and can be sent. */
    ready = true,
  } = $props();

  let busy = $state(false);
  const empty = $derived(!/\S/.test(text ?? ''));
  const title = $derived(selection
    ? 'Opens Post with the selection as a thread, its public edition only'
    : 'Opens Post with this note as a thread, its public edition only');

  async function send() {
    if (busy || empty || !ready) return;
    busy = true;
    try {
      await noteToPost(caseId, noteId, text, selection);
    } catch (error) {
      toast(`Not sent to Post: ${error.message}`, 'danger');
    } finally {
      busy = false;
    }
  }
</script>

<!-- its words go when the header narrows (`.wide-only` in the Notebook), its icon and title stay -->
<button class="btn btn-sm" {title} aria-label="To Post" data-guide="notebook.to-post" disabled={!ready || empty || busy} onclick={send}>
  <Icon name="post" size={14} /><span class="wide-only">To Post</span></button>
