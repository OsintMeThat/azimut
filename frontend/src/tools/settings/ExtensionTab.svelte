<script>
  /**
   * The capture extension: whether this browser has it, and the token that pairs
   * it with this app.
   *
   * The token is minted on first reveal rather than on mount, so an installation
   * that never pairs never has one (spec's lazy-token rule).
   */
  import Icon from '../../components/Icon.svelte';

  let {
    about,
    badges,
    extDetected,
    extOutdated,
    ingestToken,
    copyToken,
    ensureToken,
    rotateToken,
    tokenShown = $bindable(),
  } = $props();
</script>

<section class="group">
  <h3>Capture extension</h3>
  <p class="note">
    Captures supported map sites and powers the Google basemap Capture button.
  </p>
  <div class="row">
    <div class="row-label">
      <span>Status in this browser</span>
      <span class="row-hint">
        {#if extDetected}
          detected · <span class="mono">v{extDetected}</span>
          {#if extOutdated}
            · update bundled (<span class="mono">v{about.extension_version}</span>)
          {/if}
        {:else}
          not detected. After installing, reload this tab
        {/if}
      </span>
    </div>
    <a class="btn btn-sm btn-primary dotted" href="/api/ingest/extension.zip" download>
      <Icon name="download" size={13} />
      {extOutdated ? 'Download update (.zip)' : 'Download extension (.zip)'}
      {#if badges.extension}
        <span
          class="update-dot"
          aria-label={extOutdated ? 'an update is waiting' : 'not installed yet'}
        ></span>
      {/if}
    </a>
  </div>
  {#if extOutdated}
    <p class="note warn">
      Bundled v{about.extension_version} is newer than installed v{extDetected}; replace
      the unpacked folder and reload the extension.
    </p>
  {/if}
  <p class="note">
    Unzip it, load it as an unpacked extension, then reload this tab.
  </p>
</section>

<section class="group">
  <h3>Pairing</h3>
  <p class="note">
    Paste this token into the extension options; rotating it unpairs existing extensions.
  </p>
  <div class="row">
    <div class="row-label">
      <span>Pairing token</span>
      <span class="row-hint mono">{tokenShown ? ingestToken : '•'.repeat(24)}</span>
    </div>
    <div class="scraper-actions">
      <button class="btn btn-sm" onclick={async () => { await ensureToken(); tokenShown = !tokenShown; }}>
        {tokenShown ? 'Hide' : 'Show'}
      </button>
      <button class="btn btn-sm btn-primary" onclick={copyToken}>
        <Icon name="copy" size={13} /> Copy
      </button>
      <button class="btn btn-sm" onclick={rotateToken}>Rotate</button>
    </div>
  </div>
  <p class="note">
    The extension can file one user-requested map capture through this local app.
  </p>
</section>
