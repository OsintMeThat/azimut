<script>
  import { onDestroy } from 'svelte';
  import {
    caseState,
    refreshCaseList,
    openCase,
    createCase,
    adoptFolder,
    recoverFolder,
    promoteCase,
    renameCase,
    closeCase,
    deleteCase,
    toast,
  } from '../lib/state.svelte.js';
  import {
    discardBundleUpload,
    downloadBundle as triggerBundleDownload,
    inspectBundle,
    startBundleExport,
    startBundleImport,
    waitForBundle,
  } from '../lib/bundles.js';
  import { checkCase, repairCase } from '../lib/doctor.js';
  import { revealCaseFolder } from '../lib/reveal.js';
  import { formatSize } from '../lib/trash.js';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import SearchInput from './SearchInput.svelte';

  let open = $state(false);
  let search = $state('');
  let modal = $state(null); // 'create' | 'promote' | 'rename' | null
  let nameInput = $state('');
  let busy = $state(false);
  let renameId = $state(null); // id of the case being renamed (modal === 'rename')
  let bundleModal = $state(null); // 'export' | 'import' | null
  let bundleFile = $state(null);
  let bundlePassword = $state('');
  let protectBundle = $state(false);
  let bundleBusy = $state(false);
  let bundlePreview = $state(null);
  let bundleError = $state('');
  let bundleJobController = null;
  let doctorTarget = $state(null);
  let doctorReport = $state(null);
  let doctorBusy = $state(false);
  let doctorError = $state('');
  let doctorReplacements = $state({});
  let doctorConfirm = $state(null);

  onDestroy(() => bundleJobController?.abort());

  // Nothing opens in the tab, so say something either way: a file manager window
  // can land behind the browser, and a headless box has none at all.
  async function revealFolder() {
    open = false;
    const id = caseState.current?.id;
    if (!id) return;
    try {
      await revealCaseFolder(id);
      toast('Opened the case folder', 'ok', 2500);
    } catch (error) {
      toast(error.message || 'Could not open the folder', 'danger', 7000);
    }
  }

  async function openDoctor(c = caseState.current) {
    if (!c) return;
    open = false;
    doctorTarget = { id: c.id, name: c.name ?? c.id };
    doctorReport = null;
    doctorError = '';
    doctorReplacements = {};
    doctorConfirm = null;
    doctorBusy = true;
    try {
      doctorReport = await checkCase(c.id);
    } catch (error) {
      doctorError = error.message || 'Could not check this case';
    } finally {
      doctorBusy = false;
    }
  }

  function closeDoctor() {
    if (doctorBusy) return;
    doctorTarget = null;
    doctorReport = null;
    doctorError = '';
  }

  async function runDoctorRepair(issue, action) {
    if (!doctorTarget || doctorBusy) return;
    if (action.id === 'drop' && doctorConfirm !== issue.id) {
      doctorConfirm = issue.id;
      return;
    }
    const repair = { action: action.id };
    if (issue.entity_id) repair.entity_id = issue.entity_id;
    if (action.id === 'import') repair.path = issue.path;
    if (action.id === 'relink') {
      repair.replacement = doctorReplacements[issue.id];
      if (!repair.replacement) return;
    }
    doctorBusy = true;
    doctorError = '';
    try {
      const result = await repairCase(doctorTarget.id, repair);
      doctorReport = result.report;
      doctorConfirm = null;
      await refreshCaseList();
      if (caseState.current?.id === doctorTarget.id) {
        await openCase(doctorTarget.id);
      }
      toast('Case repair complete', 'ok', 3000);
    } catch (error) {
      doctorError = error.message || 'Could not repair this case';
    } finally {
      doctorBusy = false;
    }
  }

  function openBundle(kind) {
    open = false;
    bundleModal = kind;
    bundleFile = null;
    bundlePassword = '';
    protectBundle = false;
    bundlePreview = null;
    bundleError = '';
  }

  function closeBundle() {
    if (bundleBusy) return;
    if (bundlePreview?.upload_id) {
      void discardBundleUpload(bundlePreview.upload_id);
    }
    bundleModal = null;
    bundleFile = null;
    bundlePreview = null;
    bundleError = '';
  }

  async function exportBundle() {
    const current = caseState.current;
    if (!current || bundleBusy) return;
    bundleBusy = true;
    bundleError = '';
    let started;
    try {
      started = await startBundleExport(
        current.id,
        protectBundle ? bundlePassword : ''
      );
    } catch (error) {
      bundleError = error.message;
      bundleBusy = false;
      return;
    }
    bundleModal = null;
    bundlePassword = '';
    protectBundle = false;
    toast('Export started', 'info', 1800);
    bundleJobController?.abort();
    bundleJobController = new AbortController();
    try {
      const job = await waitForBundle(current.id, started.job_id, {
        signal: bundleJobController.signal,
      });
      if (job.state === 'ready') {
        triggerBundleDownload(current.id, started.job_id);
        toast('Download started', 'ok', 4000);
      } else {
        toast(job.error || 'Could not export the case', 'danger', 7000);
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        toast(error.message || 'Could not export the case', 'danger', 7000);
      }
    } finally {
      bundleJobController = null;
      bundleBusy = false;
    }
  }

  function chooseBundle(event) {
    if (bundlePreview?.upload_id) {
      void discardBundleUpload(bundlePreview.upload_id);
    }
    bundleFile = event.currentTarget.files?.[0] ?? null;
    bundlePreview = null;
    bundleError = '';
  }

  function resetBundlePreview() {
    if (bundlePreview?.upload_id) {
      void discardBundleUpload(bundlePreview.upload_id);
    }
    bundlePreview = null;
  }

  async function checkBundle() {
    if (!bundleFile || bundleBusy) return;
    bundleBusy = true;
    bundleError = '';
    try {
      bundlePreview = await inspectBundle(bundleFile, bundlePassword);
    } catch (error) {
      bundlePreview = null;
      bundleError = error.message;
    } finally {
      bundleBusy = false;
    }
  }

  async function importBundle() {
    if (!bundlePreview || bundleBusy) return;
    bundleBusy = true;
    bundleError = '';
    let started;
    try {
      started = await startBundleImport(bundlePreview.upload_id, bundlePassword);
    } catch (error) {
      bundleError = error.message;
      bundleBusy = false;
      return;
    }
    bundleModal = null;
    bundleFile = null;
    bundlePassword = '';
    bundlePreview = null;
    toast('Import started', 'info', 1800);
    bundleJobController?.abort();
    bundleJobController = new AbortController();
    try {
      const job = await waitForBundle(started.case_id, started.job_id, {
        signal: bundleJobController.signal,
      });
      if (job.state !== 'ready') {
        toast(job.error || 'Could not import the case', 'danger', 7000);
        return;
      }
      await refreshCaseList();
      await openCase(started.case_id);
      toast(`Imported “${started.name}”`, 'ok', 4000);
    } catch (error) {
      if (error.name !== 'AbortError') {
        toast(error.message || 'Could not import the case', 'danger', 7000);
      }
    } finally {
      bundleJobController = null;
      bundleBusy = false;
    }
  }

  function askRename(c) {
    open = false;
    modal = 'rename';
    renameId = c.id;
    nameInput = c.name ?? c.id;
  }

  // Delete flow: the whole case folder is wiped, so we make the user type
  // DELETE (uppercase) to confirm. `delTarget` holds the case being deleted.
  let delTarget = $state(null); // { id, name } | null
  let delConfirm = $state('');
  let delBusy = $state(false);
  const delReady = $derived(delConfirm === 'DELETE');

  function askDelete(c) {
    open = false;
    delTarget = { id: c.id, name: c.name ?? c.id };
    delConfirm = '';
  }

  async function confirmDelete() {
    if (!delReady || delBusy || !delTarget) return;
    delBusy = true;
    try {
      await deleteCase(delTarget.id);
      toast(`Case “${delTarget.name}” deleted`, 'ok');
      delTarget = null;
      delConfirm = '';
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      delBusy = false;
    }
  }

  async function toggle() {
    open = !open;
    if (open) {
      search = '';
      await refreshCaseList();
    }
  }

  // Search the case list: client-filter the loaded list for instant feedback,
  // and debounce a server query so it still finds a case in a long list the
  // first page didn't hold. Both paths key on the case name.
  const matchesSearch = (c) =>
    (c.name ?? c.id ?? '').toLowerCase().includes(search.trim().toLowerCase());
  let searchTimer;
  $effect(() => {
    const q = search;
    if (!open) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => refreshCaseList({ q }), 200);
    return () => clearTimeout(searchTimer);
  });

  async function pick(id) {
    open = false;
    await openCase(id);
  }

  async function submit() {
    const name = nameInput.trim();
    if (!name || busy || nameTaken) return;
    busy = true;
    try {
      if (modal === 'create') {
        await createCase(name);
        toast(`Case “${name}” created`, 'ok');
      } else if (modal === 'promote') {
        await promoteCase(name);
      } else if (modal === 'rename') {
        await renameCase(renameId, name);
        toast(`Renamed to “${name}”`, 'ok');
      }
      modal = null;
      nameInput = '';
      renameId = null;
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      busy = false;
    }
  }

  // A folder the analyst made in the workspace from their file manager. Using
  // it fills in `azimut/` and leaves everything else exactly where it is; one
  // that lost its manifest is recovered instead, then handed to the Doctor.
  let folderBusy = $state(false);

  const folderNote = (f) =>
    f.state === 'broken'
      ? 'Case to recover'
      : f.state === 'unusable-name'
        ? 'Rename to use'
        : 'Not a case yet';

  const folderTitle = (f) =>
    f.state === 'broken'
      ? 'Recover the case in this folder'
      : f.state === 'unusable-name'
        ? 'Rename this folder to use it'
        : 'Make this folder a case';

  async function useFolder(folder) {
    if (folderBusy || folder.state === 'unusable-name') return;
    folderBusy = true;
    try {
      if (folder.state === 'broken') {
        const recovered = await recoverFolder(folder.name);
        toast(`Recovered “${recovered.name}”`, 'ok');
        await openDoctor({ id: recovered.id, name: recovered.name });
      } else {
        open = false;
        const adopted = await adoptFolder(folder.name);
        toast(`Case “${adopted.name ?? folder.name}” created`, 'ok');
      }
    } catch (error) {
      toast(error.message || 'Could not use this folder', 'danger', 7000);
    } finally {
      folderBusy = false;
    }
  }

  const named = $derived(caseState.list.filter((c) => !c.scratch));
  const scratches = $derived(caseState.list.filter((c) => c.scratch));
  const folders = $derived(caseState.folders);
  const visibleFolders = $derived(folders.filter(matchesSearch));
  // Filtered views for the menu list (the unfiltered `named` still backs the
  // duplicate-name guard below, which must see every case).
  const visibleNamed = $derived(named.filter(matchesSearch));
  const visibleScratches = $derived(scratches.filter(matchesSearch));

  // Guard against duplicate names (case-insensitive) — the backend enforces
  // this too, but flag it early so the button disables instead of erroring.
  const nameTaken = $derived(
    !!nameInput.trim() &&
      named.some(
        (c) =>
          c.id !== renameId &&
          c.name.trim().toLowerCase() === nameInput.trim().toLowerCase()
      )
  );
