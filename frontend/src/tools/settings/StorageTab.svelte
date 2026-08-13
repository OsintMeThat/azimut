<script>
  /**
   * Where the workspace lives, where each export lands, and how the app's own
   * state moves to another machine.
   */
  import Icon from '../../components/Icon.svelte';
  import WorkspaceFolder from '../../components/WorkspaceFolder.svelte';
  import { CASE_FOLDER_LABEL } from '../../lib/exportDest.js';

  let {
    about,
    exportDirs,
    EXPORT_KINDS,
    importSettings,
    resetExportDestination,
    exportPickerKind = $bindable(),
    settingsFile = $bindable(),
  } = $props();
</script>

<WorkspaceFolder onchange={(status) => (about.workspace_root = status.root)} />

<section class="group">
  <h3>Export folders</h3>
  <p class="note">Choose a folder for each export type.</p>
  {#each EXPORT_KINDS as kind (kind.id)}
    <div class="row">
      <div class="row-label">
        <span>{kind.label}</span>
        <span class="row-hint mono export-path" title={exportDirs[kind.id] || CASE_FOLDER_LABEL}>
          {exportDirs[kind.id] || CASE_FOLDER_LABEL}
        </span>
      </div>
      <div class="scraper-actions">
        <button class="btn btn-sm" onclick={() => (exportPickerKind = kind.id)}>Change…</button>
        <button
          class="btn btn-ghost btn-sm"
          onclick={() => resetExportDestination(kind.id)}
          disabled={!exportDirs[kind.id]}
        >Reset</button>
      </div>
    </div>
  {/each}
</section>

<section class="group">
  <h3>Settings backup</h3>
  <p class="note">
    Carries settings, keys, templates and your signature; export folders and
    download logins stay here, so keep this backup private.
  </p>
  <div class="links">
    <a class="btn btn-sm" href="/api/settings/export" download>
      <Icon name="save" size={13} /> Export backup
    </a>
    <button class="btn btn-sm" onclick={() => settingsFile?.click()}>
      <Icon name="file" size={13} /> Import backup
    </button>
    <input
      type="file"
      accept="application/json,.json"
      bind:this={settingsFile}
      onchange={importSettings}
      hidden
    />
  </div>
</section>

<style>
  .export-path {
    display: block;
    max-width: min(380px, 48vw);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
