<script>
  /**
   * The `+` behind the added-layers section: a file, or an address.
   *
   * Two halves of one feature, so one dialog. A file is read here and nothing
   * leaves the machine; an address is fetched by the backend, which is the only
   * thing in this feature that reaches out at all — said on the dialog, because
   * a local-first app owes the analyst that sentence before the request, not in
   * a settings page afterwards.
   *
   * Nothing here parses anything. The bytes go to the backend whole
   * (`engine/maplayers.py`), which is what keeps somebody else's XML out of the
   * browser.
   */
  import Modal from '../../components/Modal.svelte';
  import { ACCEPTS, looksLikeUrl } from '../../lib/map/addedLayers.js';

  let { busy = false, onclose, onfile, onurl, ongeoconfirmed } = $props();

  let url = $state('');
  let picker = $state(null);

  /**
   * Whether to draw the map in its own pictograms, decided here and not later.
   *
   * Here because it is the moment the request would be made: the icons are read
   * once, at import, and served from the case folder from then on. A switch on
   * the row afterwards would be a switch over bytes already fetched, which is
   * the wrong thing to be asking about.
   *
   * Off for a file and on for an address, which is the same line the rest of the
   * app draws: following a link the analyst pasted already reaches the network,
   * opening a file off this machine does not.
   */
  let fileIcons = $state(false);
  let urlIcons = $state(true);

  const ready = $derived(looksLikeUrl(url));

  function pick(event) {
    const file = event.currentTarget.files?.[0];
    if (file) onfile?.(file, fileIcons);
  }
</script>

<Modal title="Add a layer" {onclose} width="460px">
  <p class="lead">
    A KML, KMZ, GeoJSON or GPX file, or a public map to follow. Its features are
    drawn and filtered here; nothing in it joins the case.
  </p>

  <section>
    <h4>From this computer</h4>
    <button class="btn" disabled={busy} onclick={() => picker?.click()}>
      {busy ? 'Reading…' : 'Choose a file'}
    </button>
    <input
      bind:this={picker}
      type="file"
      accept={ACCEPTS}
      hidden
      onchange={pick}
    />
    <label class="tick">
      <input type="checkbox" bind:checked={fileIcons} />
      <span>Use the map's own icons</span>
    </label>
    <p class="note">
      {fileIcons
        ? "Icons inside a KMZ are read from the file. Icons at web addresses are fetched once, now."
        : 'Nothing leaves this machine.'}
    </p>
  </section>

  <section>
    <h4>Follow a public map</h4>
    <input
      class="input"
      type="url"
      bind:value={url}
      placeholder="https://www.google.com/maps/d/viewer?mid=…"
      aria-label="Map address"
      onkeydown={(event) => event.key === 'Enter' && ready && onurl?.(url.trim(), urlIcons)}
    />
    <label class="tick">
      <input type="checkbox" bind:checked={urlIcons} />
      <span>Use the map's own icons</span>
    </label>
    <button class="btn" disabled={!ready || busy} onclick={() => onurl?.(url.trim(), urlIcons)}>
      {busy ? 'Reading…' : 'Subscribe'}
    </button>
    <!-- The one sentence this feature owes before it fetches: what it will ask
         for, when, and what it will not do on its own. -->
    <p class="note">
      A My Maps share link, or any KML or GeoJSON address. It is read now, when
      you press Refresh, and the first time you switch it on after opening
      Azimut — never on a timer, and never while the layer is off.
    </p>
  </section>

  <section>
    <h4>GeoConfirmed</h4>
    <button class="btn" disabled={busy} onclick={() => ongeoconfirmed?.()}>
      Choose a conflict
    </button>
    <p class="note">Geolocated conflict events, by dates and area, in GeoConfirmed's icons.</p>
  </section>
</Modal>

<style>
  .lead {
    margin: 0 0 14px;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  section + section {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  h4 {
    margin: 0 0 8px;
    color: var(--text-1);
    font-size: var(--fs-sm);
  }
  .input {
    width: 100%;
    margin-bottom: 8px;
  }
  .note {
    margin: 8px 0 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .tick {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px 0 0;
    color: var(--text-2);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
</style>
