<script>
  import { api } from '../lib/api.js';
  import { fetchAllEntities, lookupEntity, fetchDerivation } from '../lib/catalog.js';
  import { caseState, uiState, toast, reloadCase, prefs } from '../lib/state.svelte.js';
  import { templatesState } from '../lib/state.svelte.js';
  import { createNote } from '../lib/notes.js';
  import { openNotebook } from '../lib/navigate.js';
  import { deletedToast, RESTORABLE } from '../lib/trash.js';
  import { proofCoordsText, proofSource } from '../lib/composer.js';
  import { isDefaultName, nextName, savedSlugs, savedTitles, savedTitle, slugify } from '../lib/naming.js';
  import { filingName, planProofHandoff } from './post/handoff.js';
  import {
    buildTweet1 as buildTweet1Lines, DEFAULT_TWEET_BODY,
    extraPostTweetText, groupPostMedia, MAX_POST_MEDIA, mediaTweetText,
    applyPostTemplateStructure, newPostMediaTweet, proofSourceMediaPaths,
    normalizePostMediaPickerTarget, postMediaForType, renumberMediaTweetText, retargetMediaTweetText,
    normalizePostTarget, POST_TARGETS, postCharacterCount, postComposeUrl, postReportMarkdown,
    postTarget, templateUsesPostField, togglePostMedia,
  } from '../lib/post.js';
  import { bidiSafe } from '../lib/bidi.js';
  import { matchesQuery } from '../lib/mediaFilter.js';
  import Icon from '../components/Icon.svelte';
  import SearchInput from '../components/SearchInput.svelte';
  import Modal from '../components/Modal.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import FolderSelect from '../components/FolderSelect.svelte';

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
  let target = $state('x');
  const targetInfo = $derived(postTarget(target));

  // The active thread layout — a token body (lib/post.js). buildTweet1 fills the
  // tokens from the draft. A post template swaps this out; the default is the
  // classic GeoConfirmed thread.
  let body = $state(DEFAULT_TWEET_BODY);

  // Media tweet (tweet 2)
  let mediaEnabled = $state(true);
  let mediaType = $state('none'); // 'none' | 'video' | 'images'
  let mediaText = $state(''); // complete, editable tweet 2 text (prefix included)
  let mediaPaths = $state([]); // local media selected for tweet 2 (case-relative)

  // Extra context tweets (3, 4, …)
  let extraSeq = 0;
  let extraTweets = $state([]); // [{ id, text, mediaPaths, mediaType }]

  // Draft persistence. The name in the header is the draft's filename: saving
  // writes under it, and renaming a saved draft moves its file (the backend
  // does the move). `draftName` is the slug it is currently bound to, or null
  // before the first save.
  let postName = $state('');
  let draftName = $state(null);

  // Every draft already saved in this case: the slugs to catch a name already
  // taken, the names so a fresh draft reads apart from them.
  let draftEntities = $state([]);
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev;
    if (!id) {
      draftEntities = [];
      return;
    }
    let live = true;
    fetchAllEntities(id, { types: ['post'] })
      .then((list) => {
        if (!live) return;
        draftEntities = list;
        // The name was assigned before the case's drafts were known. Renumber it
        // now rather than letting a fresh thread collide on its first save.
        if (!draftName && isDefaultName(postName, 'draft')) postName = freshPostName();
      })
      .catch(() => { if (live) draftEntities = []; });
    return () => { live = false; };
  });

  // Numbered past the drafts already in the case, so two never-renamed threads
  // read apart. Assigned on mount and on discard.
  const freshPostName = () => nextName('draft', savedTitles(draftEntities, 'draft'));

  // Kept in step with deletes made anywhere else in the app: a draft deleted
  // from the sidebar must not be resurrected by the next Save under its old
  // name. The thread on screen stays — a post outlives its proof (ONTOLOGY §3),
  // it only loses the attachment.
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev;
    const draft = draftName;
    const proof = proofPng;
    if (!id) return;
    let live = true;
    (async () => {
      if (draft) {
        const bound = await lookupEntity(id, 'draft', `.drafts/${draft}.json`);
        if (live && !bound && draftName === draft) {
          draftName = null;
          toast('The saved draft was deleted. Saving now creates a new one', 'warn');
        }
      }
      if (proof) {
        const bound = await lookupEntity(id, 'path', proof);
        if (live && !bound && proofPng === proof) {
          setProof(null);
          toast('The attached proof was deleted. The thread text is unchanged', 'warn');
        }
      }
    })();
    return () => {
      live = false;
    };
  });
  let saving = $state(false);
  let reportModal = $state(null); // { title, folder }
  let reportSaving = $state(false);
  let discardConfirm = $state(false);
  let openList = $state(null); // list of saved drafts, null = closed

  // Media picker modal
  let pickerOpen = $state(false);
  let mediaLibrary = $state([]);
  let mediaPickerTarget = $state(null); // null = tweet 2; an id = a later media tweet
  let pickerQuery = $state(''); // search box, shown once the picker holds >6 items

  // path → media kind, from our own /media shelf, so attach chips can label a
  // video without scanning the whole entity graph. Refreshed on case change.
  let kindByPath = $state(new Map());
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev;
    if (!id) {
      kindByPath = new Map();
      return;
    }
    let live = true;
    api
      .get(`/api/cases/${id}/media`)
      .then((items) => {
        if (live) kindByPath = new Map(items.map((it) => [it.path, it.kind]));
      })
      .catch(() => { if (live) kindByPath = new Map(); });
    return () => { live = false; };
  });

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
    adoptProof(p);
  });

  /**
   * A proof arriving from the Proof Composer opens its own thread. The one on
   * screen is filed under its own name first and then makes way, so sending a
   * second proof over does not write over the post the first one produced.
   * Re-sending the proof this thread already carries stays in place instead —
   * that is the same piece of work, edited.
   */
  async function adoptProof(p) {
    const plan = planProofHandoff({ incomingPng: p.png, currentPng: proofPng, hasContent });
    if (plan === 'file-then-apply') {
      if (!(await fileCurrentDraft())) return;
      resetDraft();
    }
    applyProof(p);
  }

  /** Save what the composer holds under its own name, before something else
   *  takes its place. Answers whether the thread is safely on disk. */
  async function fileCurrentDraft() {
    if (!caseState.current) return true;
    const title = postName.trim();
    if (!title) return true;
    postName = filingName({
      title,
      bound: !!draftName,
      takenSlugs: savedSlugs(draftEntities, 'draft'),
      slug: slugify(title, 'draft'),
      fresh: freshPostName(),
    });
    const saved = await performDraftSave(`Post saved: ${postName.trim()}`);
    if (!saved) return false;
    // The name for the next thread has to count past the one just written,
    // which the case-wide list does not know about yet.
    draftEntities = await fetchAllEntities(caseState.current.id, { types: ['post'] })
      .catch(() => draftEntities);
    return true;
  }

  function applyProof(p) {
    description = isDefaultName(p.title, 'proof') ? '' : (p.title ?? '');
    const proofSourceUrl = p.source ?? p.sources?.[0] ?? '';
    source = proofSourceUrl;
    setProof(p.png ?? null);
    preloadProofMedia(p.png, proofSourceUrl);
    tweet1Edited = false;
    coordsText = p.coordsText
      ?? (p.coords ? `${p.coords.lat.toFixed(6)}, ${p.coords.lon.toFixed(6)}` : '');
    if (coordsText.trim()) resolveCoords();
    else regenerate();
  }

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
    return buildTweet1Lines(body, {
      place,
      plusCode: geo?.plus_code,
      description,
      lat: geo?.lat,
      lon: geo?.lon,
      mention,
      source,
    });
  }

  function regenerate() {
    tweet1 = buildTweet1();
    tweet1Edited = false;
  }

  // ---- thread templates ----------------------------------------------------
  // Apply a saved post template (Settings → Templates). Content-free: only
  // the mention, token body, media flag and boilerplate extra tweets travel.
  // The thread structure laid over this draft: { name, prev } so "Discard" can
  // walk back to the structure the draft had before. UI-only, cleared whenever
  // the draft is reset or a saved one is opened.
  let appliedPostTemplate = $state(null);

  const TEMPLATE_FIELD_HINT = 'This template does not use this field.';

  function fieldDisabledByTemplate(field) {
    return !!appliedPostTemplate && !templateUsesPostField(body, field);
  }

  // The four structural fields a template swaps, snapshotted for a clean restore.
  function snapshotPostStructure() {
    return {
      mention,
      body,
      mediaEnabled,
      extraTweets: extraTweets.map((e) => ({
        text: e.text,
        mediaPaths: [...e.mediaPaths],
        mediaType: e.mediaType,
        isMediaTweet: e.isMediaTweet === true,
        mediaTextIncludesPrefix: e.mediaTextIncludesPrefix === true,
      })),
    };
  }

  function applyPostTemplate(t) {
    // first apply snapshots the current structure; re-applying keeps that
    // original, so Discard always returns to the pre-template layout.
    const prev = appliedPostTemplate?.prev ?? snapshotPostStructure();
    const norm = applyPostTemplateStructure({}, t.data);
    mention = norm.mention;
    body = norm.body;
    mediaEnabled = norm.mediaEnabled;
    extraTweets = norm.extraTweets.map((e) => ({ id: ++extraSeq, ...e }));
    appliedPostTemplate = { name: t.name, prev };
    if (!tweet1Edited) regenerate();
    toast(`Template loaded: ${t.name}`, 'ok', 1400);
  }

  function applyPostFromSelect(e) {
    const t = templatesState.post.find((x) => x.id === e.target.value);
    e.target.value = '';
    if (t) applyPostTemplate(t);
  }

  function discardPostTemplate() {
    if (!appliedPostTemplate) return;
    const p = appliedPostTemplate.prev;
    mention = p.mention;
    body = p.body;
    mediaEnabled = p.mediaEnabled;
    extraTweets = p.extraTweets.map((e) => ({
      id: ++extraSeq,
      text: e.text,
      mediaPaths: [...(e.mediaPaths ?? [])],
      mediaType: e.mediaType ?? 'none',
      isMediaTweet: e.isMediaTweet === true,
      mediaTextIncludesPrefix: e.mediaTextIncludesPrefix === true,
    }));
    appliedPostTemplate = null;
    if (!tweet1Edited) regenerate();
    toast('Template removed', 'ok', 1200);
  }

  function openTemplateSettings() {
    uiState.settingsTab = 'templates';
    uiState.tool = 'settings';
  }

  function targetLength(text) {
    // Count the bidi-safe text that gets copied, so coordinates, plus codes,
    // mentions and URLs stay honest in right-to-left posts too.
    return postCharacterCount(target, bidiSafe(text));
  }

  function tweet2Text() {
    return mediaText.trim();
  }

  const tweet1Count = $derived(targetLength(tweet1));
  const tweet1Over = $derived(tweet1Count > targetInfo.limit);

  function addExtraTweet() {
    extraTweets.push({
      id: ++extraSeq, text: '', mediaPaths: [], mediaType: 'none',
      isMediaTweet: false,
      mediaTextIncludesPrefix: false,
    });
  }

  function addMediaTweet() {
    extraTweets.push(newPostMediaTweet(++extraSeq, extraTweets.length + 3));
  }

  function removeExtraTweet(id) {
    const i = extraTweets.findIndex((t) => t.id === id);
    if (i === -1) return;
    extraTweets.splice(i, 1);
    for (let j = i; j < extraTweets.length; j += 1) {
      const tweet = extraTweets[j];
      if (!tweet.mediaTextIncludesPrefix || tweet.mediaType === 'none') continue;
      tweet.text = renumberMediaTweetText(tweet.text, tweet.mediaType, j + 4, j + 3);
    }
  }

  function extraTweetText(tweet, number) {
    return extraPostTweetText(tweet, number);
  }

  // Copies go through bidiSafe so coordinates, plus codes, mentions and URLs
  // keep reading left-to-right in Arabic or Hebrew posts (see lib/bidi).
  async function copy(value) {
    await navigator.clipboard.writeText(bidiSafe(value));
    toast('Copied to clipboard', 'ok', 1600);
  }

  function threadParts() {
    const parts = [tweet1];
    if (mediaEnabled && mediaType !== 'none') parts.push(tweet2Text());
    for (let i = 0; i < extraTweets.length; i += 1) {
      const tweet = extraTweets[i];
      const text = extraTweetText(tweet, i + 3);
      if (text) parts.push(text);
    }
    return parts.filter((part) => part.trim());
  }

  async function copyAll(showToast = true) {
    const parts = threadParts();
    await navigator.clipboard.writeText(parts.map(bidiSafe).join('\n\n---\n\n'));
    if (showToast) toast('All posts copied', 'ok', 1800);
  }

  // ---- media picker -------------------------------------------------------

  async function openPicker(target = null) {
    if (!caseState.current) {
      toast('Open a case to pick from your media', 'warn');
      return;
    }
    try {
      mediaLibrary = await api.get(`/api/cases/${caseState.current.id}/media`);
      mediaPickerTarget = normalizePostMediaPickerTarget(target);
      pickerQuery = '';
      pickerOpen = true;
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  function pickerTweet() {
    return mediaPickerTarget === null
      ? { mediaPaths, mediaType }
      : extraTweets.find((tweet) => tweet.id === mediaPickerTarget);
  }

  function pickerItems() {
    return postMediaForType(mediaLibrary, pickerTweet()?.mediaType);
  }

  // The picker narrows by a search box once the list grows past six. Reuses the
  // Media Library matcher (filename/title/notes/source).
  function visiblePickerItems() {
    const items = pickerItems();
    const q = pickerQuery.trim();
    return q ? items.filter((m) => matchesQuery(m, q)) : items;
  }

  function pickerTitle() {
    const tweet = pickerTweet();
    const kind = tweet?.mediaType === 'video' ? 'videos' : 'images';
    return `Choose ${kind} (${tweet?.mediaPaths.length ?? 0}/${MAX_POST_MEDIA})`;
  }

  function pickMedia(item) {
    const tweet = pickerTweet();
    if (!tweet) return;
    const selection = togglePostMedia(tweet, item);
    if (selection.outcome === 'unsupported') {
      toast('Post media must be an image or video', 'warn');
      return;
    }
    if (selection.outcome === 'limit') {
      toast(`A post can hold up to ${MAX_POST_MEDIA} media files`, 'warn');
      return;
    }
    if (mediaPickerTarget === null) {
      mediaText = retargetMediaTweetText(mediaText, mediaType, selection.mediaType, 2);
      mediaPaths = selection.mediaPaths;
      mediaType = selection.mediaType;
    } else {
      tweet.mediaPaths = selection.mediaPaths;
      tweet.mediaType = selection.mediaType;
    }
  }

  function clearMedia(path) {
    mediaPaths = mediaPaths.filter((entry) => entry !== path);
  }

  function clearExtraMedia(id, path) {
    const tweet = extraTweets.find((entry) => entry.id === id);
    if (!tweet) return;
    tweet.mediaPaths = tweet.mediaPaths.filter((entry) => entry !== path);
  }

  function setMediaType(type) {
    if (mediaType === type) return;
    mediaPaths = [];
    mediaText = retargetMediaTweetText(mediaText, mediaType, type, 2);
    mediaType = type;
  }

  function setExtraMediaType(tweet, type) {
    if (tweet.mediaType === type) return;
    const number = extraTweets.findIndex((entry) => entry.id === tweet.id) + 3;
    tweet.mediaPaths = [];
    if (tweet.mediaTextIncludesPrefix) {
      tweet.text = retargetMediaTweetText(tweet.text, tweet.mediaType, type, number);
    }
    tweet.mediaType = type;
    tweet.isMediaTweet = true;
  }

  // ---- proof picker -------------------------------------------------------

  /** Assign the attached proof and bump the cache-buster so the preview always
   *  reflects the current file — proofs default to the same slug/filename, so
   *  the URL alone can be identical across different proofs. */
  function setProof(png) {
    proofPng = png;
    proofVer = png ? Date.now() : 0;
  }

  async function preloadProofMedia(png, proofSourceUrl) {
    if (!png || !proofSourceUrl || !caseState.current) return;
    try {
      const cid = caseState.current.id;
      const proof = await lookupEntity(cid, 'path', png);
      if (!proof) return;
      const [library, graph] = await Promise.all([
        api.get(`/api/cases/${cid}/media`),
        fetchDerivation(cid, proof.id),
      ]);
      const linkedMedia = proofSourceMediaPaths(graph, png, proofSourceUrl, library);
      if (!linkedMedia.length) return;

      const selected = new Set([
        ...mediaPaths,
        ...extraTweets.flatMap((tweet) => tweet.mediaPaths),
      ]);
      const added = linkedMedia.filter((path) => !selected.has(path));
      if (!added.length) return;
      const groups = groupPostMedia(added, mediaKind);

      if (!mediaPaths.length && groups.length) {
        const first = groups.shift();
        mediaPaths = first.mediaPaths;
        mediaEnabled = true;
        const nextType = first.mediaType;
        mediaText = retargetMediaTweetText(mediaText, mediaType, nextType, 2);
        mediaType = nextType;
      }
      for (const group of groups) {
        const tweet = newPostMediaTweet(++extraSeq, extraTweets.length + 3, group.mediaType);
        tweet.mediaPaths = group.mediaPaths;
        extraTweets.push(tweet);
      }
      toast(`${added.length} source media ${added.length === 1 ? 'file' : 'files'} added to the thread`, 'ok', 2000);
    } catch {
      /* Media selection is a convenience; attaching the proof still works offline. */
    }
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
    if (!description.trim() && item.title && !isDefaultName(item.title, 'proof')) {
      description = item.title;
    }
    // Pull the proof's coordinates + source into the post so the fields fill in.
    try {
      const spec = await api.get(`/api/cases/${caseState.current.id}/proofs/${item.name}`);
      const src = proofSource(spec);
      if (src) source = src;
      await preloadProofMedia(item.png, src);
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

  function mediaHref(path) {
    return path && caseState.current ? `/files/${caseState.current.id}/${path}` : null;
  }

  function mediaKind(path) {
    return kindByPath.get(path) ?? 'image';
  }

  const proofHref = $derived(
    proofPng && caseState.current
      ? `/files/${caseState.current.id}/${proofPng}${proofVer ? `?v=${proofVer}` : ''}`
      : null
  );

  // ---- one-click image copy / media download ------------------------------

  /** Rasterise any image blob to PNG so it can be pasted into a social composer. */
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

  /** Copy an image into the clipboard for the selected social composer. */
  async function copyImage(url) {
    try {
      const res = await fetch(url);
      let blob = await res.blob();
      if (blob.type !== 'image/png') blob = await toPngBlob(blob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast(`Image copied. Paste it into ${targetInfo.label}.`, 'ok', 2400);
    } catch (e) {
      toast(`Could not copy image: ${e.message}`, 'danger');
    }
  }

  function triggerMediaDownload(url, path) {
    const a = document.createElement('a');
    a.href = url;
    a.download = (path ?? '').split('/').pop() || 'media';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /** Download every attachment from one post. */
  function downloadPostMedia(paths) {
    for (const path of paths) triggerMediaDownload(mediaHref(path), path);
    toast(
      paths.length === 1
        ? `Media downloaded. Drag it into ${targetInfo.label}.`
        : `${paths.length} media files downloaded. Drag them into ${targetInfo.label}.`,
      'info',
      2600,
    );
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
      target,
      body,
      mediaEnabled,
      mediaType,
      mediaText,
      mediaTextIncludesPrefix: true,
      mediaPaths: [...mediaPaths],
      // Kept for drafts saved by older app versions.
      mediaPath: mediaPaths[0] ?? null,
      extraTweets: extraTweets.map((t) => ({
        text: t.text,
        mediaPaths: [...t.mediaPaths],
        mediaType: t.mediaType ?? 'none',
        isMediaTweet: t.isMediaTweet === true,
        mediaTextIncludesPrefix: t.mediaTextIncludesPrefix === true,
      })),
    };
  }

  // The saved report is titled after the thread it documents, so the two read as
  // one piece of work. The report dialog leaves it editable.
  const draftTitle = () => postName.trim() || 'Untitled post';

  // Saving writes under the name in the header. A bound draft writes back over
  // itself, and renaming it moves the file — the backend refuses a rename onto a
  // name another draft holds. An unbound draft landing on a saved name is the
  // one case that can go either way, so it asks first.
  let overwritePrompt = $state(null);

  async function saveDraft() {
    if (!caseState.current) {
      toast('Open a case to save a draft', 'warn');
      return;
    }
    const title = postName.trim();
    if (!title || saving) return;
    if (!draftName && savedSlugs(draftEntities, 'draft').has(slugify(title, 'draft'))) {
      overwritePrompt = { slug: slugify(title, 'draft') };
      return;
    }
    return performDraftSave();
  }

  async function performDraftSave(message = 'Draft saved') {
    saving = true;
    try {
      const r = await api.post(`/api/cases/${caseState.current.id}/drafts`, {
        rename_from: draftName,
        title: postName.trim(),
        state: snapshot(),
      });
      draftName = r.name;
      postName = r.title;
      await reloadCase(); // surface the post entity in the sidebar
      toast(message, 'ok', 1600);
      return true;
    } catch (e) {
      toast(`Draft not saved: ${e.message}`, 'danger');
      return false;
    } finally {
      saving = false;
      overwritePrompt = null;
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
      const caseId = caseState.current.id;
      const result = await api.del(`/api/cases/${caseId}/drafts/${entry.name}`);
      await Promise.all([openDraftList(), reloadCase()]);
      deletedToast(caseId, result, entry.title);
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
      mediaText = mediaType === 'none'
        ? ''
        : s.mediaTextIncludesPrefix
          ? String(s.mediaText ?? '')
          : mediaTweetText(mediaType, s.mediaText ?? '', 2);
      mediaPaths = Array.isArray(s.mediaPaths)
        ? s.mediaPaths.filter((path) => typeof path === 'string').slice(0, MAX_POST_MEDIA)
        : (s.mediaPath ? [s.mediaPath] : []);
      body = typeof s.body === 'string' && s.body ? s.body : DEFAULT_TWEET_BODY;
      extraTweets = (s.extraTweets ?? []).map((t, i) => {
        const type = t.mediaType ?? 'none';
        const hasPrefix = t.mediaTextIncludesPrefix === true;
        const isMediaTweet = t.isMediaTweet === true || type !== 'none';
        return {
          id: ++extraSeq,
          text: type !== 'none' && !hasPrefix
            ? mediaTweetText(type, t.text ?? '', i + 3)
            : (t.text ?? ''),
          mediaPaths: Array.isArray(t.mediaPaths)
            ? t.mediaPaths.filter((path) => typeof path === 'string').slice(0, MAX_POST_MEDIA)
            : (typeof t.mediaPath === 'string' ? [t.mediaPath] : []),
          mediaType: type,
          isMediaTweet,
          mediaTextIncludesPrefix: isMediaTweet || hasPrefix,
        };
      });
      draftName = name;
      postName = doc.title || name;
      appliedPostTemplate = null;
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
      target = normalizePostTarget(s.target);
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
    target = normalizePostTarget(prefs.postTarget);
    mediaEnabled = true;
    mediaType = 'none';
    mediaText = '';
    mediaPaths = [];
    body = DEFAULT_TWEET_BODY;
    extraTweets = [];
    draftName = null;
    postName = freshPostName();
    appliedPostTemplate = null;
    discardConfirm = false;
  }

  const hasContent = $derived(
    !!(draftName || description.trim() || coordsText.trim() || mediaPaths.length || proofPng ||
      extraTweets.length || tweet1.trim())
  );

  // Preferences can arrive after this tool mounts. A blank composer follows the
  // preferred platform, while a selected or saved draft keeps its own target.
  $effect(() => {
    if (!hasContent) target = normalizePostTarget(prefs.postTarget);
  });

  function reportAttachmentPaths() {
    return [
      proofPng,
      ...mediaPaths,
      ...extraTweets.flatMap((tweet) => tweet.mediaPaths),
    ].filter(Boolean);
  }

  async function reportEntities() {
    if (!caseState.current) return { proofEntity: null, mediaEntities: [] };
    const paths = [...new Set(reportAttachmentPaths())];
    const resolved = await Promise.all(paths.map(async (path) => {
      try {
        return [path, await lookupEntity(caseState.current.id, 'path', path)];
      } catch {
        return [path, null];
      }
    }));
    const byPath = new Map(resolved.filter(([, entity]) => entity));
    return {
      proofEntity: proofPng ? byPath.get(proofPng) ?? null : null,
      mediaEntities: paths
        .filter((path) => path !== proofPng)
        .map((path) => byPath.get(path))
        .filter(Boolean),
    };
  }

  function reportContent(title = draftTitle(), evidence = {}) {
    const coordinates = geo
      ? `${geo.lat.toFixed(6)}, ${geo.lon.toFixed(6)}`
      : coordsText.trim();
    return postReportMarkdown({
      title,
      place,
      plusCode: geo?.plus_code,
      coordinates,
      dms: geo?.dms,
      mapLinks: geo?.links,
      description,
      source,
      attachments: reportAttachmentPaths(),
      ...evidence,
    });
  }

  function openSaveReport() {
    if (!caseState.current) {
      toast('Open a case to save a report', 'warn');
      return;
    }
    reportModal = { title: draftTitle(), folder: '' };
  }

  async function saveReport() {
    if (!reportModal || !caseState.current) return;
    if (!reportModal.title.trim()) {
      toast('Title required', 'warn');
      return;
    }
    reportSaving = true;
    try {
      const evidence = await reportEntities();
      const note = await createNote(caseState.current.id, {
        title: reportModal.title,
        folder: reportModal.folder,
        content: reportContent(reportModal.title.trim(), evidence),
        // What the report was written from: the proof and media it embeds, and the
        // draft it was composed in when that draft is saved. The note reads as a
        // page of case files, so the graph has to say which ones — otherwise
        // deleting a proof leaves a dead image nothing accounted for.
        sources: [
          ...reportAttachmentPaths(),
          ...(draftName ? [`.drafts/${draftName}.json`] : []),
        ],
      });
      await reloadCase();
      reportModal = null;
      toast('Report saved as a note', 'ok', 6000, {
        label: 'OPEN',
        onClick: () => openNotebook(note.id),
      });
    } catch (error) {
      toast(`Report not saved: ${error.message}`, 'danger');
    } finally {
      reportSaving = false;
    }
  }

  // ---- publish handoff (Azimut never posts on the analyst's behalf) --------

  async function publish() {
    // Social intents prefill the first post only. The rest is copied as replies.
    await copyAll(false);
    const url = postComposeUrl(target, bidiSafe(tweet1));
    window.open(url, '_blank', 'noopener,noreferrer');
    toast(`Opened ${targetInfo.label}. Posts copied for replies.`, 'info', 3200);
  }
</script>

<div class="tool">
  <div class="tool-header">
    <div class="head-text">
      <h2>Geo Report</h2>
    </div>
    {#if caseState.current}
      <input class="input title-input" bind:value={postName} maxlength="200" aria-label="Post name" />
    {/if}
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
      <button class="btn btn-ghost btn-sm" onclick={saveDraft} disabled={saving || !postName.trim()}>
        <Icon name="save" size={14} /> {draftName ? 'Save draft' : 'Save as draft'}
      </button>
      <button class="btn btn-ghost btn-sm" onclick={openSaveReport} disabled={!hasContent || reportSaving}>
        <Icon name="file" size={14} /> Save report
      </button>
      <button class="btn btn-primary btn-sm" onclick={publish} disabled={!tweet1.trim()} title={`Copy posts and open ${targetInfo.label}`}>
        <Icon name="post" size={14} /> Publish on {targetInfo.label}
      </button>
    </div>
  </div>

  <div class="tool-body">
    <div class="layout">
      <!-- left column: ingredients -->
      <div class="col">
        <div class="field">
          <span class="label">Publish target</span>
          <div class="target-tabs" aria-label="Publish target">
            {#each Object.values(POST_TARGETS) as option (option.id)}
              <button
                class="btn btn-sm"
                class:btn-primary={target === option.id}
                class:btn-ghost={target !== option.id}
                onclick={() => (target = option.id)}
              >{option.label}</button>
            {/each}
          </div>
        </div>

        <!-- Thread style: apply a saved structure (mention, layout, media flag,
             boilerplate tweets) over this draft. "Discard" returns to the
             structure the draft had before. -->
        <div class="field">
          <div class="style-head">
            <label class="label" for="pc-tpl">Thread style</label>
            {#if templatesState.post.length}
              <button
                class="tpl-settings-link"
                type="button"
                title="Manage thread templates in Settings"
                onclick={openTemplateSettings}
              >
                Settings templates
              </button>
            {/if}
          </div>
          {#if appliedPostTemplate}
            <div class="tpl-loaded" title={`Template loaded: ${appliedPostTemplate.name}`}>
              <span class="tpl-loaded-name">
                <Icon name="check" size={12} /> {appliedPostTemplate.name}
              </span>
              <button class="tpl-remove" title="Remove this template" onclick={discardPostTemplate} aria-label="Remove template">
                <Icon name="x" size={12} />
              </button>
            </div>
          {:else if templatesState.post.length}
            <select id="pc-tpl" class="input" onchange={applyPostFromSelect}>
              <option value="">Apply a template…</option>
              {#each templatesState.post as t (t.id)}
                <option value={t.id}>{t.name}</option>
              {/each}
            </select>
          {:else}
            <p class="tpl-none">
              No templates yet.
              <button
                class="tpl-inline-link"
                type="button"
                title="Create a thread template in Settings"
                onclick={openTemplateSettings}
              >
                Create one in Settings → Templates.
              </button>
            </p>
          {/if}
        </div>

        <div
          class="field"
          class:template-disabled={fieldDisabledByTemplate('description')}
          title={fieldDisabledByTemplate('description') ? TEMPLATE_FIELD_HINT : undefined}
        >
          <label class="label" for="pc-desc">Description</label>
          <input
            id="pc-desc"
            class="input"
            placeholder="A formation of 13 helicopters was spotted heading East"
            bind:value={description}
            onchange={regenerate}
            disabled={fieldDisabledByTemplate('description')}
          />
        </div>

        <div
          class="field"
          class:template-disabled={fieldDisabledByTemplate('coordinates')}
          title={fieldDisabledByTemplate('coordinates') ? TEMPLATE_FIELD_HINT : undefined}
        >
          <label class="label" for="pc-coords">Coordinates</label>
          <input
            id="pc-coords"
            class="input mono"
            placeholder="10.303315, -66.874095"
            bind:value={coordsText}
            onchange={resolveCoords}
            disabled={fieldDisabledByTemplate('coordinates')}
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

        <div
          class="field"
          class:template-disabled={fieldDisabledByTemplate('place')}
          title={fieldDisabledByTemplate('place') ? TEMPLATE_FIELD_HINT : undefined}
        >
          <label class="label" for="pc-place">
            Place {#if placeLoading}<span class="loading">resolving…</span>{/if}
          </label>
          <input
            id="pc-place"
            class="input"
            placeholder="Village, State, Country"
            bind:value={place}
            onchange={regenerate}
            disabled={fieldDisabledByTemplate('place')}
          />
        </div>

        <div
          class="field"
          class:template-disabled={fieldDisabledByTemplate('mention')}
          title={fieldDisabledByTemplate('mention') ? TEMPLATE_FIELD_HINT : undefined}
        >
          <label class="label" for="pc-mention">Mention</label>
          <input
            id="pc-mention"
            class="input mono"
            placeholder="@GeoConfirmed"
            bind:value={mention}
            onchange={regenerate}
            disabled={fieldDisabledByTemplate('mention')}
          />
        </div>

        <div
          class="field"
          class:template-disabled={fieldDisabledByTemplate('source')}
          title={fieldDisabledByTemplate('source') ? TEMPLATE_FIELD_HINT : undefined}
        >
          <label class="label" for="pc-source">Source</label>
          <input
            id="pc-source"
            class="input"
            placeholder="https://instagram.com/… (original post)"
            bind:value={source}
            onchange={regenerate}
            disabled={fieldDisabledByTemplate('source')}
          />
        </div>

        {#if caseState.current}
          <div class="field">
            <div class="proof-head">
              <span class="label" style="margin:0">Attached proof</span>
              {#if proofPng}
                <button class="btn btn-ghost btn-sm" onclick={() => copyImage(proofHref)} title="Copy this image">
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

        <!-- Post 1: geolocation -->
        <div class="tweet-block card">
          <div class="tweet-head">
            <span class="tweet-num">1</span>
            <span class="label" style="margin:0">Geolocation post</span>
            {#if tweet1Edited}
              <button class="btn btn-ghost btn-sm" onclick={regenerate} title="Rebuild from the fields">
                <Icon name="compass" size={13} /> regenerate
              </button>
            {/if}
            <span class="counter" class:over={tweet1Over} title={targetInfo.limitHelp}>{tweet1Count}/{targetInfo.limitLabel}</span>
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

        <!-- Post 2: media (Video / Image) -->
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
                onclick={() => setMediaType('video')}
              >Video</button>
              <button
                class="btn btn-sm"
                class:btn-primary={mediaType === 'images'}
                class:btn-ghost={mediaType !== 'images'}
                onclick={() => setMediaType('images')}
              >Image</button>
            </div>
            {#if mediaType !== 'none'}
              <span class="counter" class:over={targetLength(tweet2Text()) > targetInfo.limit} title={targetInfo.limitHelp}>{targetLength(tweet2Text())}/{targetInfo.limitLabel}</span>
              <button class="btn btn-ghost btn-sm" onclick={() => copy(tweet2Text())}>
                <Icon name="copy" size={13} /> Copy
              </button>
            {/if}
            <button class="btn btn-ghost btn-sm danger-hover" onclick={() => (mediaEnabled = false)} title="Remove media post">
              <Icon name="x" size={13} />
            </button>
          </div>
          {#if mediaType !== 'none'}
            <textarea
              class="textarea post-text mono"
              dir="auto"
              placeholder="Descriptions, captions, hashtags…"
              bind:value={mediaText}
              rows="3"
            ></textarea>
            <div class="media-attach">
              <button class="btn btn-ghost btn-sm" onclick={() => openPicker()}>
                <Icon name="media" size={13} /> Edit media
              </button>
              {#each mediaPaths as path (path)}
                {@const href = mediaHref(path)}
                {@const kind = mediaKind(path)}
                <span class="attach-chip">
                  {#if href}
                    <a href={href} target="_blank" rel="noreferrer" title={path}>
                      {path.replace(/^media\//, '')}
                    </a>
                  {:else}
                    {path.replace(/^media\//, '')}
                  {/if}
                  <button class="chip-x" onclick={() => clearMedia(path)} title="Remove this media">
                    <Icon name="x" size={11} />
                  </button>
                </span>
                {#if kind === 'image'}
                  <button class="btn btn-ghost btn-sm" onclick={() => copyImage(href)} title="Copy this image">
                    <Icon name="copy" size={13} /> Copy image
                  </button>
                {/if}
              {/each}
              {#if mediaPaths.length}
                <button class="btn btn-ghost btn-sm" onclick={() => downloadPostMedia(mediaPaths)} title="Download this post's media">
                  <Icon name="download" size={13} /> {mediaPaths.length > 1 ? `Download all (${mediaPaths.length})` : 'Download'}
                </button>
              {/if}
            </div>
          {:else}
            <span class="muted">Choose Video or Image to add media.</span>
          {/if}
        </div>
        {/if}

        <!-- Extra context posts (3, 4, …) -->
        {#each extraTweets as tweet, i (tweet.id)}
          <div class="tweet-block card">
            <div class="tweet-head">
              <span class="tweet-num">{i + 3}</span>
              <span class="label" style="margin:0">{tweet.isMediaTweet || tweet.mediaType !== 'none' ? 'Media' : 'Context'}</span>
              {#if tweet.isMediaTweet || tweet.mediaPaths.length || tweet.mediaType !== 'none'}
                <div class="media-tabs">
                  <button class="btn btn-sm" class:btn-primary={tweet.mediaType === 'video'} class:btn-ghost={tweet.mediaType !== 'video'} onclick={() => setExtraMediaType(tweet, 'video')}>Video</button>
                  <button class="btn btn-sm" class:btn-primary={tweet.mediaType === 'images'} class:btn-ghost={tweet.mediaType !== 'images'} onclick={() => setExtraMediaType(tweet, 'images')}>Image</button>
                </div>
              {/if}
              <span class="counter" class:over={targetLength(extraTweetText(tweet, i + 3)) > targetInfo.limit} title={targetInfo.limitHelp}>
                {targetLength(extraTweetText(tweet, i + 3))}/{targetInfo.limitLabel}
              </span>
              <button class="btn btn-ghost btn-sm" onclick={() => copy(extraTweetText(tweet, i + 3))} disabled={!extraTweetText(tweet, i + 3)}>
                <Icon name="copy" size={13} /> Copy
              </button>
              <button class="btn btn-ghost btn-sm danger-hover" onclick={() => removeExtraTweet(tweet.id)} title="Remove post">
                <Icon name="x" size={13} />
              </button>
            </div>
            {#if tweet.isMediaTweet && tweet.mediaType === 'none'}
              <span class="muted">Choose Video or Image to add media.</span>
            {:else}
              <textarea
                class="textarea post-text mono"
                dir="auto"
                placeholder={tweet.mediaType !== 'none' ? 'Descriptions, captions, hashtags…' : 'Additional context…'}
                bind:value={tweet.text}
                rows={tweet.mediaType !== 'none' ? 3 : 4}
              ></textarea>
            {/if}
            {#if tweet.mediaPaths.length || tweet.mediaType !== 'none'}
              <div class="media-attach">
                <button class="btn btn-ghost btn-sm" onclick={() => openPicker(tweet.id)}>
                  <Icon name="media" size={13} /> Edit media
                </button>
                {#each tweet.mediaPaths as path (path)}
                  {@const href = mediaHref(path)}
                  <span class="attach-chip">
                    {#if href}
                      <a href={href} target="_blank" rel="noreferrer" title={path}>
                        {path.replace(/^media\//, '')}
                      </a>
                    {:else}
                      {path.replace(/^media\//, '')}
                    {/if}
                    <button class="chip-x" onclick={() => clearExtraMedia(tweet.id, path)} title="Remove this media">
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                  {#if tweet.mediaType === 'images'}
                    <button class="btn btn-ghost btn-sm" onclick={() => copyImage(href)} title="Copy this image">
                      <Icon name="copy" size={13} /> Copy image
                    </button>
                  {/if}
                {/each}
                {#if tweet.mediaPaths.length}
                  <button class="btn btn-ghost btn-sm" onclick={() => downloadPostMedia(tweet.mediaPaths)} title="Download this post's media">
                    <Icon name="download" size={13} /> {tweet.mediaPaths.length > 1 ? `Download all (${tweet.mediaPaths.length})` : 'Download'}
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/each}

        <div class="thread-actions">
          {#if !mediaEnabled}
            <button class="btn btn-ghost btn-sm" onclick={() => (mediaEnabled = true)}>
              <Icon name="plus" size={13} /> Restore post 2
            </button>
          {/if}
          <button class="btn btn-ghost btn-sm" onclick={addMediaTweet}>
            <Icon name="plus" size={13} /> Add media post
          </button>
          <button class="btn btn-ghost btn-sm" onclick={addExtraTweet}>
            <Icon name="plus" size={13} /> Add context post
          </button>
          <button class="btn btn-ghost btn-sm" onclick={copyAll}>
            <Icon name="copy" size={13} /> Copy all
          </button>
        </div>

      </div>
    </div>
  </div>
</div>

{#if reportModal}
  <Modal title="Save report as note" onclose={() => (reportModal = null)} width="580px">
    <label class="modal-label" for="report-note-title">Title</label>
    <input id="report-note-title" class="input" placeholder="Report title…" bind:value={reportModal.title} />

    <span class="modal-label" style="margin-top:10px">Folder (in My work)</span>
    <FolderSelect bind:value={reportModal.folder} folders={caseState.current?.folders ?? []} emptyLabel="My work (root)" />

    <div class="modal-row">
      <div style="flex:1"></div>
      <button class="btn" onclick={() => (reportModal = null)}>Cancel</button>
      <button class="btn btn-primary" onclick={saveReport} disabled={reportSaving}>
        {reportSaving ? 'Saving…' : 'Save report'}
      </button>
    </div>
  </Modal>
{/if}

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
    detail="Moves the saved draft to the case trash."
    restorable={RESTORABLE}
    confirmLabel="Delete"
    tone="default"
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

{#if overwritePrompt}
  <ConfirmDialog
    title="Overwrite this draft?"
    message={`“${savedTitle(draftEntities, 'draft', overwritePrompt.slug)}” is already saved in this case.`}
    detail="Saving replaces its thread. Rename this draft to keep both."
    confirmLabel="Overwrite"
    tone="danger"
    icon="check"
    onconfirm={performDraftSave}
    oncancel={() => (overwritePrompt = null)}
  />
{/if}

{#if pickerOpen}
  <Modal title={pickerTitle()} width="640px" onclose={() => (pickerOpen = false)}>
    {#if pickerItems().length === 0}
      <p class="picker-empty">No {pickerTweet()?.mediaType === 'video' ? 'videos' : 'images'} in this case.</p>
    {:else}
      {#if pickerItems().length > 6}
        <div class="picker-search">
          <SearchInput
            bind:value={pickerQuery}
            placeholder="Search media…"
            width="100%"
            count={pickerQuery.trim() ? `${visiblePickerItems().length} shown` : null}
          />
        </div>
      {/if}
      {#if visiblePickerItems().length === 0}
        <p class="picker-empty">No media matches “{pickerQuery.trim()}”.</p>
      {/if}
      <div class="picker-grid">
        {#each (caseState.current ? visiblePickerItems() : []) as item (item.path)}
          {@const targetTweet = mediaPickerTarget === null
            ? null
            : extraTweets.find((tweet) => tweet.id === mediaPickerTarget)}
          {@const selected = targetTweet ? targetTweet.mediaPaths.includes(item.path) : mediaPaths.includes(item.path)}
          <button
            class="picker-item"
            class:selected={selected}
            onclick={() => pickMedia(item)}
            title={item.path}
          >
            <div class="picker-thumb">
              {#if item.thumbnail}
                <img src={`/files/${caseState.current.id}/${item.thumbnail}`} alt={item.path} />
              {:else}
                <Icon name={item.kind === 'video' ? 'video' : item.kind === 'audio' ? 'audio' : 'file'} size={24} />
              {/if}
              {#if item.kind === 'video'}<span class="kind-badge"><Icon name="video" size={11} /></span>{/if}
              {#if selected}<span class="select-check"><Icon name="check" size={13} /></span>{/if}
            </div>
            <span class="picker-name">{(item.label || item.path).replace(/^media\//, '')}</span>
          </button>
        {/each}
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary btn-sm" onclick={() => (pickerOpen = false)}>Done</button>
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
  .target-tabs {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
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

  .style-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .style-head .label { margin: 0; }
  .tpl-settings-link {
    margin-left: auto;
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
  }
  .tpl-settings-link:hover { color: var(--text-2); }
  .tpl-inline-link {
    color: var(--text-3);
    font: inherit;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
  }
  .tpl-inline-link:hover { color: var(--text-2); }

  .tpl-loaded {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 9px;
    border: 1px solid color-mix(in srgb, var(--ok) 45%, var(--border));
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--ok) 10%, transparent);
  }
  .tpl-loaded-name {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tpl-loaded-name :global(svg) { color: var(--ok); flex-shrink: 0; }
  .tpl-remove {
    margin-left: auto;
    display: inline-flex;
    padding: 2px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }
  .tpl-remove:hover { color: var(--text-1); background: var(--bg-2); }
  .tpl-none {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-3);
    line-height: 1.4;
  }
  .field.template-disabled {
    opacity: 0.48;
    cursor: not-allowed;
  }
  .field.template-disabled .input { pointer-events: none; }
  .field.template-disabled:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
    border-radius: var(--r-sm);
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
  .picker-search {
    margin-bottom: 12px;
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
  .picker-item.selected .picker-thumb {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
  .picker-item:disabled { cursor: not-allowed; opacity: 0.38; }
  .picker-item:disabled .picker-thumb { border-color: var(--border); }
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
  .select-check {
    position: absolute;
    top: 4px;
    left: 4px;
    display: inline-flex;
    padding: 3px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-text);
  }
  .picker-name {
    font-size: var(--fs-xs);
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .modal-actions { display: flex; justify-content: flex-end; margin-top: 14px; }
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
