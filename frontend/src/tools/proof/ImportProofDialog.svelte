<script>
  /**
   * Import a geolocated post as a proof.
   *
   * One screen with three states, because they are the same work at different
   * stages: a link to fetch, a form to check, an approval to give. Nothing this
   * dialog does reaches the case until the last one — the downloads land in a
   * staging directory the server sweeps, and closing the dialog discards it.
   *
   * The prefill never decides. A position read out of the post's text fills the
   * field and says where it came from; the analyst's save is what confirms it,
   * exactly as it is for coordinates they typed themselves.
   */
  import Icon from '../../components/Icon.svelte';
  import Modal from '../../components/Modal.svelte';
  import { api } from '../../lib/api.js';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { thisBrowser } from '../../lib/thisBrowser.js';
  import { toast } from '../../lib/state.svelte.js';

  let { caseId, onclose, oncreated } = $props();

  // Same table the Media Library picker falls back to when an extractor hands
  // back no poster frame.
  const KIND_ICONS = { image: 'image', video: 'video', audio: 'audio', file: 'file' };

  // 'link' → nothing held yet; 'form' → a picture is staged and the fields are open.
  let stage = $state('link');
  let token = $state(null);
  let postUrl = $state('');
  let busy = $state(false);
  let job = $state(null); // { slot, progress }
  let picker = $state(null); // several attachments: pick before anything downloads
  let authPrompt = $state(null); // a login wall, with the same answer Media offers

  /** The pictures the proof composes, in the order they were published. A list because a
   *  post publishing a set published one proof of several panels. */
  let panels = $state([]);
  const panel = $derived(panels[0] ?? null);
  let sourceMedia = $state(null); // the staged footage
  let post = $state(null); // what the platform said, and what its text states

  // `pov` decides the verb the footage takes: ticked, it was recorded at the
  // point; unticked, it shows it. The stronger of the two is a claim, so it is
  // never pre-made — a post that says "point of view" still needs the click.
  let form = $state({ title: '', coords: '', source_url: '', note: '', pov: false });
  let coordsFrom = $state(''); // the substring a prefilled position was read from
  let report = $state(null); // the preview, once asked for
  /** Which of the two waits behind the Preview button is running: '' | 'source' |
   *  'checking'. They differ by two orders of magnitude, so one word for both is a
   *  progress bar that lies. */
  let phase = $state('');
  /** The address the footage was fetched for, or '' before any attempt.
   *
   *  An address rather than a flag, because the question the preview asks is not "was
   *  something tried" but "was *this* tried". As a flag, retyping the address that had
   *  just been downloaded — or pressing the chip that already filled the field — threw
   *  away a held video and made the next Preview fetch it all over again. */
  let sourceFrom = $state('');
  /** Whether what is held is what the field now says. */
  const sourceHeld = $derived(sourceMedia && sourceFrom === form.source_url.trim());

  /** What the import is holding, in the order it is written: the picture the
   *  proof is composed of, then the footage it rests on. Both are on disk in the
   *  staging directory, so both can be looked at before anything is created —
   *  which is the point of downloading the source before the preview. */
  const held = $derived(
    [
      ...panels.map((staged, at) => ({
        slot: 'panel',
        label: panels.length > 1 ? `Panel ${at + 1}` : 'Proof',
        staged,
      })),
      { slot: 'source', label: 'Source media', staged: sourceMedia },
    ]
      .filter((entry) => entry.staged)
      .map((entry) => ({
        ...entry,
        url: token ? fileUrl(caseId, `media/.dl/${token}/${entry.staged.filename}`) : null,
      }))
  );
  let shownIndex = $state(0);
  // The footage arrives mid-dialog, so the index has to survive the list growing
  // and shrinking rather than pointing past the end of it.
  const shownAt = $derived(Math.min(shownIndex, Math.max(held.length - 1, 0)));
  const shown = $derived(held[shownAt] ?? null);

  function step(by) {
    if (!held.length) return;
    shownIndex = (shownAt + by + held.length) % held.length;
  }

  async function ensureToken() {
    if (token) return token;
    const started = await api.post(`/api/cases/${caseId}/proof-imports`);
    token = started.token;
    return token;
  }

  /** Poll one staging download to its end. Same shape as the Media Library's,
   *  and the same three answers: a picker, a login wall, or a held file. */
  async function runJob(jobId, slot) {
    job = { slot, progress: {} };
    for (;;) {
      const status = await api.get(`/api/jobs/${jobId}`);
      job = { slot, progress: status.progress ?? {} };
      if (status.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 700));
        continue;
      }
      job = null;
      if (status.status !== 'done') throw new Error(status.error || 'the download failed');
      return status.result ?? {};
    }
  }

  async function fetchInto(slot, url, { index = null, indexes = [], useCookies = false } = {}) {
    const id = await ensureToken();
    const { job_id } = await api.post(`/api/cases/${caseId}/proof-imports/${id}/fetch`, {
      url,
      slot,
      index,
      indexes,
      use_cookies: useCookies,
    });
    const result = await runJob(job_id, slot);
    if (result.multi) {
      // The published picture is usually the whole point of the post, so the pictures
      // arrive ticked and unticking one is the exception. The footage slot starts empty:
      // which clip is the source is not something a rule knows.
      const items = result.items ?? [];
      picker = {
        slot,
        url,
        items,
        picked:
          slot === 'panel'
            ? items.filter((item) => item.kind === 'image').map((item) => item.index)
            : [],
      };
      return null;
    }
    if (result.needs_auth) {
      // The tab this is running in *is* the analyst's browser, so it is the session
      // being asked for. A guess, filling a select they can change.
      authPrompt = { slot, url, browser: thisBrowser(), busy: false };
      return null;
    }
    return result;
  }

  async function fetchPost() {
    const url = postUrl.trim();
    if (!url || busy) return;
    busy = true;
    try {
      const result = await fetchInto('panel', url);
      if (result) applyPost(result);
    } catch (e) {
      toast(e.message, 'danger', 6000);
    } finally {
      busy = false;
    }
  }

  /** One place the footage lands, whatever route reached it: a plain download, a
   *  pick out of several attachments, or a retry behind a login. Each of those
   *  counts as the attempt the preview must not make a second time. */
  function applySource(result, url) {
    sourceMedia = result.staged;
    sourceFrom = url ?? form.source_url.trim();
    report = null;
  }

  function applyPost(result) {
    panels = result.held ?? (result.staged ? [result.staged] : []);
    post = result.post ?? null;
    report = null;
    const first = post?.coords?.[0];
    if (first) {
      form.coords = `${first.lat}, ${first.lon}`;
      coordsFrom = first.text;
    }
    if (!form.source_url && post?.urls?.length) form.source_url = post.urls[0];
    if (!form.title) form.title = (post?.title || '').slice(0, 60).trim();
    stage = 'form';
  }

  async function attach(slot, file, sourceUrl = '') {
    const id = await ensureToken();
    const body = new FormData();
    body.append('file', file);
    body.append('slot', slot);
    if (sourceUrl) body.append('source_url', sourceUrl);
    return api.post(`/api/cases/${caseId}/proof-imports/${id}/attach`, body);
  }

  async function attachPicture(file) {
    if (!file || busy) return;
    busy = true;
    try {
      // Attaching replaces: "here is my picture instead" is what this route means, and a
      // set built from a post is not something a hand-attached file adds to.
      const result = await attach('panel', file, postUrl.trim());
      panels = [result.staged];
      report = null;
      if (!form.title) form.title = file.name.replace(/\.[^.]+$/, '');
      stage = 'form';
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      busy = false;
    }
  }

  async function attachSourceFile(file) {
    if (!file || busy) return;
    busy = true;
    try {
      applySource(await attach('source', file, form.source_url.trim()));  // by hand, for this address
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      busy = false;
    }
  }

  /** Download the footage the post points at.
   *
   *  A failure here is information, not a stop: the address stays on the proof
   *  and the preview says the material is missing, which is the honest reading
   *  of a link that has been taken down.
   */
  async function downloadSource() {
    const url = form.source_url.trim();
    if (!url) return;
    try {
      const result = await fetchInto('source', url);
      if (result) applySource(result, url);
    } catch (e) {
      toast(`The source could not be downloaded: ${e.message}`, 'warn', 6000);
      sourceFrom = url; // it was tried and it did not answer, which is the point
    }
  }

  /** The source lands before the preview runs, so the preview reads bytes that
   *  are on disk instead of promising a download that has not happened. */
  async function preview() {
    if (busy) return;
    busy = true;
    try {
      // Two different waits behind one button, and only one of them is short. Fetching
      // the footage is a video off a platform — a walled one costs two refused attempts
      // and a cookie store read before a single byte arrives — where the check itself is
      // a tenth of a second. Saying "Checking…" through the first was the app claiming to
      // be nearly done for minutes.
      if (form.source_url.trim() !== sourceFrom) {
        phase = 'source';
        await downloadSource();
      }
      phase = 'checking';
      report = await api.post(`/api/cases/${caseId}/proof-imports/${token}/preview`, { ...form });
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      phase = '';
      busy = false;
    }
  }

  async function create() {
    if (busy || !report?.ready) return;
    busy = true;
    try {
      const created = await api.post(
        `/api/cases/${caseId}/proof-imports/${token}/commit`,
        { ...form }
      );
      token = null; // the server dropped the staging directory
      toast(`Imported as '${created.proof.name}'`, 'ok');
      oncreated?.(created);
      onclose?.();
    } catch (e) {
      toast(e.message, 'danger', 6000);
      report = null;
    } finally {
      busy = false;
    }
  }

  async function retryWithBrowser() {
    authPrompt.busy = true;
    const { slot, url, browser } = authPrompt;
    try {
      await api.put('/api/settings/prefs', {
        download_cookies: { source: 'browser', browser },
      });
      authPrompt = null;
      busy = true;
      const result = await fetchInto(slot, url, { useCookies: true });
      if (result && slot === 'panel') applyPost(result);
      else if (result) applySource(result, url);
    } catch (e) {
      toast(e.message, 'danger');
      if (authPrompt) authPrompt.busy = false;
    } finally {
      busy = false;
    }
  }

  /**
   * Take what was ticked, in the order it was ticked.
   *
   * The picture slot composes a **set**: a post publishing a geolocation as three images
   * published one proof, and keeping the first keeps a third of it. The footage slot is
   * one file, so there ticking a second replaces the first.
   */
  function tick(index) {
    const held = picker.picked ?? [];
    if (picker.slot !== 'panel') {
      picker = { ...picker, picked: held[0] === index ? [] : [index] };
      return;
    }
    picker = {
      ...picker,
      picked: held.includes(index) ? held.filter((one) => one !== index) : [...held, index],
    };
  }

  async function pick() {
    const { slot, url, picked } = picker;
    if (!picked?.length) return;
    picker = null;
    busy = true;
    try {
      const result = await fetchInto(slot, url, {
        index: picked[0],
        indexes: slot === 'panel' ? picked : [],
      });
      if (result && slot === 'panel') applyPost(result);
      else if (result) applySource(result, url);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      busy = false;
    }
  }

  /** Closing is cancelling: the held files go with it. */
  async function close() {
    if (busy) return;
    const id = token;
    token = null;
    onclose?.();
    if (id) {
      try {
        await api.del(`/api/cases/${caseId}/proof-imports/${id}`);
      } catch {
        /* the sweep will take it */
      }
    }
  }

  function onFormInput() {
    report = null;
  }

  const canPreview = $derived(Boolean(panel && form.title.trim() && form.coords.trim()));
