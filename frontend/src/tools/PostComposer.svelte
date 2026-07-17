<script>
  import { api } from '../lib/api.js';
  import { caseState, uiState, toast, reloadCase, prefs } from '../lib/state.svelte.js';
  import { proofCoordsText, proofSource } from '../lib/composer.js';
  import { bidiSafe } from '../lib/bidi.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';

  const X_LIMIT = 280;
  const URL_WEIGHT = 23; // X counts every URL as 23 chars

  let coordsText = $state('');
  let geo = $state(null); // {lat, lon, dms, plus_code, links}
  let place = $state('');
  let placeLoading = $state(false);
  let description = $state('');
  let mention = $state(prefs.postMention);
  let source = $state('');
  let proofPng = $state(null);
  let proofVer = $state(0); // cache-buster: bumped whenever proofPng is (re)assigned
  let tweet1 = $state('');
  let tweet1Edited = $state(false);

  // Media tweet (tweet 2)
  let mediaEnabled = $state(true);
  let mediaType = $state('none'); // 'none' | 'video' | 'images'
  let mediaText = $state('');
  let mediaPath = $state(null); // media selected from the library (case-relative)

  // Extra context tweets (3, 4, …)
  let extraSeq = 0;
  let extraTweets = $state([]); // [{ id, text }]

  // Draft persistence
  let draftName = $state(null); // slug of the saved draft (null until first save)

  // Kept in step with deletes made anywhere else in the app: a draft deleted
  // from the sidebar must not be resurrected by the next Save under its old
  // name. The thread on screen stays — a post outlives its proof (ONTOLOGY §3),
  // it only loses the attachment.
  $effect(() => {
    caseState.rev;
    const entities = caseState.current?.entities ?? [];
    if (draftName && !entities.some((e) => e.attrs?.draft === `exports/${draftName}.json`)) {
      draftName = null;
      toast('The saved draft was deleted — saving now files a new one', 'warn');
    }
    if (proofPng && !entities.some((e) => e.attrs?.path === proofPng)) {
      setProof(null);
      toast('The attached proof was deleted — the thread text is untouched', 'warn');
    }
  });
  let saving = $state(false);
  let discardConfirm = $state(false);
  let openList = $state(null); // list of saved drafts, null = closed

  // Media picker modal
  let pickerOpen = $state(false);
  let mediaLibrary = $state([]);

  // Proof picker modal
  let proofPickerOpen = $state(false);
  let proofLibrary = $state([]);

  let postFor = $state(undefined); // id of the case the form's content belongs to

  // reset the draft form when the case changes (close/switch/one-shot)
  $effect(() => {
    const id = caseState.current?.id;
    if (id !== postFor) {
      postFor = id;
      resetDraft();
    }
  });

  // Ingest a proof handed over by the Proof Composer
  $effect(() => {
    const p = uiState.postProof;
    if (!p) return;
    uiState.postProof = null;
    description = p.title === 'Untitled proof' ? '' : (p.title ?? '');
    source = p.source ?? p.sources?.[0] ?? '';
    setProof(p.png ?? null);
    tweet1Edited = false;
    coordsText = p.coordsText
      ?? (p.coords ? `${p.coords.lat.toFixed(6)}, ${p.coords.lon.toFixed(6)}` : '');
    if (coordsText.trim()) resolveCoords();
    else regenerate();
  });

  // Consume an "open this draft" handoff from the sidebar
  $effect(() => {
    if (uiState.tool === 'post' && uiState.openDraft && caseState.current) {
      const name = uiState.openDraft;
      uiState.openDraft = null;
      loadDraft(name);
    }
  });

  async function resolveCoords() {
    const value = coordsText.trim();
    if (!value) {
      geo = null;
      regenerate();
      return;
    }
    try {
      geo = await api.post('/api/geo/parse', { text: value });
      regenerate();
      lookupPlace();
    } catch {
      toast('Could not parse coordinates', 'danger');
    }
  }

  async function lookupPlace() {
    if (!geo) return;
    placeLoading = true;
    try {
      const r = await api.get(`/api/geo/reverse?lat=${geo.lat}&lon=${geo.lon}`);
      const a = r.address ?? {};
      place = [a.village || a.town || a.city || a.county, a.state, a.country]
        .filter(Boolean)
        .join(', ') || r.display_name || '';
      regenerate();
    } catch {
      /* offline or Nominatim down — place stays manual */
    } finally {
      placeLoading = false;
    }
  }

  function buildTweet1() {
    const lines = [];

    // "Place, State, Country - PLUSCODE"
    const header = [place.trim(), geo?.plus_code].filter(Boolean).join(' - ');
    if (header) lines.push(header);

    // description
    if (description.trim()) {
      lines.push('');
      lines.push(description.trim());
    }

    // decimal coords only (6 digits), no DMS
    if (geo) {
      lines.push('');
      lines.push(`${geo.lat.toFixed(6)}, ${geo.lon.toFixed(6)}`);
    }

    // mention (@GeoConfirmed by default)
    if (mention.trim()) {
      lines.push('');
      lines.push(mention.trim());
    }

    // source
    if (source.trim()) {
      lines.push('');
      lines.push('Source:');
      lines.push(source.trim());
    }

    return lines.join('\n');
  }

  function regenerate() {
    tweet1 = buildTweet1();
    tweet1Edited = false;
  }

  function weightedLength(t) {
    // count the bidi-safe text that actually gets copied, so the counter
    // stays honest for Arabic/Hebrew threads (isolates counted, worst case)
    const safe = bidiSafe(t);
    const urlRe = /https?:\/\/\S+/g;
    const stripped = safe.replace(urlRe, '');
    const urls = safe.match(urlRe)?.length ?? 0;
    return [...stripped].length + urls * URL_WEIGHT;
  }

  function tweet2Text() {
    const label = mediaType === 'video' ? '2/ Video:' : '2/ Image:';
    return mediaText.trim() ? `${label}\n${mediaText.trim()}` : label;
  }

  const tweet1Count = $derived(weightedLength(tweet1));
  const tweet1Over = $derived(tweet1Count > X_LIMIT);

  function addExtraTweet() {
    extraTweets.push({ id: ++extraSeq, text: '' });
  }

  function removeExtraTweet(id) {
    const i = extraTweets.findIndex((t) => t.id === id);
    if (i !== -1) extraTweets.splice(i, 1);
  }

  // Copies go through bidiSafe: Arabic/Hebrew threads keep coordinates,
  // plus codes, @mentions and URLs reading left-to-right on X (see lib/bidi).
  async function copy(value) {
    await navigator.clipboard.writeText(bidiSafe(value));
    toast('Copied to clipboard', 'ok', 1600);
  }

  async function copyAll() {
    const parts = [tweet1];
    if (mediaEnabled && mediaType !== 'none') parts.push(tweet2Text());
    for (const t of extraTweets) {
      if (t.text.trim()) parts.push(t.text.trim());
    }
    await navigator.clipboard.writeText(parts.map(bidiSafe).join('\n\n---\n\n'));
    toast('All tweets copied', 'ok', 1800);
  }

  // ---- media picker -------------------------------------------------------

  async function openPicker() {
    if (!caseState.current) {
      toast('Open a case to pick from your media', 'warn');
      return;
    }
    try {
      mediaLibrary = await api.get(`/api/cases/${caseState.current.id}/media`);
      pickerOpen = true;
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  function pickMedia(item) {
    mediaPath = item.path;
    // auto-select the matching media type from the item's kind
    if (item.kind === 'video') mediaType = 'video';
    else if (item.kind === 'image') mediaType = 'images';
    pickerOpen = false;
  }

  function clearMedia() {
    mediaPath = null;
  }

  // ---- proof picker -------------------------------------------------------

  /** Assign the attached proof and bump the cache-buster so the preview always
   *  reflects the current file — proofs default to the same slug/filename, so
   *  the URL alone can be identical across different proofs. */
  function setProof(png) {
    proofPng = png;
    proofVer = png ? Date.now() : 0;
  }

  async function openProofPicker() {
    if (!caseState.current) {
      toast('Open a case to pick a proof', 'warn');
      return;
    }
    try {
      proofLibrary = await api.get(`/api/cases/${caseState.current.id}/proofs`);
      proofPickerOpen = true;
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  async function pickProof(item) {
    setProof(item.png);
    proofPickerOpen = false;
    if (!description.trim() && item.title && item.title !== 'Untitled proof') {
      description = item.title;
    }
    // Pull the proof's coordinates + source into the post so the fields fill in.
    try {
      const spec = await api.get(`/api/cases/${caseState.current.id}/proofs/${item.name}`);
      const src = proofSource(spec);
      if (src) source = src;
      const ct = proofCoordsText(spec);
      if (ct) { coordsText = ct; await resolveCoords(); return; }
    } catch {
      /* fall through to a plain regenerate */
    }
    regenerate();
  }

  function clearProof() {
    setProof(null);
  }

  const mediaHref = $derived(
    mediaPath && caseState.current ? `/files/${caseState.current.id}/${mediaPath}` : null
  );

  const proofHref = $derived(
    proofPng && caseState.current
      ? `/files/${caseState.current.id}/${proofPng}${proofVer ? `?v=${proofVer}` : ''}`
      : null
  );

  // ---- one-click image copy / media download ------------------------------

  /** Rasterise any image blob to PNG (the only format browsers reliably put on
   *  the clipboard) so it can be pasted straight into the X composer. */
  function toPngBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((out) => (out ? resolve(out) : reject(new Error('encode failed'))), 'image/png');
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('load failed'));
      };
      img.src = url;
    });
  }

  /** Copy an image into the clipboard so it can be pasted (Ctrl+V) into X. */
  async function copyImage(url) {
    try {
      const res = await fetch(url);
      let blob = await res.blob();
      if (blob.type !== 'image/png') blob = await toPngBlob(blob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Image copied. Paste it into X (Ctrl+V)', 'ok', 2400);
    } catch (e) {
      toast(`Could not copy image: ${e.message}`, 'danger');
    }
  }

  /** Save a media file locally (X has no paste for video — drag it in from here). */
  function downloadMedia(url, path) {
    const a = document.createElement('a');
    a.href = url;
    a.download = (path ?? '').split('/').pop() || 'media';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Downloaded. Drag it into X', 'info', 2600);
  }

  // ---- draft persistence --------------------------------------------------

  function snapshot() {
    return {
      description,
      coordsText,
      place,
      mention,
      source,
      proofPng,
      tweet1,
      tweet1Edited,
      mediaEnabled,
      mediaType,
      mediaText,
      mediaPath,
      extraTweets: extraTweets.map((t) => ({ text: t.text })),
    };
  }

  function draftTitle() {
    return (place.trim() || description.trim() || 'Untitled post').slice(0, 120);
  }

  async function saveDraft() {
    if (!caseState.current) {
      toast('Open a case to save a draft', 'warn');
      return;
    }
    saving = true;
    try {
      const body = { title: draftTitle(), state: snapshot() };
      if (draftName) body.name = draftName;
      const r = await api.post(`/api/cases/${caseState.current.id}/drafts`, body);
      draftName = r.name;
      await reloadCase(); // surface the post entity in the sidebar
      toast('Draft saved', 'ok', 1600);
    } catch (e) {
      toast(`Draft not saved: ${e.message}`, 'danger');
    } finally {
      saving = false;
    }
  }

  async function openDraftList() {
    if (!caseState.current) return;
    try {
      openList = await api.get(`/api/cases/${caseState.current.id}/drafts`);
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  let deleteEntry = $state(null); // open-list entry pending deletion
  async function deleteSavedDraft() {
    const entry = deleteEntry;
    deleteEntry = null;
    try {
      await api.del(`/api/cases/${caseState.current.id}/drafts/${entry.name}`);
      await Promise.all([openDraftList(), reloadCase()]);
      toast(`Deleted "${entry.title}"`, 'info');
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  async function loadDraft(name) {
    if (!caseState.current) return;
    try {
      const doc = await api.get(`/api/cases/${caseState.current.id}/drafts/${name}`);
      const s = doc.state ?? {};
      description = s.description ?? '';
      coordsText = s.coordsText ?? '';
      place = s.place ?? '';
      mention = s.mention ?? prefs.postMention;
      source = s.source ?? '';
      setProof(s.proofPng ?? null);
      mediaEnabled = s.mediaEnabled ?? true;
      mediaType = s.mediaType ?? 'none';
      mediaText = s.mediaText ?? '';
      mediaPath = s.mediaPath ?? null;
      extraTweets = (s.extraTweets ?? []).map((t) => ({ id: ++extraSeq, text: t.text ?? '' }));
      draftName = name;
      // restore geo facts from the coordinates, then honor any manual tweet edits
      if (s.coordsText?.trim()) {
        try {
          geo = await api.post('/api/geo/parse', { text: s.coordsText });
        } catch {
          geo = null;
        }
      } else {
        geo = null;
      }
      tweet1 = s.tweet1 ?? buildTweet1();
      tweet1Edited = s.tweet1Edited ?? false;
      openList = null;
      toast('Draft loaded', 'ok', 1400);
    } catch (e) {
      toast(`Could not load draft: ${e.message}`, 'danger');
    }
  }

  function resetDraft() {
    description = '';
    coordsText = '';
    geo = null;
    place = '';
    mention = prefs.postMention;
    source = '';
    setProof(null);
    tweet1 = '';
    tweet1Edited = false;
    mediaEnabled = true;
    mediaType = 'none';
    mediaText = '';
    mediaPath = null;
    extraTweets = [];
    draftName = null;
    discardConfirm = false;
  }

  const hasContent = $derived(
    !!(draftName || description.trim() || coordsText.trim() || mediaPath || proofPng ||
      extraTweets.length || tweet1.trim())
  );

  // ---- publish (prefill X compose — Azimut never posts on your behalf) -----

  async function publish() {
    // X's web intent only prefills the first post; copy the whole thread so the
    // rest can be pasted as replies, then open the compose window.
    await copyAll();
    const url = `https://x.com/intent/post?text=${encodeURIComponent(bidiSafe(tweet1))}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    toast('Opened X. Thread copied for the replies', 'info', 3200);
  }
</script>

<div class="tool">
  <div class="tool-header">
    <div class="head-text">
      <h2>Post Composer</h2>
    </div>
    <div class="head-actions">
      {#if caseState.current}
        <button class="btn btn-ghost btn-sm" onclick={openDraftList} title="Reopen a saved draft">
          <Icon name="folderOpen" size={14} /> Open
        </button>
      {/if}
      {#if hasContent}
        <button class="btn btn-ghost btn-sm" onclick={() => (discardConfirm = true)} title="Clear this draft">
          <Icon name="reset" size={14} /> Discard
        </button>
      {/if}
      <button class="btn btn-ghost btn-sm" onclick={saveDraft} disabled={saving}>
        <Icon name="save" size={14} /> {draftName ? 'Save draft' : 'Save as draft'}
      </button>
      <button class="btn btn-primary btn-sm" onclick={publish} disabled={!tweet1.trim()} title="Copy the thread and open X compose">
        <Icon name="post" size={14} /> Publish on X
      </button>
    </div>
  </div>

  <div class="tool-body">
    <div class="layout">
      <!-- left column: ingredients -->
      <div class="col">
        <div class="field">
          <label class="label" for="pc-desc">Description</label>
          <input
            id="pc-desc"
            class="input"
            placeholder="A formation of 13 helicopters was spotted heading East"
            bind:value={description}
            onchange={regenerate}
          />
        </div>

        <div class="field">
          <label class="label" for="pc-coords">Coordinates</label>
          <input
            id="pc-coords"
            class="input mono"
            placeholder="10.303315, -66.874095"
            bind:value={coordsText}
            onchange={resolveCoords}
          />
          {#if geo}
            <div class="geo-facts card">
              <button class="fact mono" onclick={() => copy(`${geo.lat.toFixed(6)}, ${geo.lon.toFixed(6)}`)} title="Copy">
                <Icon name="crosshair" size={12} /> {geo.lat.toFixed(6)}, {geo.lon.toFixed(6)}
              </button>
              <button class="fact mono" onclick={() => copy(geo.dms)} title="Copy">
                <Icon name="globe" size={12} /> {geo.dms}
              </button>
              <button class="fact mono" onclick={() => copy(geo.plus_code)} title="Copy">
                <Icon name="hash" size={12} /> {geo.plus_code}
              </button>
              <div class="links">
                {#each Object.entries(geo.links) as [name, url] (name)}
                  <a href={url} target="_blank" rel="noreferrer" class="badge info">{name}</a>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        <div class="field">
          <label class="label" for="pc-place">
            Place {#if placeLoading}<span class="loading">resolving…</span>{/if}
          </label>
          <input
            id="pc-place"
            class="input"
            placeholder="Village, State, Country"
            bind:value={place}
            onchange={regenerate}
          />
        </div>

        <div class="field">
          <label class="label" for="pc-mention">Mention</label>
          <input
            id="pc-mention"
            class="input mono"
            placeholder="@GeoConfirmed"
            bind:value={mention}
            onchange={regenerate}
          />
        </div>

        <div class="field">
          <label class="label" for="pc-source">Source</label>
          <input
            id="pc-source"
            class="input"
            placeholder="https://instagram.com/… (original post)"
            bind:value={source}
            onchange={regenerate}
          />
        </div>

        {#if caseState.current}
          <div class="field">
            <div class="proof-head">
              <span class="label" style="margin:0">Attached proof</span>
              {#if proofPng}
                <button class="btn btn-ghost btn-sm" onclick={() => copyImage(proofHref)} title="Copy the image — paste it into X">
                  <Icon name="copy" size={13} /> Copy image
                </button>
                <button class="btn btn-ghost btn-sm" onclick={openProofPicker} title="Attach a different proof">
                  <Icon name="proof" size={13} /> Change
                </button>
                <button class="btn btn-ghost btn-sm danger-hover" onclick={clearProof} title="Detach proof">
                  <Icon name="x" size={13} />
                </button>
              {/if}
            </div>
            {#if proofPng}
              <a href={proofHref} target="_blank" rel="noreferrer">
                <img class="proof-preview card" src={proofHref} alt="proof" />
              </a>
            {:else}
              <button class="btn btn-ghost btn-sm proof-attach" onclick={openProofPicker}>
                <Icon name="proof" size={14} /> Attach a proof
              </button>
            {/if}
          </div>
        {/if}
      </div>

      <!-- right column: the thread -->
      <div class="col">

        <!-- Tweet 1: geolocation -->
        <div class="tweet-block card">
          <div class="tweet-head">
            <span class="tweet-num">1</span>
            <span class="label" style="margin:0">Geolocation tweet</span>
            {#if tweet1Edited}
              <button class="btn btn-ghost btn-sm" onclick={regenerate} title="Rebuild from the fields">
                <Icon name="compass" size={13} /> regenerate
              </button>
            {/if}
            <span class="counter" class:over={tweet1Over}>{tweet1Count}/{X_LIMIT}</span>
            <button class="btn btn-ghost btn-sm" onclick={() => copy(tweet1)} disabled={!tweet1.trim()}>
              <Icon name="copy" size={13} /> Copy
            </button>
          </div>
          <textarea
            class="textarea post-text mono"
            dir="auto"
            bind:value={tweet1}
            oninput={() => (tweet1Edited = true)}
            rows="11"
          ></textarea>
        </div>

        <!-- Tweet 2: media (Video / Image) -->
        {#if mediaEnabled}
        <div class="tweet-block card">
          <div class="tweet-head">
            <span class="tweet-num">2</span>
            <span class="label" style="margin:0">Media</span>
            <div class="media-tabs">
              <button
                class="btn btn-sm"
                class:btn-primary={mediaType === 'video'}
                class:btn-ghost={mediaType !== 'video'}
                onclick={() => (mediaType = mediaType === 'video' ? 'none' : 'video')}
              >Video</button>
              <button
                class="btn btn-sm"
                class:btn-primary={mediaType === 'images'}
                class:btn-ghost={mediaType !== 'images'}
                onclick={() => (mediaType = mediaType === 'images' ? 'none' : 'images')}
              >Image</button>
            </div>
            {#if mediaType !== 'none'}
              <span class="counter">{weightedLength(tweet2Text())}/{X_LIMIT}</span>
              <button class="btn btn-ghost btn-sm" onclick={() => copy(tweet2Text())}>
                <Icon name="copy" size={13} /> Copy
              </button>
            {/if}
            <button class="btn btn-ghost btn-sm danger-hover" onclick={() => (mediaEnabled = false)} title="Remove media tweet">
              <Icon name="x" size={13} />
            </button>
          </div>
          {#if mediaType !== 'none'}
            <div class="media-prefix">{mediaType === 'video' ? '2/ Video:' : '2/ Image:'}</div>
            <textarea
              class="textarea post-text mono"
              dir="auto"
              placeholder="Paste URL or describe the media…"
              bind:value={mediaText}
              rows="3"
            ></textarea>
            <div class="media-attach">
              <button class="btn btn-ghost btn-sm" onclick={openPicker}>
                <Icon name="media" size={13} /> Choose from library
              </button>
              {#if mediaPath}
                <span class="attach-chip">
                  {#if mediaHref}
                    <a href={mediaHref} target="_blank" rel="noreferrer" title={mediaPath}>
                      {mediaPath.replace(/^media\//, '')}
                    </a>
                  {:else}
                    {mediaPath.replace(/^media\//, '')}
                  {/if}
                  <button class="chip-x" onclick={clearMedia} title="Detach media">
                    <Icon name="x" size={11} />
                  </button>
                </span>
                {#if mediaType === 'images'}
                  <button class="btn btn-ghost btn-sm" onclick={() => copyImage(mediaHref)} title="Copy the image — paste it into X">
                    <Icon name="copy" size={13} /> Copy image
                  </button>
                {:else}
                  <button class="btn btn-ghost btn-sm" onclick={() => downloadMedia(mediaHref, mediaPath)} title="Download the video, then drag it into X">
                    <Icon name="download" size={13} /> Download
                  </button>
                {/if}
              {/if}
            </div>
          {:else}
            <span class="muted">Toggle Video or Image to add a media tweet</span>
          {/if}
        </div>
        {/if}

        <!-- Extra context tweets (3, 4, …) -->
        {#each extraTweets as tweet, i (tweet.id)}
          <div class="tweet-block card">
            <div class="tweet-head">
              <span class="tweet-num">{i + 3}</span>
              <span class="label" style="margin:0">Context</span>
              <span class="counter" class:over={weightedLength(tweet.text) > X_LIMIT}>
                {weightedLength(tweet.text)}/{X_LIMIT}
              </span>
              <button class="btn btn-ghost btn-sm" onclick={() => copy(tweet.text)} disabled={!tweet.text.trim()}>
                <Icon name="copy" size={13} /> Copy
              </button>
              <button class="btn btn-ghost btn-sm danger-hover" onclick={() => removeExtraTweet(tweet.id)} title="Remove tweet">
                <Icon name="x" size={13} />
              </button>
            </div>
            <textarea
              class="textarea post-text mono"
              dir="auto"
              placeholder="Additional context…"
              bind:value={tweet.text}
              rows="4"
            ></textarea>
          </div>
        {/each}

        <div class="thread-actions">
          {#if !mediaEnabled}
            <button class="btn btn-ghost btn-sm" onclick={() => (mediaEnabled = true)}>
              <Icon name="plus" size={13} /> Add media tweet
            </button>
          {/if}
          <button class="btn btn-ghost btn-sm" onclick={addExtraTweet}>
            <Icon name="plus" size={13} /> Add context tweet
          </button>
          <button class="btn btn-ghost btn-sm" onclick={copyAll}>
            <Icon name="copy" size={13} /> Copy all
          </button>
        </div>

      </div>
    </div>
  </div>
</div>

{#if openList}
  <Modal title="Open a saved draft" onclose={() => (openList = null)} width="560px">
    {#if !openList.length}
      <div class="empty"><p>No saved drafts in this case yet.</p></div>
    {:else}
      <div class="open-list">
        {#each openList as entry (entry.name)}
          <div class="open-row-wrap">
            <button class="open-row" onclick={() => loadDraft(entry.name)}>
              <div class="open-meta">
                <span class="open-title">{entry.title}</span>
                <span class="open-sub">{entry.updated_at?.slice(0, 10)}</span>
              </div>
            </button>
            <button class="btn btn-ghost btn-sm open-del" title="Delete this saved draft" onclick={() => (deleteEntry = entry)}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </Modal>
{/if}

{#if deleteEntry}
  <ConfirmDialog
    title="Delete this draft?"
    message={`“${deleteEntry.title}” will be removed from the case.`}
    detail="This permanently deletes the saved draft. It cannot be undone."
    confirmLabel="Delete"
    tone="danger"
    icon="trash"
    onconfirm={deleteSavedDraft}
    oncancel={() => (deleteEntry = null)}
  />
{/if}

{#if discardConfirm}
  <ConfirmDialog
    title="Discard this draft?"
    message="This clears the current post."
    detail={draftName ? 'This does not delete the saved draft, only the unsaved changes here.' : 'Anything not saved yet will be lost.'}
    confirmLabel="Discard"
    tone="danger"
    icon="reset"
    onconfirm={resetDraft}
    oncancel={() => (discardConfirm = false)}
  />
{/if}

{#if pickerOpen}
  <Modal title="Choose a media" width="640px" onclose={() => (pickerOpen = false)}>
    {#if mediaLibrary.length === 0}
      <p class="picker-empty">No media in this case yet. Import or download some in the Media tab.</p>
    {:else}
      <div class="picker-grid">
        {#each (caseState.current ? mediaLibrary : []) as item (item.path)}
          <button class="picker-item" onclick={() => pickMedia(item)} title={item.path}>
            <div class="picker-thumb">
              {#if item.thumbnail}
                <img src={`/files/${caseState.current.id}/${item.thumbnail}`} alt={item.path} />
              {:else}
                <Icon name={item.kind === 'video' ? 'video' : item.kind === 'audio' ? 'audio' : 'file'} size={24} />
              {/if}
              {#if item.kind === 'video'}<span class="kind-badge"><Icon name="video" size={11} /></span>{/if}
            </div>
            <span class="picker-name">{(item.label || item.path).replace(/^media\//, '')}</span>
          </button>
        {/each}
      </div>
    {/if}
  </Modal>
{/if}

{#if proofPickerOpen}
  <Modal title="Attach a proof" width="640px" onclose={() => (proofPickerOpen = false)}>
    {#if proofLibrary.length === 0}
      <p class="picker-empty">No proofs in this case yet. Build one in the Proof tab.</p>
    {:else}
      <div class="picker-grid">
        {#each (caseState.current ? proofLibrary : []) as item (item.name)}
          <button class="picker-item" onclick={() => pickProof(item)} title={item.title} disabled={!item.png}>
            <div class="picker-thumb">
              {#if item.png}
                <img src={`/files/${caseState.current.id}/${item.png}`} alt={item.title} />
              {:else}
                <Icon name="proof" size={24} />
              {/if}
            </div>
            <span class="picker-name">{item.title || item.name}</span>
          </button>
        {/each}
      </div>
    {/if}
  </Modal>
{/if}

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(300px, 420px) minmax(360px, 1fr);
    gap: 26px;
    padding: 20px;
    max-width: 1200px;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }
  .geo-facts {
    margin-top: 8px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .fact {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    padding: 3px 6px;
    border-radius: var(--r-sm);
    text-align: left;
  }
  .fact:hover { background: var(--bg-3); color: var(--text-1); }
  .links {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    padding: 6px 6px 2px;
  }
  .loading {
    text-transform: none;
    letter-spacing: 0;
    color: var(--accent);
    font-weight: 500;
  }
  .proof-preview {
    max-height: 200px;
    object-fit: contain;
    padding: 6px;
  }
  .proof-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }
  .proof-attach {
    align-self: flex-start;
    border: 1px dashed var(--border);
  }

  /* Thread / tweet blocks */
  .tweet-block {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tweet-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tweet-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--bg-3);
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-2);
    flex-shrink: 0;
  }
  .counter {
    margin-left: auto;
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--ok);
    font-family: var(--font-mono);
  }
  .counter.over { color: var(--danger); }
  .post-text {
    font-size: var(--fs-sm);
    line-height: 1.6;
    min-height: 0;
  }
  .media-tabs {
    display: flex;
    gap: 4px;
  }
  .media-prefix {
    font-size: var(--fs-xs);
    font-family: var(--font-mono);
    color: var(--text-2);
    padding: 2px 0;
  }
  .muted {
    font-size: var(--fs-xs);
    color: var(--text-3);
    padding: 4px 0;
  }
  .thread-actions {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 4px 0;
    flex-wrap: wrap;
  }
  .danger-hover:hover { color: var(--danger); }

  /* header actions */
  .tool-header {
    display: flex;
    align-items: flex-start;
    gap: 16px;
  }
  .head-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .head-actions {
    margin-left: auto;
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  /* media attachment */
  .media-attach {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding-top: 2px;
  }
  .attach-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px 3px 9px;
    background: var(--bg-3);
    border-radius: var(--r-sm);
    font-size: var(--fs-xs);
    font-family: var(--font-mono);
    color: var(--text-1);
    max-width: 100%;
  }
  .attach-chip a {
    color: var(--text-1);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .attach-chip a:hover { color: var(--accent); }
  .chip-x {
    display: inline-flex;
    color: var(--text-3);
  }
  .chip-x:hover { color: var(--danger); }

  /* media picker */
  .picker-empty {
    color: var(--text-3);
    font-size: var(--fs-sm);
    padding: 8px 0;
  }
  .picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
  }
  .picker-item {
    display: flex;
    flex-direction: column;
    gap: 5px;
    text-align: left;
  }
  .picker-thumb {
    position: relative;
    aspect-ratio: 4 / 3;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    overflow: hidden;
    color: var(--text-3);
  }
  .picker-item:hover .picker-thumb {
    border-color: var(--accent);
  }
  .picker-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .kind-badge {
    position: absolute;
    bottom: 4px;
    right: 4px;
    background: rgba(0, 0, 0, 0.6);
    border-radius: var(--r-sm);
    padding: 2px;
    color: #fff;
    display: inline-flex;
  }
  .picker-name {
    font-size: var(--fs-xs);
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .open-list { display: flex; flex-direction: column; gap: 8px; }
  .open-row-wrap { display: flex; align-items: center; gap: 4px; }
  .open-row-wrap .open-row { flex: 1; min-width: 0; }
  .open-del { color: var(--danger); flex-shrink: 0; }
  .open-row {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    cursor: pointer;
    text-align: left;
  }
  .open-row:hover { border-color: var(--accent); }
  .open-meta { display: flex; flex-direction: column; gap: 2px; }
  .open-title { font-weight: 600; font-size: var(--fs-sm); }
  .open-sub { font-size: var(--fs-xs); color: var(--text-3); }
</style>
