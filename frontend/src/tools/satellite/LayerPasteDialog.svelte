<script>
  /**
   * A position from outside the case: coordinates, a map link, or a whole post.
   *
   * The text is read here and nowhere else, so nothing is fetched: what the post
   * links to stays a link. A text that cites an address is somebody else's
   * geolocation more often than the analyst's, so it starts out marked external.
   */
  import { untrack } from 'svelte';
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';
  import DayPicker from '../../components/DayPicker.svelte';
  import { api } from '../../lib/api.js';
  import { fmtCoords } from '../../lib/state.svelte.js';

  let { controller, onfly = null } = $props();
  // the clipboard it was opened with, taken once: the box is the analyst's afterwards
  let text = $state(untrack(() => controller.pasting?.text ?? ''));
  let read = $state(null);
  let reading = $state(false);
  let picked = $state([]);
  let links = $state([]);
  let date = $state('');
  let external = $state(false);
  let name = $state('');
  let asked = 0;

  /** Read again a moment after the text stops changing. */
  $effect(() => {
    const value = text;
    const ticket = ++asked;
    if (!value.trim()) { read = null; return; }
    reading = true;
    const timer = setTimeout(async () => {
      try {
        const body = await api.post('/api/geo/scan', { text: value });
        if (ticket !== asked) return;
        read = body;
        picked = body.points.map((_, index) => index);
        links = body.links;
        date = body.date;
        external = body.links.length > 0;
      } catch {
        if (ticket === asked) read = { points: [], links: [], date: '' };
      } finally {
        if (ticket === asked) reading = false;
      }
    }, 250);
    return () => clearTimeout(timer);
  });

  async function add() {
    const points = read.points.filter((_, index) => picked.includes(index))
      .map((point) => ({ lat: point.lat, lon: point.lon, ...(name.trim() ? { name: name.trim() } : {}) }));
    const fields = { ...(date ? { date } : {}), ...(links.length ? { links } : {}), ...(external ? { provenance: 'external' } : {}) };
    const answer = await controller.addPoints(points, fields);
    if (!answer) return;
    controller.closePaste();
    onfly?.({ geometry: { type: 'Point', coordinates: [points[0].lon, points[0].lat] } });
  }
</script>

<Modal title="Paste a position" onclose={() => controller.closePaste()} width="440px" align="top">
  <textarea aria-label="Pasted text" rows="4" bind:value={text}
    placeholder="Coordinates, a map link, or the text of a post"></textarea>
  {#if reading}
    <p class="note">Reading…</p>
  {:else if read && !read.points.length}
    <p class="note">No position in this text. Try coordinates like 48.8584, 2.2945 or a map link.</p>
  {:else if read}
    <ul aria-label="Positions found">
      {#each read.points as point, index}
        <li><label><input type="checkbox" value={index} bind:group={picked} />
          <span class="where">{fmtCoords(point.lat, point.lon)}</span><span class="from">{point.text}</span></label></li>
      {/each}
    </ul>
    <label class="field"><span>Name</span><input aria-label="Marker name" bind:value={name} maxlength="300" placeholder="Automatic name" /></label>
    <div class="field"><span>Day</span><DayPicker value={date} label="Day stated" placeholder="No day" clearable onpick={(day) => (date = day)} /></div>
    {#if links.length}
      <div class="field top"><span>Sources</span>
        <ul class="links">
          {#each links as link (link)}
            <li><span>{link}</span><button type="button" class="icon-act" aria-label="Leave this source out" title="Leave out"
              onclick={() => (links = links.filter((one) => one !== link))}><Icon name="x" size={11} /></button></li>
          {/each}
        </ul>
      </div>
    {/if}
    <label class="check"><input type="checkbox" bind:checked={external} /> Geolocated by someone else</label>
  {/if}
  <div class="actions">
    <button class="btn btn-sm" onclick={() => controller.closePaste()}>Cancel</button>
    <button class="btn btn-primary btn-sm" disabled={!read || !picked.length || controller.pending > 0} onclick={add}>
      {picked.length > 1 ? `Add ${picked.length} markers` : 'Add marker'}</button>
  </div>
</Modal>

<style>
  textarea { width: 100%; resize: vertical; }
  .note { margin: 8px 0 0; color: var(--text-3); font-size: var(--fs-xs); }
  ul { list-style: none; margin: 8px 0 0; padding: 0; }
  li label { display: flex; align-items: baseline; gap: 7px; padding: 3px 0; font-size: var(--fs-xs); cursor: pointer; }
  .where { color: var(--text-1); white-space: nowrap; }
  .from { color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .field { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: var(--fs-xs); }
  .field.top { align-items: flex-start; }
  .field > span { width: 52px; flex: none; color: var(--text-3); }
  .field input { flex: 1; }
  .links { margin: 0; flex: 1; min-width: 0; }
  .links li { display: flex; align-items: center; gap: 4px; color: var(--text-2); }
  .links li span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .icon-act { display: grid; place-items: center; flex: none; width: 20px; height: 20px; color: var(--text-3); cursor: pointer; }
  .check { display: flex; align-items: center; gap: 6px; margin-top: 10px; color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
  .actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 12px; }
</style>