</script>

<Modal title="Import a proof" onclose={close} width={stage === 'link' ? '520px' : '860px'}>
  {#if stage === 'link'}
    <div class="import-start">
      <label class="import-field">
        <span>Post address</span>
        <input
          class="input"
          bind:value={postUrl}
          placeholder="https://…"
          onkeydown={(e) => e.key === 'Enter' && fetchPost()}
        />
        <small>The picture is downloaded and the text is read for a position and a source.</small>
      </label>
      <div class="import-actions">
        <button class="btn btn-primary" onclick={fetchPost} disabled={busy || !postUrl.trim()}>
          <Icon name="download" size={14} />
          {busy ? 'Fetching…' : 'Fetch'}
        </button>
        <label class="btn" class:disabled={busy}>
          <Icon name="image" size={14} /> Use an image
          <input
            type="file"
            accept="image/*"
            hidden
            onchange={(e) => attachPicture(e.currentTarget.files?.[0])}
          />
        </label>
      </div>
      {#if job}
        <p class="import-progress">
          Downloading{job.progress?.percent != null ? ` — ${job.progress.percent}%` : '…'}
        </p>
      {/if}
    </div>
  {:else}
    <div class="import-body">
      <div class="import-picture">
        {#if shown}
          <div class="import-view">
            {#if shown.staged.kind === 'video'}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video src={shown.url} controls preload="metadata"></video>
            {:else if shown.staged.kind === 'image'}
              <img src={shown.url} alt={shown.label} />
            {:else}
              <div class="import-view-plain">
                <Icon name={KIND_ICONS[shown.staged.kind] ?? 'file'} size={28} />
                <span>{shown.staged.kind}</span>
              </div>
            {/if}
          </div>
          {#if panels.length > 1}
            <!-- What the proof will compose, in the order it will compose it. Not the
                 render — laying panels out is the composer's canvas — but the set, which
                 is the part an analyst is checking before they press Create. -->
            <div class="import-strip" aria-label="The pictures this proof composes">
              {#each held.filter((entry) => entry.slot === 'panel') as entry, at (entry.staged.filename)}
                <button class="import-strip-one" class:on={held[shownAt] === entry}
                        title={entry.staged.filename} onclick={() => (shownIndex = at)}>
                  <img src={entry.url} alt={entry.label} />
                </button>
              {/each}
            </div>
            <p class="import-note">
              One proof of {panels.length} panels, in this order.
            </p>
          {/if}
          <div class="import-view-bar">
            {#if held.length > 1}
              <button class="btn btn-sm" onclick={() => step(-1)} aria-label="Previous file">
                <Icon name="chevronLeft" size={14} />
              </button>
            {/if}
            <p class="import-note">
              <b>{shown.label}:</b>
              {shown.staged.filename}
              {#if held.length > 1}<span class="import-count">
                  {shownAt + 1}/{held.length}
                </span>{/if}
            </p>
            {#if held.length > 1}
              <button class="btn btn-sm" onclick={() => step(1)} aria-label="Next file">
                <Icon name="chevronRight" size={14} />
              </button>
            {/if}
          </div>
        {/if}
      </div>

      <div class="import-form">
        <label class="import-field">
          <span>Name <b aria-hidden="true">*</b></span>
          <input class="input" bind:value={form.title} oninput={onFormInput} maxlength="68" />
        </label>

        <label class="import-field">
          <span>Coordinates <b aria-hidden="true">*</b></span>
          <input
            class="input"
            bind:value={form.coords}
            oninput={() => { coordsFrom = ''; onFormInput(); }}
            placeholder="10.393313, -66.892504"
          />
          {#if coordsFrom}
            <small class="import-read">Read from the post: {coordsFrom}</small>
          {/if}
        </label>

        {#if post?.coords?.length > 1}
          <div class="import-chips">
            {#each post.coords as candidate (candidate.text)}
              <button
                class="btn btn-sm"
                onclick={() => {
                  form.coords = `${candidate.lat}, ${candidate.lon}`;
                  coordsFrom = candidate.text;
                  report = null;
                }}
              >{candidate.text}</button>
            {/each}
          </div>
        {/if}

        <label class="import-field">
          <span>Source <b aria-hidden="true">*</b></span>
          <input
            class="input"
            bind:value={form.source_url}
            oninput={onFormInput}
            placeholder="https://…"
          />
        </label>

        {#if post?.urls?.length}
          <div class="import-chips">
            {#each post.urls as url (url)}
              <button
                class="btn btn-sm"
                onclick={() => { form.source_url = url; report = null; }}
              >{url}</button>
            {/each}
          </div>
        {/if}

        <div class="import-source-state">
          {#if sourceHeld}
            <span class="badge ok">Source media held: {sourceMedia.filename}</span>
          {:else if sourceFrom === form.source_url.trim() && sourceFrom}
            <span class="badge danger">The source was not downloaded</span>
            <label class="btn btn-sm">
              Attach it
              <input
                type="file"
                hidden
                onchange={(e) => attachSourceFile(e.currentTarget.files?.[0])}
              />
            </label>
          {/if}
        </div>

        <label class="import-field">
          <span>Note</span>
          <input class="input" bind:value={form.note} oninput={onFormInput} maxlength="500" />
        </label>

        <label class="import-check">
          <input type="checkbox" bind:checked={form.pov} onchange={onFormInput} />
          <span>The camera was at this point</span>
        </label>

        {#if report}
          <div class="import-report">
            <h4>To be created</h4>
            <ul>
              <!-- Keyed on the position as well as the name: a duplicate key makes
                   Svelte throw, which blanks the whole report rather than showing a row
                   twice — the loudest possible failure for the quietest possible fault. -->
              {#each report.entities as entity, at (entity.slot + at)}
                <li>
                  <span class="import-kind">{entity.type}</span>
                  <span class="import-label">{entity.label}</span>
                  <span class="badge" class:info={entity.state === 'existing'}>
                    {entity.state === 'existing' ? 'reused' : 'new'}
                  </span>
                  {#if entity.detail}<small>{entity.detail}</small>{/if}
                </li>
              {/each}
            </ul>
            {#if report.links.length}
              <h4>Links</h4>
              <ul class="import-links">
                {#each report.links as link, at (link.from + link.type + link.to + at)}
                  <li>{link.from} <b>{link.label}</b> {link.to}</li>
                {/each}
              </ul>
            {/if}
            {#each report.warnings as warning (warning.code + warning.text)}
              <p class="import-warning">{warning.text}</p>
            {/each}
            {#each report.blocking as line (line)}
              <p class="import-blocking">{line}</p>
            {/each}
          </div>
        {/if}

        <!-- Above the buttons, not under them: a wait of minutes rendered past the last
             row of a modal is a wait nobody is told about. -->
        {#if phase === 'source'}
          <p class="import-progress">
            {job?.progress?.percent != null
              ? `Downloading the footage — ${job.progress.percent}%`
              : 'Reaching the footage…'}
          </p>
        {/if}
        <div class="import-actions">
          <button class="btn" onclick={close} disabled={busy}>Cancel</button>
          {#if report?.ready}
            <button class="btn btn-primary" onclick={create} disabled={busy}>
              {busy ? 'Creating…' : 'Create'}
            </button>
          {:else}
            <button class="btn btn-primary" onclick={preview} disabled={busy || !canPreview}>
              {phase === 'source' ? 'Downloading…' : phase ? 'Checking…' : 'Preview'}
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</Modal>

<!-- Several attachments, nothing downloaded yet. One is picked, not many: the
     picture a proof is composed of is a single image, and the extractor's own
     poster frame is what makes that choice possible without fetching first. -->
{#if picker}
  <Modal
    title={picker.slot === 'source' ? 'Choose the footage' : 'Choose the picture'}
    onclose={() => (picker = null)}
    width="600px"
  >
    <p class="import-note">
      This link has {picker.items.length} attachments.
      {#if picker.slot === 'panel'}
        Ticked ones become the panels of one proof.
      {:else}
        Pick one.
      {/if}
    </p>
    <ul class="import-picker">
      {#each picker.items as item (item.index)}
        <li>
          <button class="import-pick" class:picked={picker.picked?.includes(item.index)}
                  aria-pressed={picker.picked?.includes(item.index)}
                  onclick={() => tick(item.index)}>
            <span class="import-pick-thumb">
              {#if item.thumbnail}
                <img src={item.thumbnail} alt="" loading="lazy" />
              {:else}
                <Icon name={KIND_ICONS[item.kind] ?? 'file'} size={22} />
              {/if}
            </span>
            <span class="import-pick-title">{item.title}</span>
            <span class="badge">{item.kind}</span>
          </button>
        </li>
      {/each}
    </ul>
    <div class="modal-row">
      <div class="spacer"></div>
      <button class="btn" onclick={() => (picker = null)}>Cancel</button>
      <button class="btn btn-primary" disabled={!picker.picked?.length} onclick={pick}>
        {picker.slot === 'panel' && picker.picked?.length > 1
          ? `Compose ${picker.picked.length} panels`
          : 'Take it'}
      </button>
    </div>
  </Modal>
{/if}

{#if authPrompt}
  <Modal title="This link asks for a login" onclose={() => (authPrompt = null)} width="440px">
    <p class="import-note">Retry with a browser session Azimut can read.</p>
    <select class="input" bind:value={authPrompt.browser}>
      {#each ['firefox', 'chrome', 'chromium', 'edge', 'brave'] as browser (browser)}
        <option value={browser}>{browser}</option>
      {/each}
    </select>
    <div class="import-actions">
      <button class="btn" onclick={() => (authPrompt = null)}>Cancel</button>
      <button class="btn btn-primary" onclick={retryWithBrowser} disabled={authPrompt.busy}>
        Download signed in
      </button>
    </div>
  </Modal>
{/if}

<style>
  .import-start,
  .import-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .import-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 18px;
  }
  .import-view img,
  .import-view video {
    display: block;
    width: 100%;
    max-height: 420px;
    object-fit: contain;
    border-radius: 6px;
    background: var(--bg-0);
  }
  .import-view-plain {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 160px;
    border-radius: 6px;
    background: var(--bg-0);
    color: var(--text-3);
    font-size: 12px;
  }
  .import-view-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }
  .import-view-bar .import-note {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .import-count {
    color: var(--text-3);
  }
  .import-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .import-field > span {
    font-size: 12px;
    color: var(--text-2);
  }
  .import-field b {
    color: var(--danger);
  }
  .import-read {
    color: var(--warn);
  }
  .import-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .import-chips .btn {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .import-check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .import-source-state {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 22px;
  }
  .import-report {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 12px;
  }
  .import-report h4 {
    margin: 0 0 6px;
    font-size: 12px;
    color: var(--text-2);
  }
  .import-report ul {
    list-style: none;
    margin: 0 0 10px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
  }
  .import-report li {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .import-kind {
    color: var(--text-2);
    min-width: 46px;
  }
  .import-label {
    font-weight: 600;
  }
  .import-links b {
    color: var(--accent);
    font-weight: 600;
  }
  .import-warning {
    margin: 6px 0 0;
    color: var(--warn);
    font-size: 13px;
  }
  .import-blocking {
    margin: 6px 0 0;
    color: var(--danger);
    font-size: 13px;
  }
  .import-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .import-note,
  .import-progress {
    margin: 0;
    font-size: 12px;
    color: var(--text-2);
  }
  /* What is going in, told apart from what is merely there — a picker whose ticks are
     invisible is a picker nobody can check before pressing. */
  .import-pick.picked {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  /* The set the proof composes, laid the way one row of panels is laid. A preview and
     never the render: it says what is going in, not what it will look like. */
  .import-strip { display: flex; gap: 6px; overflow-x: auto; padding: 6px 0 2px; }
  .import-strip-one {
    flex: none; height: 54px; padding: 0; border: 1px solid var(--border);
    border-radius: var(--r-sm); overflow: hidden; background: none; cursor: pointer;
  }
  .import-strip-one.on { border-color: var(--accent); }
  .import-strip-one img { height: 100%; width: auto; display: block; }
  .import-picker {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .import-pick {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .import-pick:hover {
    background: var(--bg-3);
    border-color: var(--border-strong);
  }
  .import-pick-thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 84px;
    height: 56px;
    overflow: hidden;
    border-radius: 4px;
    background: var(--bg-0);
    color: var(--text-3);
  }
  .import-pick-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .import-pick-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }
</style>
