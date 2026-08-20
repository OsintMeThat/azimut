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
  /** The staged material, each entry stamped with the address it was fetched for. A
   *  thread states one point and hangs the photos and the clips it rests on off several
   *  posts, so this is a list and every row of the form owns its share of it. */
  let sourceFiles = $state([]);
  let post = $state(null); // what the platform said, and what its text states

  // `pov` decides the verb the footage takes: ticked, it was recorded at the
  // point; unticked, it shows it. The stronger of the two is a claim, so it is
  // never pre-made — a post that says "point of view" still needs the click.
  let form = $state({ title: '', coords: '', source_urls: [''], note: '', pov: false });
  let coordsFrom = $state(''); // the substring a prefilled position was read from
  let report = $state(null); // the preview, once asked for
  /** Which of the two waits behind the Preview button is running: '' | 'source' |
   *  'checking'. They differ by two orders of magnitude, so one word for both is a
   *  progress bar that lies. */
  let phase = $state('');
  /** One http(s) address and nothing else, which is what the Source field holds.
   *
   *  Only decides whether to attempt the download: the reading that counts is the
   *  server's, and the preview blocks on it. Two addresses pasted with a space
   *  between them used to be posted to /fetch as one, refused there, and reported as
   *  a source that "was not downloaded" — a proof filed with no material. */
  const ONE_ADDRESS = /^https?:\/\/\S+$/i;

  /** The addresses a download has been attempted for, held or failed.
   *
   *  Addresses rather than a flag, because the question is not "was something tried" but
   *  "was *this* tried". As a flag, retyping the address that had just been downloaded —
   *  or pressing the chip that already filled the box — threw away a held video and made
   *  the next Preview fetch it all over again. */
  let sourceTried = $state([]);

  /** What one row of the form holds: its files, and whether it was ever asked for. */
  function sourceState(url) {
    const address = url.trim();
    const files = address ? sourceFiles.filter((one) => one.for_url === address) : [];
    return { address, files, tried: !!address && sourceTried.includes(address) };
  }

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
      ...sourceFiles.map((staged, at) => ({
        slot: 'source',
        label: sourceFiles.length > 1 ? `Source ${at + 1}` : 'Source media',
        staged,
      })),
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
      // What the slot can use arrives ticked, and unticking is the exception. The
      // published picture is usually the whole point of the post; and an address typed
      // into a source box was typed as material, so what hangs off it is material —
      // a picture, a clip or a recording alike.
      //
      // `own` is the one thing that holds a file back from arriving ticked: the video
      // extractor reads a post's media and the media of the post it quotes into one
      // list, so past the first it cannot say whose a clip is. Everything is still
      // listed — a quoted clip is sometimes exactly what is wanted — it is just not
      // ticked by a rule. A picker that hides is a picker that lies.
      const items = result.items ?? [];
      picker = {
        slot,
        url,
        items,
        picked: items
          .filter((item) => usable(slot, item.kind) && item.own !== false)
          .map((item) => item.index),
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
    const address = url.trim();
    const landed = (result.held ?? (result.staged ? [result.staged] : []))
      .map((staged) => ({ ...staged, for_url: address }));
    // Stamped here rather than read back off the answer: what a slot holds is keyed by
    // address on the server, and a hand-attached file has no metadata to read it from.
    sourceFiles = [...sourceFiles.filter((one) => one.for_url !== address), ...landed];
    if (!sourceTried.includes(address)) sourceTried = [...sourceTried, address];
    report = null;
  }

  /** An address that answered with nothing. Tried is what the preview must not repeat. */
  function sourceFailed(url) {
    const address = url.trim();
    sourceFiles = sourceFiles.filter((one) => one.for_url !== address);
    if (!sourceTried.includes(address)) sourceTried = [...sourceTried, address];
  }

  function setSource(at, value) {
    form.source_urls = form.source_urls.map((one, i) => (i === at ? value : one));
    report = null;
  }

  /** A box of its own per address, rather than a space between two of them: each one is
   *  fetched on its own, fails on its own and is attached by hand on its own, and one
   *  field could never show four states at once. */
  function addSource(url = '') {
    if (url && form.source_urls.some((one) => one.trim() === url)) return;
    const rows = form.source_urls.filter((one) => one.trim());
    form.source_urls = [...rows, url];
    report = null;
  }

  function dropSource(at) {
    const rows = form.source_urls.filter((_, i) => i !== at);
    form.source_urls = rows.length ? rows : [''];
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
    // The addresses the post's own text points at, all of them: a thread naming the
    // photos and the clip names its material, and picking the first would be this
    // dialog choosing for the analyst.
    if (!form.source_urls.some((one) => one.trim())) {
      form.source_urls = post?.urls?.length ? [...post.urls] : [''];
    }
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

  async function attachSourceFile(url, file) {
    if (!file || busy) return;
    busy = true;
    try {
      // For this address and no other: what the other rows hold stays where it is.
      applySource(await attach('source', file, url.trim()), url);
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
  async function downloadSource(url) {
    const address = url.trim();
    if (!address) return;
    try {
      const result = await fetchInto('source', address);
      if (result) applySource(result, address);
    } catch (e) {
      toast(`${address} could not be downloaded: ${e.message}`, 'warn', 6000);
      sourceFailed(address); // it was tried and it did not answer, which is the point
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
      const pending = form.source_urls
        .map((one) => one.trim())
        .filter((one) => ONE_ADDRESS.test(one) && !sourceTried.includes(one));
      if (pending.length) {
        phase = 'source';
        for (const url of pending) await downloadSource(url);
      }
      // A fetch that answered with a picker or a login wall settled nothing: the question
      // is on screen and the slot is about to change under it. Reading the case behind it
      // reported on a state nobody had agreed to yet — a picker cancelled left a preview
      // standing that said "ready", and Create filed a proof whose source had never been
      // downloaded. No report is the honest answer to an unanswered question.
      if (picker || authPrompt) {
        report = null;
        return;
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

  //: What each slot has somewhere to put. A proof is composed of **pictures**: the
  //: composer lays panels out on a canvas and a video has nothing to lay out, so a clip
  //: ticked for the picture slot was a refusal waiting two screens away at the preview.
  //: The material takes anything that was recorded — a still photographed on the spot is
  //: material as much as the clip beside it.
  const SLOT_KINDS = { panel: ['image'], source: ['image', 'video', 'audio'] };

  function usable(slot, kind) {
    return (SLOT_KINDS[slot] ?? []).includes(kind);
  }

  /**
   * Take what was ticked, in the order it was ticked.
   *
   * **Both slots compose a set.** A post publishing a geolocation as three images
   * published one proof, and keeping the first keeps a third of it; a post carrying two
   * photos of the scene and the clip under them holds three things that were shot there,
   * and keeping one leaves the rest of the case's own evidence outside it.
   */
  function tick(index) {
    const item = picker.items.find((one) => one.index === index);
    if (!item || !usable(picker.slot, item.kind)) return;
    const held = picker.picked ?? [];
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
      const result = await fetchInto(slot, url, { index: picked[0], indexes: picked });
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

        <!-- One box per address, each with its own outcome underneath it. A proof read
             from a thread rests on the post that published it, the photos beside it and
             the clip under those, and every one of them is fetched on its own. -->
        <div class="import-field">
          <span>Source <b aria-hidden="true">*</b></span>
          {#each form.source_urls as url, at (at)}
            {@const state = sourceState(url)}
            <div class="import-source-row">
              <input
                class="input"
                value={url}
                oninput={(e) => setSource(at, e.target.value)}
                placeholder="https://…"
              />
              {#if form.source_urls.length > 1}
                <button
                  class="import-source-drop"
                  title="Remove this source"
                  onclick={() => dropSource(at)}
                >
                  <Icon name="x" size={13} />
                </button>
              {/if}
            </div>
            {#if state.files.length}
              <div class="import-source-state">
                <span class="badge ok">
                  {state.files.length > 1
                    ? `${state.files.length} files held`
                    : `Held: ${state.files[0].filename}`}
                </span>
              </div>
            {:else if state.tried}
              <div class="import-source-state">
                <span class="badge danger">Not downloaded</span>
                <label class="btn btn-sm">
                  Attach it
                  <input
                    type="file"
                    hidden
                    onchange={(e) => attachSourceFile(url, e.currentTarget.files?.[0])}
                  />
                </label>
              </div>
            {/if}
          {/each}
          <button class="btn btn-sm import-source-add" onclick={() => addSource()}>
            <Icon name="plus" size={12} />
            Add a source
          </button>
        </div>

        {#if post?.urls?.length}
          <div class="import-chips">
            {#each post.urls as url (url)}
              <button class="btn btn-sm" onclick={() => addSource(url)}>{url}</button>
            {/each}
          </div>
        {/if}

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

<!-- Several attachments, nothing downloaded yet. Both slots take the ones ticked: a
     post publishing a geolocation as a set publishes one proof, and a post carrying two
     photos of the scene holds two things that were shot there. The extractor's own
     poster frame is what makes the choice possible without fetching first. -->
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
        Ticked ones become the material it rests on.
      {/if}
      {#if picker.items.some((item) => item.own === false)}
        The video extractor also reports what a post quotes, so only the first is ticked.
      {/if}
    </p>
    <ul class="import-picker">
      {#each picker.items as item (item.index)}
        <li>
          <button class="import-pick" class:picked={picker.picked?.includes(item.index)}
                  class:unusable={!usable(picker.slot, item.kind)}
                  disabled={!usable(picker.slot, item.kind)}
                  title={usable(picker.slot, item.kind)
                    ? undefined
                    : 'A proof is composed of pictures'}
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
        {#if picker.picked?.length > 1}
          {picker.slot === 'panel'
            ? `Compose ${picker.picked.length} panels`
            : `Take ${picker.picked.length} files`}
        {:else}
          Take it
        {/if}
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
  .import-source-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .import-source-row .input { flex: 1; min-width: 0; }
  .import-source-drop {
    display: inline-flex;
    color: var(--text-3);
    padding: 3px;
    border-radius: var(--r-sm);
  }
  .import-source-drop:hover { color: var(--danger); background: var(--bg-2); }
  /* Discreet on purpose: one source is the ordinary case and the button must not read
     as a step somebody skipped. */
  .import-source-add {
    align-self: flex-start;
    gap: 5px;
    color: var(--text-3);
    background: none;
    border: none;
    padding: 2px 0;
  }
  .import-source-add:hover { color: var(--text-1); background: none; }
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
  .import-pick:hover:not(:disabled) {
    background: var(--bg-3);
    border-color: var(--border-strong);
  }
  /* Shown and refused rather than hidden: a picker that hides is a picker that lies,
     and "this post also carries a clip" is worth knowing while choosing. */
  .import-pick.unusable { opacity: 0.45; cursor: not-allowed; }
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
