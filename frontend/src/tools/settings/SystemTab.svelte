<script>
  /**
   * What this installation is, what it can reach, and how to report a problem.
   *
   * Two update stories share the tab because they answer the same question from
   * the analyst's side — *is anything here behind?* Azimut itself checks GitHub,
   * the downloaders check PyPI, and both read the answer the startup check
   * already put in the store rather than asking again on mount.
   *
   * The issue report is built by the server and shown in full before it is filed:
   * the tracker is public, so nothing leaves without being read first.
   */
  import Icon from '../../components/Icon.svelte';

  let {
    about,
    ffmpeg,
    badges,
    appUpdate,
    checkingApp,
    checkAppUpdate,
    scrapers,
    checking,
    checkScrapers,
    updating,
    updateScraper,
    resetScraper,
    savePrefs,
    report,
    loadReport,
    refreshReport,
    copyReport,
    REPO_URL,
    SITE_URL,
    updateOnStart = $bindable(),
    reportKind = $bindable(),
    reportSummary = $bindable(),
  } = $props();

  // Downloaders can be refreshed from PyPI between Azimut releases.
  const SCRAPER_LABELS = { 'yt-dlp': 'yt-dlp', 'gallery-dl': 'gallery-dl' };
</script>

<section class="group">
  <h3>Azimut</h3>
  <dl class="facts">
    <dt>Version</dt>
    <dd class="mono">{about.version || '—'}</dd>
    <dt>ffmpeg</dt>
    <dd class="mono" title={ffmpeg.path || ''}>
      {#if ffmpeg.available}
        {ffmpeg.version || 'installed'}
        <span class="sub">· {ffmpeg.source === 'bundled' ? 'bundled' : 'system PATH'}</span>
      {:else}
        not found <span class="sub">· install ffmpeg on your PATH</span>
      {/if}
    </dd>
    <dt>License</dt>
    <dd>AGPL-3.0-only</dd>
  </dl>
  <p class="note">
    Case data stays in the workspace; network access is limited to requested features
    and the automatic GitHub update check.
  </p>
  <div class="links">
    <a class="btn btn-sm" href={REPO_URL} target="_blank" rel="noreferrer">
      <Icon name="link" size={13} /> Source & issues <Icon name="external" size={11} />
    </a>
    <a class="btn btn-sm" href={SITE_URL} target="_blank" rel="noreferrer">
      <Icon name="globe" size={13} /> osintmethat.com <Icon name="external" size={11} />
    </a>
  </div>
</section>

<section class="group">
  <h3>Updates</h3>
  <div class="row">
    <div class="row-label">
      <span>Check for a newer release</span>
      <span class="row-hint">
        {#if appUpdate?.update_available}
          <span class="mono">{appUpdate.latest}</span> is out. You have
          <span class="mono">{about.version}</span>
        {:else if appUpdate && !appUpdate.error}
          you're on the latest (<span class="mono">{about.version}</span>)
        {:else}
          {updateOnStart
            ? 'checks GitHub on startup and when requested'
            : 'checks GitHub when requested'}
        {/if}
      </span>
    </div>
    {#if appUpdate?.update_available}
      <a class="btn btn-sm btn-primary dotted" href={appUpdate.url} target="_blank" rel="noreferrer">
        <Icon name="download" size={13} /> Get {appUpdate.latest} <Icon name="external" size={11} />
        {#if badges.app}
          <span class="update-dot" aria-label="an update is waiting"></span>
        {/if}
      </a>
    {:else}
      <button class="btn btn-sm" onclick={checkAppUpdate} disabled={checkingApp}>
        {checkingApp ? 'Checking…' : 'Check for updates'}
      </button>
    {/if}
  </div>
  <div class="row">
    <div class="row-label">
      <span>Tell me on startup</span>
      <span class="row-hint">
        Asks GitHub and PyPI once when the app opens, and marks what is behind.
      </span>
    </div>
    <input
      type="checkbox"
      bind:checked={updateOnStart}
      onchange={() => savePrefs({ update_check_on_start: updateOnStart })}
      aria-label="Check for updates on startup"
    />
  </div>
  <p class="note">
    Update with <span class="mono">pipx upgrade azimut</span>; standalone users replace
    the downloaded binary.
  </p>
</section>

<section class="group">
  <h3>Report an issue</h3>
  <p class="note">
    Opens a new issue on the public GitHub tracker; anyone can read it.
  </p>
  <div class="report-kind">
    <label>
      <input
        type="radio"
        value="bug"
        bind:group={reportKind}
        onchange={loadReport}
      /> Something is broken
    </label>
    <label>
      <input
        type="radio"
        value="idea"
        bind:group={reportKind}
        onchange={loadReport}
      /> Something is missing
    </label>
  </div>
  <textarea
    class="report-summary"
    rows="3"
    maxlength="2000"
    placeholder={reportKind === 'bug'
      ? 'What you did, what you expected, what you got'
      : 'What you would like Azimut to do'}
    bind:value={reportSummary}
    oninput={refreshReport}
  ></textarea>
  {#if report}
    <details class="report-preview">
      <summary>What gets sent</summary>
      <pre class="mono">{report.report}</pre>
    </details>
  {/if}
  <div class="links">
    <a
      class="btn btn-sm btn-primary"
      href={report?.url || `${REPO_URL}/issues/new`}
      target="_blank"
      rel="noreferrer"
    >
      <Icon name="link" size={13} /> Open a GitHub issue <Icon name="external" size={11} />
    </a>
    <button class="btn btn-sm" onclick={copyReport} disabled={!report}>
      <Icon name="copy" size={13} /> Copy report
    </button>
  </div>
  <p class="note">
    Your text, the version, the OS and the last warnings of this run, with your
    paths, account name, case names and any keys removed. Nothing leaves the app
    until you open the issue.
  </p>
</section>

<section class="group">
  <h3>Downloaders</h3>
  <p class="note">
    Update these tools if a media link stops resolving.
  </p>
  {#each scrapers as s (s.dist)}
    <div class="row">
      <div class="row-label">
        <span>{SCRAPER_LABELS[s.dist] ?? s.dist}</span>
        <span class="row-hint">
          <span class="mono">{s.version || 'not installed'}</span>
          {#if s.source === 'runtime'}
            · updated in place{#if s.bundled_version}, shipped with {s.bundled_version}{/if}
          {:else}
            · as shipped
          {/if}
          {#if s.restart_required}
            · <span class="stale">restart to apply</span>
          {:else if s.outdated}
            · <span class="stale">{s.latest} available</span>
          {:else if s.latest}
            · up to date
          {/if}
        </span>
      </div>
      <div class="scraper-actions">
        {#if s.source === 'runtime'}
          <button class="btn btn-sm" onclick={() => resetScraper(s.dist)}>Revert</button>
        {/if}
        <button
          class="btn btn-sm dotted"
          class:btn-primary={s.outdated}
          disabled={updating[s.dist]}
          onclick={() => updateScraper(s.dist)}
        >
          {updating[s.dist] ? 'Updating…' : 'Update'}
          {#if s.outdated && !updating[s.dist]}
            <span class="update-dot" aria-label="an update is waiting"></span>
          {/if}
        </button>
      </div>
    </div>
  {/each}
  <div class="links">
    <button class="btn btn-sm" disabled={checking} onclick={checkScrapers}>
      <Icon name="download" size={13} />
      {checking ? 'Checking…' : 'Check for updates'}
    </button>
  </div>
  <p class="note">
    Updates are hash-verified from PyPI when requested; Revert restores the bundled version.
  </p>
</section>

<style>
  .sub {
    color: var(--text-3);
    font-size: var(--fs-sm);
  }

  /* the one state worth pulling the eye: this downloader will fail on real links */
  .stale {
    color: var(--warn, var(--text-1));
    font-weight: 500;
  }


  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 18px;
    margin: 0;
    font-size: var(--fs-sm);
  }

  .facts dt {
    color: var(--text-3);
    font-size: var(--fs-xs);
    align-self: center;
  }

  .facts dd {
    margin: 0;
    color: var(--text-1);
    overflow-wrap: anywhere;
  }


  /* Report an issue: kind, the user's words, then the report itself folded away. */
  .report-kind {
    display: flex;
    gap: 16px;
    margin: 10px 0 8px;
    font-size: var(--fs-xs);
    color: var(--text-2);
  }

  .report-kind label {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .report-summary {
    width: 100%;
    resize: vertical;
    font: inherit;
    font-size: var(--fs-sm);
  }

  .report-preview {
    margin-top: 10px;
    font-size: var(--fs-xs);
  }

  .report-preview summary {
    color: var(--text-3);
    cursor: pointer;
  }

  .report-preview pre {
    margin: 8px 0 0;
    padding: 8px 10px;
    max-height: 240px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    color: var(--text-2);
  }
</style>