</script>

<div class="switcher">
  <button class="current" onclick={toggle} title="Switch case">
    <Icon name={caseState.current ? 'folderOpen' : 'folder'} size={16} />
    {#if caseState.current}
      <span class="name">{caseState.current.name}</span>
      {#if caseState.current.scratch}<span class="badge accent">scratch</span>{/if}
    {:else}
      <span class="name none">No case (one-shot mode)</span>
    {/if}
    <Icon name="chevronDown" size={14} />
  </button>

  {#if caseState.current?.scratch}
    <button
      class="btn btn-primary btn-sm"
      onclick={() => {
        modal = 'promote';
        nameInput = '';
      }}
    >
      <Icon name="upload" size={13} /> Keep as case…
    </button>
  {/if}

  {#if open}
    <button class="backdrop" onclick={() => (open = false)} aria-label="Close menu"></button>
    <div class="menu card">
      {#if named.length + scratches.length > 6 || search.trim()}
        <div class="search-row">
          <SearchInput bind:value={search} placeholder="Find a case…" width="100%" />
        </div>
      {/if}
      <div class="list">
        {#each visibleNamed as c (c.id)}
          <div class="row" class:active={c.id === caseState.current?.id}>
            <button class="item" onclick={() => pick(c.id)}>
              <Icon name="folder" size={15} />
              <span class="grow">{c.name}</span>
              <span class="meta">
                {c.health === 'needs-attention' ? 'Needs attention' : `${c.entity_count} entities`}
              </span>
            </button>
            {#if c.health === 'needs-attention'}
              <button
                class="del doctor attention"
                title="Check case"
                aria-label="Check case"
                onclick={() => openDoctor(c)}
              >
                <Icon name="alert" size={14} />
              </button>
            {/if}
            <button class="del rename" title="Rename case" onclick={() => askRename(c)}>
              <Icon name="edit" size={14} />
            </button>
            <button class="del" title="Delete case" onclick={() => askDelete(c)}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        {/each}
        {#each visibleScratches as c (c.id)}
          <div class="row" class:active={c.id === caseState.current?.id}>
            <button class="item" onclick={() => pick(c.id)}>
              <Icon name="clock" size={15} />
              <span class="grow">{c.id}</span>
              <span class="badge accent">scratch</span>
            </button>
            {#if c.health === 'needs-attention'}
              <button
                class="del doctor attention"
                title="Check session"
                aria-label="Check session"
                onclick={() => openDoctor(c)}
              >
                <Icon name="alert" size={14} />
              </button>
            {/if}
            <button class="del" title="Delete session" onclick={() => askDelete(c)}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        {/each}
        {#each visibleFolders as f (f.name)}
          <div class="row folder">
            <button
              class="item"
              title={folderTitle(f)}
              disabled={folderBusy || f.state === 'unusable-name'}
              onclick={() => useFolder(f)}
            >
              <Icon name="folder" size={15} />
              <span class="grow">{f.name}</span>
              <span class="meta">{folderNote(f)}</span>
            </button>
          </div>
        {/each}
        {#if !named.length && !scratches.length && !folders.length}
          <div class="hint">No cases yet. Tools work without one.</div>
        {:else if !visibleNamed.length && !visibleScratches.length && !visibleFolders.length}
          <div class="hint">No case matches “{search.trim()}”.</div>
        {/if}
      </div>
      <div class="foot">
        <button
          class="foot-btn new"
          onclick={() => {
            open = false;
            modal = 'create';
            nameInput = '';
          }}
        >
          <Icon name="plus" size={15} /> New case
        </button>
        <!-- Icon-only past this point: the labels ride in the tooltip so the
             whole row fits on one line. Keep every one of them titled. -->
        <div class="foot-icons">
          <button
            class="foot-btn icon"
            title="Import case…"
            aria-label="Import case…"
            onclick={() => openBundle('import')}
          >
            <Icon name="upload" size={16} />
          </button>
          {#if caseState.current}
            <button
              class="foot-btn icon"
              title="Check this case"
              aria-label="Check this case"
              onclick={() => openDoctor()}
            >
              <Icon name="shield" size={16} />
            </button>
            <button
              class="foot-btn icon"
              title="Open case folder"
              aria-label="Open case folder"
              onclick={revealFolder}
            >
              <Icon name="folderOpen" size={16} />
            </button>
            <button
              class="foot-btn icon"
              title="Export this case…"
              aria-label="Export this case…"
              onclick={() => openBundle('export')}
            >
              <Icon name="download" size={16} />
            </button>
            <button
              class="foot-btn icon"
              title="Close case (one-shot mode)"
              aria-label="Close case (one-shot mode)"
              onclick={() => { closeCase(); open = false; }}
            >
              <Icon name="x" size={16} />
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

{#if modal}
  <Modal
    title={modal === 'create'
      ? 'New case'
      : modal === 'rename'
        ? 'Rename case'
        : 'Keep this session as a case'}
    onclose={() => (modal = null)}
  >
    <form
      onsubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label class="label" for="case-name">Case name</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="case-name"
        class="input"
        placeholder="e.g. March 2026 incident"
        bind:value={nameInput}
        autofocus
      />
      {#if nameTaken}
        <p class="err">A case with this name already exists. Pick another.</p>
      {/if}
      <div class="actions">
        <button type="button" class="btn" onclick={() => (modal = null)}>Cancel</button>
        <button
          type="submit"
          class="btn btn-primary"
          disabled={!nameInput.trim() || busy || nameTaken}
        >
          {modal === 'create' ? 'Create' : modal === 'rename' ? 'Rename' : 'Promote'}
        </button>
      </div>
    </form>
  </Modal>
{/if}

{#if bundleModal === 'export'}
  <Modal title="Export case" onclose={closeBundle}>
    <p class="bundle-note">
      Includes the case and its files. Trash and thumbnails stay on this device.
    </p>
    <label class="check-row">
      <input type="checkbox" bind:checked={protectBundle} />
      Protect with a password
    </label>
    {#if protectBundle}
      <label class="label" for="bundle-export-password">Password</label>
      <input
        id="bundle-export-password"
        class="input"
        type="password"
        bind:value={bundlePassword}
        autocomplete="new-password"
      />
      <p class="bundle-note">A lost password cannot be recovered.</p>
    {/if}
    {#if bundleError}<p class="err">{bundleError}</p>{/if}
    <div class="actions">
      <button type="button" class="btn" onclick={closeBundle} disabled={bundleBusy}>Cancel</button>
      <button
        type="button"
        class="btn btn-primary"
        onclick={exportBundle}
        disabled={bundleBusy || (protectBundle && !bundlePassword)}
      >
        {bundleBusy ? 'Starting…' : 'Export'}
      </button>
    </div>
  </Modal>
{/if}

{#if bundleModal === 'import'}
  <Modal title="Import case" onclose={closeBundle}>
    <label class="label" for="bundle-import-file">Case bundle</label>
    <input
      id="bundle-import-file"
      class="input"
      type="file"
      accept=".zip,.enc"
      onchange={chooseBundle}
    />
    <label class="label" for="bundle-import-password">Password (if protected)</label>
    <input
      id="bundle-import-password"
      class="input"
      type="password"
      bind:value={bundlePassword}
      oninput={resetBundlePreview}
      autocomplete="current-password"
    />
    {#if bundlePreview}
      <div class="bundle-preview">
        <strong>{bundlePreview.case_name}</strong>
        <span>{formatSize(bundlePreview.total_size)}</span>
        <span>{bundlePreview.sealed ? 'Password protected' : 'No password'}</span>
        <p>Imports as a new case.</p>
        {#if !bundlePreview.space_ok}
          <p class="bundle-space danger">
            Not enough free space. This import needs about
            {formatSize(bundlePreview.estimated_import_bytes)} plus a safety reserve;
            {formatSize(bundlePreview.free_space_bytes)} is available.
          </p>
        {:else if bundlePreview.large_bundle}
          <p class="bundle-space warn">
            Large import: about {formatSize(bundlePreview.estimated_import_bytes)} of
            temporary space, with {formatSize(bundlePreview.free_space_bytes)} available.
          </p>
        {/if}
      </div>
    {/if}
    {#if bundleError}<p class="err">{bundleError}</p>{/if}
    <div class="actions">
      <button type="button" class="btn" onclick={closeBundle} disabled={bundleBusy}>Cancel</button>
      {#if bundlePreview}
        <button
          type="button"
          class="btn btn-primary"
          onclick={importBundle}
          disabled={bundleBusy || !bundlePreview.space_ok}
        >
          {bundleBusy ? 'Starting…' : 'Import'}
        </button>
      {:else}
        <button
          type="button"
          class="btn btn-primary"
          onclick={checkBundle}
          disabled={bundleBusy || !bundleFile}
        >
          {bundleBusy ? 'Checking…' : 'Check bundle'}
        </button>
      {/if}
    </div>
  </Modal>
{/if}

{#if doctorTarget}
  <Modal title="Case Doctor" onclose={closeDoctor}>
    <p class="doctor-intro">Checks “{doctorTarget.name}” without changing it.</p>
    {#if doctorBusy && !doctorReport}
      <div class="doctor-empty">Checking…</div>
    {:else if doctorError && !doctorReport}
      <p class="err">{doctorError}</p>
    {:else if doctorReport?.status === 'healthy'}
      <div class="doctor-healthy">
        <span><Icon name="check" size={18} /></span>
        <div>
          <strong>No problems found</strong>
          <p>The database and media records match the case files.</p>
        </div>
      </div>
    {:else if doctorReport}
      <div class="doctor-list">
        {#each doctorReport.issues as issue (issue.id)}
          <section class="doctor-issue" class:error={issue.severity === 'error'}>
            <div class="doctor-heading">
              <Icon name={issue.severity === 'error' ? 'alert' : 'info'} size={17} />
              <div>
                <strong>{issue.title}</strong>
                <p>{issue.detail}</p>
              </div>
            </div>
            {#if issue.losses?.length}
              <div class="doctor-losses">
                <span>Cannot be recovered:</span>
                <ul>
                  {#each issue.losses as loss}<li>{loss}</li>{/each}
                </ul>
              </div>
            {/if}
            {#if issue.actions.some((action) => action.id === 'relink')}
              <label class="label" for={`doctor-replacement-${issue.entity_id}`}>
                Replacement file
              </label>
              <select
                id={`doctor-replacement-${issue.entity_id}`}
                class="input"
                value={doctorReplacements[issue.id] ?? ''}
                onchange={(event) => {
                  doctorReplacements[issue.id] = event.currentTarget.value;
                }}
              >
                <option value="">Choose a file from media…</option>
                {#each issue.replacements ?? [] as replacement}
                  <option value={replacement}>{replacement.replace('media/', '')}</option>
                {/each}
              </select>
              {#if !issue.replacements?.length}
                <p class="doctor-help">Add the replacement to the media folder, then check again.</p>
              {/if}
            {/if}
            <div class="doctor-actions">
              {#each issue.actions as action}
                <button
                  type="button"
                  class="btn btn-sm"
                  class:btn-primary={action.tone === 'primary'}
                  class:btn-danger={action.tone === 'danger'}
                  disabled={doctorBusy ||
                    (action.id === 'relink' && !doctorReplacements[issue.id])}
                  onclick={() => runDoctorRepair(issue, action)}
                >
                  {action.id === 'drop' && doctorConfirm === issue.id
                    ? 'Remove record?'
                    : action.label}
                </button>
              {/each}
            </div>
          </section>
        {/each}
      </div>
      {#if doctorError}<p class="err">{doctorError}</p>{/if}
    {/if}
    <div class="actions">
      {#if doctorReport?.status === 'issues'}
        <button type="button" class="btn" disabled={doctorBusy} onclick={() => openDoctor(doctorTarget)}>
          Check again
        </button>
      {/if}
      <button type="button" class="btn" disabled={doctorBusy} onclick={closeDoctor}>Close</button>
    </div>
  </Modal>
{/if}

{#if delTarget}
  <Modal title="Delete case" onclose={() => (delTarget = null)}>
    <div class="warn">
      <span class="warn-badge"><Icon name="trash" size={18} /></span>
      <div>
        <p class="warn-title">
          You will lose everything in “{delTarget.name}”.
        </p>
        <p class="warn-body">
          This deletes the case folder and all its contents; it cannot be undone.
        </p>
      </div>
    </div>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        confirmDelete();
      }}
    >
      <label class="label" for="del-confirm">Type <b>DELETE</b> to confirm</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="del-confirm"
        class="input"
        placeholder="DELETE"
        bind:value={delConfirm}
        autocomplete="off"
        autofocus
      />
      <div class="actions">
        <button type="button" class="btn" onclick={() => (delTarget = null)}>Cancel</button>
        <button type="submit" class="btn btn-danger" disabled={!delReady || delBusy}>
          {delBusy ? 'Deleting…' : 'Delete everything'}
        </button>
      </div>
    </form>
  </Modal>
{/if}

<style>
  .switcher {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .current {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: var(--r-sm);
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
    border: 1px solid transparent;
    max-width: 380px;
  }
  .current:hover {
    background: var(--bg-2);
    border-color: var(--border);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name.none {
    color: var(--text-3);
    font-weight: 500;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    cursor: default;
  }
  .menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    min-width: 320px;
    max-height: 460px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 100;
    box-shadow: var(--shadow-2);
    padding: 0;
  }
  /* Only the list scrolls: the search stays reachable at the top and the
     actions stay reachable at the bottom, however long the list gets. */
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 6px;
  }
  .search-row {
    padding: 8px 8px 4px;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px;
    border-top: 1px solid var(--border);
  }
  .foot-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 10px;
    border-radius: var(--r-sm);
    font-size: var(--fs-sm);
    color: var(--text-2);
    white-space: nowrap;
  }
  .foot-btn:hover {
    background: var(--bg-2);
    color: var(--text-1);
  }
  .foot-btn.new {
    color: var(--accent);
    font-weight: 600;
  }
  .foot-icons {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
  }
  .foot-btn.icon {
    padding: 7px 9px;
    color: var(--text-3);
  }
  .row {
    display: flex;
    align-items: center;
    border-radius: var(--r-sm);
  }
  .row:hover {
    background: var(--bg-2);
  }
  .row.active {
    background: var(--bg-3);
  }
  .row.active .item {
    color: var(--text-1);
  }
  .row .item {
    flex: 1;
    min-width: 0;
    background: none;
  }
  .row .item:hover {
    background: none;
  }
  .del {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    padding: 8px 10px;
    color: var(--text-3);
    opacity: 0;
    border-radius: var(--r-sm);
  }
  .row:hover .del {
    opacity: 1;
  }
  .del:hover {
    color: var(--danger, #e5484d);
  }
  /* A folder is not a case yet: dimmed until using it makes one. */
  .row.folder .item {
    color: var(--text-2);
  }
  .row.folder .item:disabled {
    color: var(--text-3);
  }
  .row .doctor.attention {
    opacity: 1;
    color: var(--warn, #d8a03d);
  }
  .row .doctor:hover {
    color: var(--text-1);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 8px 10px;
    border-radius: var(--r-sm);
    font-size: var(--fs-sm);
    color: var(--text-1);
    text-align: left;
  }
  .item:hover {
    background: var(--bg-2);
  }
  .warn {
    display: flex;
    gap: 13px;
    align-items: flex-start;
    margin-bottom: 16px;
  }
  .warn-badge {
    flex-shrink: 0;
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: color-mix(in srgb, var(--danger, #e5484d) 16%, transparent);
    color: var(--danger, #e5484d);
  }
  .warn-title {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-1);
    margin-bottom: 4px;
  }
  .warn-body {
    font-size: var(--fs-xs);
    color: var(--text-3);
    line-height: 1.45;
  }
  .btn-danger {
    background: var(--danger, #e5484d);
    color: #fff;
    border-color: transparent;
  }
  .btn-danger:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  .grow {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .hint {
    padding: 14px 10px;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
  .err {
    font-size: var(--fs-xs);
    color: var(--danger, #e5484d);
    margin-top: 8px;
  }
  .bundle-note {
    margin: 0 0 12px;
    color: var(--text-3);
    font-size: var(--fs-xs);
    line-height: 1.45;
  }
  .check-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 0 12px;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .bundle-preview {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 5px 12px;
    margin-top: 14px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .bundle-preview strong { color: var(--text-1); }
  .bundle-preview p { grid-column: 1 / -1; margin: 4px 0 0; color: var(--text-3); }
  .bundle-preview .bundle-space {
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  .bundle-preview .bundle-space.warn { color: var(--warn); }
  .bundle-preview .bundle-space.danger { color: var(--danger); }
  .doctor-intro {
    margin: 0 0 14px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .doctor-empty {
    padding: 18px 0;
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
  .doctor-healthy {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--ok) 35%, var(--border));
    border-radius: var(--r-sm);
    color: var(--ok);
  }
  .doctor-healthy strong { color: var(--text-1); font-size: var(--fs-sm); }
  .doctor-healthy p { margin: 3px 0 0; color: var(--text-3); font-size: var(--fs-xs); }
  .doctor-list {
    display: grid;
    gap: 10px;
    max-height: 52vh;
    overflow: auto;
  }
  .doctor-issue {
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
  }
  .doctor-issue.error { border-color: color-mix(in srgb, var(--danger) 35%, var(--border)); }
  .doctor-heading { display: flex; align-items: flex-start; gap: 9px; color: var(--warn); }
  .doctor-heading strong { color: var(--text-1); font-size: var(--fs-sm); }
  .doctor-heading p {
    margin: 3px 0 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
    overflow-wrap: anywhere;
  }
  .doctor-losses {
    margin: 10px 0;
    padding: 8px 10px;
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .doctor-losses ul { margin: 5px 0 0; padding-left: 18px; }
  .doctor-help { margin: 6px 0 0; color: var(--text-3); font-size: var(--fs-xs); }
  .doctor-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 10px; }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
</style>
