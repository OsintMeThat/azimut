<script>
  /**
   * The capture extension: which copy this browser runs, whether the app can
   * update it, and the token that pairs it with this app.
   *
   * The app owns a folder and rewrites it on demand, so an update is a button
   * rather than a reinstall. What it cannot do is tell the browser where to look
   * the first time — an unpacked extension has no installer — so the path is
   * always on screen, copyable, because pasting it into "Load unpacked" is the
   * one gesture that works on all three platforms.
   *
   * That road is Chrome's. Firefox refuses an unsigned extension and drops an
   * unpacked one when it closes, so it installs a signed XPI the browser keeps
   * and updates by itself: detected here, reported, and never offered a button
   * that would rewrite bytes Mozilla sealed.
   *
   * The token is minted on first reveal rather than on mount, so an installation
   * that never pairs never has one (spec's lazy-token rule).
   */
  import Icon from '../../components/Icon.svelte';

  let {
    badges,
    extDetected,
    extOutdated,
    extState,
    extBusy,
    installExtension,
    updateExtension,
    copyExtensionPath,
    revealExtension,
    ingestToken,
    copyToken,
    ensureToken,
    rotateToken,
    tokenShown = $bindable(),
  } = $props();

  // Before the probes answer, the <html> marker is all we have. It cannot tell
  // one copy from another, so it only ever says "something is there".
  let status = $derived(extState?.status ?? (extDetected ? 'probing' : 'absent'));
  let version = $derived(extState?.detectedVersion ?? extDetected);
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
        {#if status === 'owned' || status === 'duplicate'}
          detected · <span class="mono">v{extState.installed.version}</span>
          {#if extState.updateAvailable}· update ready{:else}· up to date{/if}
        {:else if status === 'signed'}
          detected · <span class="mono">v{version}</span> · updated by your browser
        {:else if status === 'foreign'}
          detected · <span class="mono">v{version}</span> · not the copy Azimut owns
        {:else if status === 'probing'}
          detected · <span class="mono">v{version}</span>
        {:else}
          not detected. After installing, reload this tab
        {/if}
      </span>
    </div>

    {#if status === 'owned' || status === 'duplicate'}
      <button
        class="btn btn-sm btn-primary"
        disabled={!extState.updateAvailable || Boolean(extBusy)}
        onclick={updateExtension}
      >
        <Icon name="download" size={13} />
        {extBusy === 'update' ? 'Updating…' : extState.updateAvailable ? 'Update' : 'Up to date'}
        {#if extState.updateAvailable}<span class="update-dot" aria-label="an update is ready"></span>{/if}
      </button>
    {:else if status === 'signed'}
      <!-- Nothing to press: the XPI is sealed, and Firefox replaces it from the
           update manifest the release publishes. -->
    {:else}
      <button class="btn btn-sm btn-primary" disabled={Boolean(extBusy)} onclick={installExtension}>
        <Icon name="download" size={13} />
        {#if extBusy === 'install'}Writing…{:else if status === 'foreign'}Install the app copy{:else}Install{/if}
        {#if badges.extension}
          <span
            class="update-dot"
            aria-label={extOutdated ? 'an update is waiting' : 'not installed yet'}
          ></span>
        {/if}
      </button>
    {/if}
  </div>

  {#if extState?.staged}
    <p class="note warn">
      The files are written but your browser is holding the old ones. Close it and
      press again.
    </p>
  {/if}

  {#if status === 'duplicate'}
    <p class="note warn">
      Two copies are loaded. Remove
      {#if extState.others[0]?.extensionId}
        <span class="mono">{extState.others[0].extensionId}</span>
      {:else}
        the older one
      {/if}
      in your browser's extensions page; Azimut updates
      <span class="mono">{extState.installed.extensionId}</span>.
    </p>
  {/if}

  {#if extState?.ahead}
    <p class="note warn">
      This add-on is newer than the Azimut you are running. Update the app, or its
      newer flows will report that they could not run.
    </p>
  {/if}

  {#if status === 'signed' && !extState.ahead}
    {#if extOutdated}
      <p class="note warn">
        This copy is behind the one Azimut ships. Firefox replaces it within a day,
        or now from <span class="mono">about:addons</span> → the gear menu →
        Check for Updates.
      </p>
    {:else}
      <p class="note">
        Firefox manages this copy and replaces it from Azimut's own update manifest.
      </p>
    {/if}
  {/if}

  {#if status === 'foreign'}
    <p class="note warn">
      This copy was loaded from a folder Azimut does not own, so it can't be
      updated from here. To hand it over:
    </p>
    <ol class="hand-over">
      <li>{extState.folderCurrent ? 'The app copy is written (path below)' : 'Press Install to write the app copy'}</li>
      <li>Remove the current extension in your browser's extensions page</li>
      <li>Load the folder below unpacked</li>
      <li>Paste the pairing token again — Chrome ties stored data to the folder</li>
    </ol>
  {/if}

  {#if extState?.path}
    <div class="row">
      <div class="row-label">
        <span>Extension folder</span>
        <span class="row-hint mono">{extState.path}</span>
      </div>
      <div class="scraper-actions">
        <button class="btn btn-sm" onclick={copyExtensionPath}>
          <Icon name="copy" size={13} /> Copy path
        </button>
        <button class="btn btn-sm" onclick={revealExtension}>Open folder</button>
      </div>
    </div>
  {/if}

  {#if status !== 'owned' && status !== 'duplicate' && status !== 'signed'}
    <p class="note">
      Chrome, Edge, Brave: extensions page → developer mode → Load unpacked →
      paste the path. Then reload this tab.
    </p>
    <p class="note">
      Firefox drops an unpacked extension when it closes, so install the signed
      <span class="mono">azimut-capture</span> add-on instead. It updates itself.
    </p>
    <div class="scraper-actions">
      <a
        class="btn btn-sm dotted"
        href="https://github.com/OsintMeThat/azimut/releases/latest"
        target="_blank"
        rel="noreferrer"
      >
        <Icon name="download" size={13} /> Signed add-on for Firefox
      </a>
      <a class="btn btn-sm dotted" href="/api/ingest/extension.zip" download>
        <Icon name="download" size={13} /> Download as .zip instead
      </a>
    </div>
  {/if}
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

<style>
  /* Handing an existing install over to the app: four steps, in order, because
     doing 2 before 1 leaves the browser with no extension at all. */
  .hand-over {
    margin: 4px 0 8px;
    padding-left: 18px;
    color: var(--text-3);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }

  .hand-over li {
    margin: 1px 0;
  }
</style>
