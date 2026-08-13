<script>
  import { api } from '../lib/api.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { lookupEntity } from '../lib/catalog.js';
  import { buildMediaQuery } from '../lib/mediaQuery.js';
  import { createPagedList } from '../lib/pagedList.svelte.js';
  import { pollWhile } from '../lib/poll.js';
  import { caseState, uiState, ensureCase, reloadCase, toast } from '../lib/state.svelte.js';
  import {
    hasMediaForFilters,
    isBroughtIn,
    isGenericImage,
    isMadeHere,
    isSatelliteMedia,
    mediaDisplayKind,
    mediaPoint,
    visibleMedia,
    SORTS,
  } from '../lib/mediaFilter.js';
  import { listenForPaste, pasteImage, resolvePaste } from '../lib/clipboardPaste.js';
  import { gotoPoint } from '../lib/navigate.js';
  import { revealMediaFolder } from '../lib/reveal.js';
  import { deletedToast, RESTORABLE } from '../lib/trash.js';
  import Icon from '../components/Icon.svelte';
  import PasteDialog from '../components/PasteDialog.svelte';
  import SearchInput from '../components/SearchInput.svelte';
  import Modal from '../components/Modal.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import EntityDetails from '../components/EntityDetails.svelte';
  import ExportFolderPicker from '../components/ExportFolderPicker.svelte';
  import { destinationLabel, readDestinations } from '../lib/exportDest.js';

  const KIND_ICONS = { image: 'image', satellite: 'satellite', video: 'video', audio: 'audio', file: 'file' };

  // Bounded loading: a case that fits one page (the common case, incl. a 3–4
  // file case) is filtered/sorted entirely client-side below; a large case
  // pages in and searches server-side. The unbounded `/media` list still backs
  // the pickers/derivation elsewhere — this browse view uses `/media/page`.
  const PAGE = 200;
  const pl = createPagedList({
    fetchPage: ({ query, cursor }) =>
      api.get(
        buildMediaQuery(caseState.current?.id, {
          q: query,
          category: catFilter,
          folder: folderFilter,
          gps: gpsOnly,
          collectedOnly,
          sort,
          direction: sortDirection,
          limit: PAGE,
          cursor,
        })
      ),
  });
  const items = $derived(pl.items);
  let loadedFor = null; // non-reactive: only the load effect reads/writes it
  let url = $state('');
  let picker = $state(null); // multi-item picker: {url, items: [{index, title, thumbnail, kind, selected}]}
  let dragOver = $state(false);
  let jobs = $state([]); // active download jobs: {id, url, label, progress, index, title}
  let fileInput;
  let cookieFileInput = $state();
  // cookie affordance, shown only when a download hits a login wall:
  // {url, index, title, platform, guidance, browser, busy}
  let authPrompt = $state(null);

  // browsers yt-dlp can read a session from; the Chromium subset can't be read
  // on Windows (locked/app-bound store) so we steer those to the file fallback
  const COOKIE_BROWSERS = [
    { id: 'firefox', label: 'Firefox' },
    { id: 'chrome', label: 'Chrome' },
    { id: 'edge', label: 'Edge' },
    { id: 'brave', label: 'Brave' },
    { id: 'chromium', label: 'Chromium' },
    { id: 'opera', label: 'Opera' },
    { id: 'safari', label: 'Safari' },
    { id: 'vivaldi', label: 'Vivaldi' },
  ];
  const CHROMIUM_BROWSERS = new Set(['chrome', 'chromium', 'edge', 'brave', 'vivaldi', 'opera']);

  // --- category facets (auto-derived from kind + source) ---
  // Overlapping filters (a downloaded video matches both Videos and Downloads);
  // clicking one narrows the grid to that facet. Order matches the sidebar bar.
  const CATEGORIES = [
    { key: 'image', label: 'Images', icon: 'image', match: isGenericImage },
    { key: 'video', label: 'Videos', icon: 'video', match: (i) => i.kind === 'video' },
    { key: 'collage', label: 'Collages', icon: 'layers', match: (i) => i.source?.op === 'collage' },
    { key: 'satellite', label: 'Satellite', icon: 'satellite', match: isSatelliteMedia },
    { key: 'upload', label: 'Imports', icon: 'upload', match: isBroughtIn },
    { key: 'download', label: 'Downloads', icon: 'download', match: (i) => i.source?.type === 'download' },
    { key: 'other', label: 'Other files', icon: 'file', match: (i) => i.kind !== 'image' && i.kind !== 'video' },
  ];

  let catFilter = $state(null); // null = All types

  const activeCats = $derived(
    CATEGORIES.map((c) => ({
      ...c,
      count: pl.facets?.category_counts?.[c.key] ?? items.filter(c.match).length,
    })).filter((c) => c.count > 0)
  );
  const catMatch = $derived(CATEGORIES.find((c) => c.key === catFilter)?.match ?? null);

  // --- folder filter (user-defined folders) ---
  let folderFilter = $state(null); // null = All

  // --- position filter (independent of type and folder) ---
  // The one filter a geolocation case asks for constantly: which files told us
  // where they were taken. Offered only when the case holds some, so it never
  // adds a dead control to a case of screenshots.
  let gpsOnly = $state(false);
  const gpsCount = $derived(
    pl.facets?.gps_count ?? items.filter((i) => mediaPoint(i)).length
  );

  // --- what the case made, out of the way (independent of type and folder) ---
  // A geolocation case ends up with 150 extracted frames beside 50 collected
  // files, and the question "what did we actually collect" has no answer in a
  // chooser: the chips are single-select and say "show me only X". This is the
  // other axis, so it is a switch. On by default — the library opens on what the
  // case collected, and the switch is how the working files come back; it says
  // how many they are rather than leaving them unannounced.
  let collectedOnly = $state(true);
  const madeHereCount = $derived(
    pl.facets?.made_here_count ?? items.filter(isMadeHere).length
  );

  // --- free-text search + sort ---
  let query = $state('');
  let sort = $state('name');
  let sortDirection = $state('asc');
  let headerSort = $state(null);
  const LIST_SORTS = [
    { id: 'name', label: 'Name' },
    { id: 'type', label: 'Type' },
    { id: 'size', label: 'Size' },
    { id: 'folder', label: 'Folder' },
    { id: 'added', label: 'Added' },
  ];
  const browseFiltersActive = $derived(
    query.length > 0 || catFilter !== null || folderFilter !== null || gpsOnly || !collectedOnly
  );
  const filtersActive = $derived(
    browseFiltersActive || sort !== 'name' || sortDirection !== 'asc'
  );
  // Also shown for a case whose files are all working ones: the grid is empty
  // because the switch is on, and the switch is in this bar.
  const showBrowseBar = $derived(items.length > 0 || browseFiltersActive || madeHereCount > 0);

  const folders = $derived(
    [
      ...new Set([
        ...Object.keys(pl.facets?.folder_counts ?? {}).filter(Boolean),
        ...items.filter((i) => i.folder).map((i) => i.folder),
        ...(folderFilter ? [folderFilter] : []),
      ]),
    ].sort()
  );
  // Empty when no case is open — the grid cards build file URLs from
  // `caseState.current.id`, so a stale render during case-close (current is
  // briefly null before `items` clears) must not reach them. See visibleMedia.
  const filteredItems = $derived(
    visibleMedia(items, {
      hasCase: !!caseState.current,
      catMatch,
      folderFilter,
      gpsOnly,
      collectedOnly,
      query,
      sort,
      direction: sortDirection,
    })
  );

  function reloadIfServerBacked() {
    if (pl.serverMode || pl.loading) pl.reload();
  }

  function onSortSelect(event) {
    sort = event.currentTarget.value;
    sortDirection = sort === 'newest' || sort === 'size' ? 'desc' : 'asc';
    headerSort = null;
    reloadIfServerBacked();
  }

  function setHeaderSort(next) {
    if (headerSort === next) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      headerSort = next;
      sort = next === 'added' ? 'newest' : next;
      sortDirection = next === 'added' ? 'desc' : 'asc';
    }
    reloadIfServerBacked();
  }

  function onFolderSelect(event) {
    const nextFolder = event.currentTarget.value || null;
    const category = CATEGORIES.find((c) => c.key === catFilter);
    const resetCategory =
      nextFolder &&
      catFilter &&
      !hasMediaForFilters(items, { catMatch: category?.match, folderFilter: nextFolder });
    folderFilter = nextFolder;
    if (resetCategory) catFilter = null;
    reloadIfServerBacked();
  }

  function onCategorySelect(event) {
    const nextCategory = event.currentTarget.value || null;
    const category = CATEGORIES.find((c) => c.key === nextCategory);
    const resetFolder =
      nextCategory &&
      folderFilter &&
      !hasMediaForFilters(items, { catMatch: category?.match, folderFilter });
    catFilter = nextCategory;
    if (resetFolder) {
      folderFilter = null;
    }
    reloadIfServerBacked();
  }

  function toggleGpsOnly() {
    gpsOnly = !gpsOnly;
    reloadIfServerBacked();
  }

  function toggleCollectedOnly() {
    collectedOnly = !collectedOnly;
    // Always refetch, unlike the other filters: this one is on at load, so the
    // page in memory is the collected subset and no in-memory pass can put the
    // working files back. Every other control only ever narrows what was loaded.
    if (caseState.current) pl.reload();
  }

  /** The stated position, spelled out. Lives in the tooltip rather than in the
   *  row: a filename is what the analyst reads a list by. */
  function pointLabel(item) {
    const point = mediaPoint(item);
    return point ? `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}` : '';
  }

  // The map is where a claimed position gets judged, and enrichment's proposed
  // place is already waiting there as a mark.
  function showOnMap(item, event) {
    event?.stopPropagation(); // the thumbnail behind this opens the lightbox
    const point = mediaPoint(item);
    if (point) gotoPoint(point.lat, point.lon);
  }

  function resetFilters() {
    query = '';
    catFilter = null;
    folderFilter = null;
    gpsOnly = false;
    collectedOnly = true;
    sort = 'name';
    sortDirection = 'asc';
    headerSort = null;
    reloadIfServerBacked();
  }

  // The current card layout is the large view. Small is a denser grid and List
  // uses the Files-style details table while the grids keep their cards.
  let view = $state('large');
  const VIEWS = [
    { id: 'small', label: 'Small', icon: 'grid' },
    { id: 'large', label: 'Large', icon: 'image' },
    { id: 'list', label: 'List', icon: 'note' },
  ];

  // --- details modal (shared EntityDetails, keyed by the file's entity id) ---
  let infoEntityId = $state(null);
  // The panel's fields wait for Save while its connections file themselves, so
  // Escape and the backdrop ask before throwing an edit away.
  let infoDirty = $state(false);
  let infoDiscarding = $state(false);

  function closeInfo() {
    if (infoDirty) infoDiscarding = true;
    else infoEntityId = null;
  }

  let infoItem = $state(null); // the media row behind the details modal, for Export
  // Where a media copy lands, app-wide and remembered. Empty = the case folder.
  let exportDir = $state('');
  let exportPicker = $state(false);
  let exportBusy = $state(false);

  // --- lightbox (←/→ flips through the filtered images) ---
  let lightboxItem = $state(null);
  const lightboxImages = $derived(filteredItems.filter((i) => i.kind === 'image'));

  function lightboxStep(delta) {
    if (!lightboxItem || !lightboxImages.length) return;
    const idx = lightboxImages.findIndex((i) => i.path === lightboxItem.path);
    const next = ((idx < 0 ? 0 : idx) + delta + lightboxImages.length) % lightboxImages.length;
    lightboxItem = lightboxImages[next];
  }

  function onLightboxKey(e) {
    if (!lightboxItem || uiState.tool !== 'media') return;
    if (e.key === 'Escape') lightboxItem = null;
    else if (e.key === 'ArrowLeft') lightboxStep(-1);
    else if (e.key === 'ArrowRight') lightboxStep(1);
  }

  // --- focus/highlight (a media clicked from the case sidebar) ---
  let focusedPath = $state(null);
  let focusScrolledFor = null;
  let focusTimer;

  // --- thumbnails still generating in the background ---
  // A broken <img> (a thumbnail evicted by the cache budget between list and
  // render) falls back to the type icon, reported once by dropping the path in
  // here — it does not retry on every render.
  let brokenThumbs = $state(new Set());
  const mediaKey = (item) => `${caseState.current?.id ?? ''}/${item.path}`;
  function markBrokenThumb(event) {
    const key = event.currentTarget.dataset.mediaKey;
    if (key) brokenThumbs = new Set(brokenThumbs).add(key);
  }
  const thumbsPending = $derived(
    (pl.facets?.thumbnail_pending ?? 0) > 0 ||
      items.some((i) => i.thumb_state === 'queued' || i.thumb_state === 'running')
  );
  const enrichmentPending = $derived(
    items.some((i) => i.enrich_state === 'queued' || i.enrich_state === 'running')
  );

  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev; // also refetch when the case is reloaded elsewhere (e.g. sidebar edit)
    if (id !== loadedFor) {
      loadedFor = id;
      pl.clear(); // drop the old case's page before the new one loads
      // Drop broken-thumb flags too: the switch briefly renders the new case
      // id against the old case's items, 404-ing each <img> and marking its
      // path broken. Left to accumulate, those flags hide the *other* case's
      // ready thumbnails until a page reload (the reported "must refresh" bug).
      brokenThumbs = new Set();
    }
    if (id) pl.reload();
  });

  // Drive the paged list from the search box: in a small (single-page) case
  // this just records the term and `visibleMedia` filters in memory with no
  // network; in a large case it debounces a server search.
  $effect(() => {
    pl.setQuery(query);
  });

  // Pick up a "focus this media" handoff from the sidebar: clear filters that
  // might hide it, flag it for the highlight ring, then let it fade on its own.
  $effect(() => {
    if (!uiState.focusMedia) return;
    catFilter = null;
    folderFilter = null;
    focusedPath = uiState.focusMedia;
    uiState.focusMedia = null;
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => (focusedPath = null), 3000);
  });

  // Scroll the focused card into view once it's actually in the rendered grid
  // (items may still be loading when the handoff arrives).
  $effect(() => {
    const p = focusedPath;
    if (!p) {
      focusScrolledFor = null;
      return;
    }
    if (focusScrolledFor === p || !filteredItems.some((i) => i.path === p)) return;
    focusScrolledFor = p;
    requestAnimationFrame(() => {
      document
        .querySelector(`.media-card[data-path="${CSS.escape(p)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  async function refresh() {
    if (caseState.current?.id) await pl.reload();
  }

  // While the single worker is still generating thumbnails (video frames, or a
  // regenerate), re-list to pick up readiness — only while the tool is visible,
  // and the poll stops on its own once nothing is pending. Uses a repeating
  // poll, not a one-shot timer: this effect only re-runs when `thumbsPending`
  // flips, so a `setTimeout` here would fire once and leave a slow thumbnail
  // stuck until a page reload (e.g. after a case switch reloads pending items).
  $effect(() => {
    if (!thumbsPending || uiState.tool !== 'media' || !caseState.current) return;
    return pollWhile(() => thumbsPending, () => refresh(), 1500);
  });

  // Enrichment changes both the media sidecar and the Suggestions graph. Poll
  // both views until the worker settles, but only while Media is visible.
  $effect(() => {
    if (!enrichmentPending || uiState.tool !== 'media' || !caseState.current) return;
    return pollWhile(
      () => enrichmentPending,
      () => Promise.all([refresh(), reloadCase()]),
      1500
    );
  });

  // Queue (re)generation: a single failed thumbnail (path given) or every
  // missing/failed one across the case. The worker drains the queue; the poll
  // above reflects each result as it lands.
  async function regenerateThumbs(path = null) {
    const id = caseState.current?.id;
    if (!id) return;
    try {
      const { queued } = await api.post(
        `/api/cases/${id}/media/thumbnails/regenerate`,
        path ? { path } : {}
      );
      if (path) {
        const next = new Set(brokenThumbs);
        next.delete(path);
        brokenThumbs = next;
      }
      await refresh();
      if (!path) {
        toast(
          queued ? `Regenerating ${queued} thumbnail${queued > 1 ? 's' : ''}` : 'Thumbnails are up to date',
          queued ? 'info' : 'ok'
        );
      }
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  // Queue enrichment for media imported by an older version. The worker drains
  // the queue; Details and Suggestions update as each image lands.
  async function enrichMedia() {
    const id = caseState.current?.id;
    if (!id) return;
    try {
      const { queued } = await api.post(`/api/cases/${id}/media/enrich`, {});
      await refresh();
      toast(
        queued ? `Enriching ${queued} file${queued > 1 ? 's' : ''}` : 'Nothing left to enrich',
        queued ? 'info' : 'ok'
      );
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  /** Hand a file the app cannot display back to the desktop, in its own folder.
   *  A download would put a second copy in Downloads and invite editing the one
   *  the case does not know about. */
  async function revealFolder(item) {
    try {
      await revealMediaFolder(caseState.current.id, item.path);
    } catch (e) {
      toast(e.message, 'warn', 5000);
    }
  }

  async function importFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const c = await ensureCase();
    let added = 0;
    let dups = 0;
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await api.post(`/api/cases/${c.id}/media/upload`, form);
        res.duplicate ? dups++ : added++;
      } catch (e) {
        toast(`${file.name}: ${e.message}`, 'danger');
      }
    }
    await Promise.all([refresh(), reloadCase()]);
    if (added) toast(`${added} file${added > 1 ? 's' : ''} added to the case`, 'ok');
    if (dups) toast(`${dups} duplicate${dups > 1 ? 's' : ''} skipped (same SHA-256)`, 'warn');
  }

  async function download() {
    const target = url.trim();
    if (!target) return;
    url = '';
    startDownload(target);
  }

  async function startDownload(target, index = null, title = null, useCookies = false) {
    try {
      const c = await ensureCase();
      const { job_id } = await api.post(`/api/cases/${c.id}/media/download`, {
        url: target,
        index,
        title,
        use_cookies: useCookies,
      });
      jobs.push({ id: job_id, url: target, label: title || target, progress: {}, index, title });
      poll(job_id);
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  // A gated link asked for a login. Retry after pointing the downloader at a
  // browser session (saved as the app-wide source) or an exported cookies.txt.
  async function retryWithBrowser() {
    authPrompt.busy = true;
    try {
      await api.put('/api/settings/prefs', {
        download_cookies: { source: 'browser', browser: authPrompt.browser },
      });
      const { url, index, title } = authPrompt;
      authPrompt = null;
      startDownload(url, index, title, true);
    } catch (e) {
      toast(e.message, 'danger');
      authPrompt.busy = false;
    }
  }

  async function retryWithCookieFile(file) {
    if (!file) return;
    authPrompt.busy = true;
    try {
      const form = new FormData();
      form.append('file', file);
      await api.post('/api/settings/cookies-file', form);
      const { url, index, title } = authPrompt;
      authPrompt = null;
      startDownload(url, index, title, true);
    } catch (e) {
      toast(e.message, 'danger');
      authPrompt.busy = false;
    }
  }

  function selectAllPicker(value) {
    picker.items.forEach((i) => (i.selected = value));
  }

  function confirmPicker() {
    const chosen = picker.items.filter((i) => i.selected);
    for (const item of chosen) {
      startDownload(picker.url, item.index, item.title.trim() || undefined);
    }
    picker = null;
  }

  async function poll(jobId) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    try {
      const status = await api.get(`/api/jobs/${jobId}`);
      job.progress = status.progress ?? {};
      if (status.status === 'running') {
        setTimeout(() => poll(jobId), 700);
        return;
      }
      jobs = jobs.filter((j) => j.id !== jobId);
      if (status.status === 'done' && status.result?.needs_auth) {
        // login wall — offer a cookie source and retry, nothing downloaded yet
        authPrompt = {
          url: job.url,
          index: job.index ?? null,
          title: job.title ?? null,
          platform: status.result.platform ?? '',
          guidance: status.result.guidance ?? '',
          browser: 'firefox',
          busy: false,
        };
      } else if (status.status === 'done' && status.result?.multi) {
        // several attachments — nothing was downloaded yet, let the analyst pick
        picker = { url: job.url, items: status.result.items.map((i) => ({ ...i, selected: true })) };
      } else if (status.status === 'done') {
        toast(
          status.result?.duplicate
            ? 'Already in the case (same SHA-256)'
            : `Downloaded: ${status.result?.item?.filename}`,
          status.result?.duplicate ? 'warn' : 'ok'
        );
        await Promise.all([refresh(), reloadCase()]);
      } else {
        toast(`Download failed: ${status.error}`, 'danger', 6000);
      }
    } catch (e) {
      jobs = jobs.filter((j) => j.id !== jobId);
      toast(e.message, 'danger');
    }
  }

  // Deleting media moves the file to the case trash.
  let deleteTarget = $state(null);
  let deleteBusy = $state(false);

  async function confirmDelete() {
    if (!deleteTarget || deleteBusy) return;
    deleteBusy = true;
    try {
      const caseId = caseState.current.id;
      const result = await api.del(
        `/api/cases/${caseState.current.id}/media?path=${encodeURIComponent(deleteTarget.path)}`
      );
      await Promise.all([refresh(), reloadCase()]);
      deletedToast(caseId, result, deleteTarget.title ?? deleteTarget.filename);
      deleteTarget = null;
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      deleteBusy = false;
    }
  }

  function sendToComposer(item) {
    if (!uiState.composeQueue.includes(item.path)) {
      uiState.composeQueue.push(item.path);
    }
    uiState.tool = 'proof';
  }

  function inspect(item) {
    uiState.inspectPath = item.path;
    uiState.tool = 'inspect';
  }

  function fmtSize(bytes) {
    if (bytes == null) return '—';
    if (bytes >= 1 << 30) return (bytes / (1 << 30)).toFixed(1) + ' GB';
    if (bytes >= 1 << 20) return (bytes / (1 << 20)).toFixed(1) + ' MB';
    if (bytes >= 1 << 10) return (bytes / (1 << 10)).toFixed(0) + ' KB';
    return bytes + ' B';
  }

  function fmtAdded(item) {
    const date = new Date(item.added_at);
    if (Number.isNaN(date.getTime())) return '—';
    const part = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())} ${part(date.getHours())}:${part(date.getMinutes())}`;
  }

  function onDrop(e) {
    e.preventDefault();
    dragOver = false;
    importFiles(e.dataTransfer.files);
  }

  // ── paste ────────────────────────────────────────────────────────────────
  // A screenshot taken with the system tool is only in the clipboard: there is no
  // file to drop, so without this it has to be saved to disk first. A link is
  // refused here and says so — this grid takes files, and a URL is the download
  // field's business.
  let pasted = $state(null);
  let pasteBusy = $state(false);
  $effect(() => {
    if (uiState.tool !== 'media') return;
    return listenForPaste((payload) => {
      pasted ??= resolvePaste('media', payload);
    });
  });

  async function confirmPaste(resolved) {
    if (pasteBusy) return;
    pasteBusy = true;
    try {
      const c = await ensureCase();
      const result = await pasteImage(c.id, {
        file: resolved.payload.file,
        title: resolved.values.title,
        sourceUrl: resolved.values.source,
      });
      pasted = null;
      await Promise.all([refresh(), reloadCase()]);
      // The same bytes twice is not an error and not a second item: the case keeps
      // the one it has, and saying so is what stops the analyst pasting again.
      if (result.duplicate) toast('Already in the case (same SHA-256)', 'warn');
      else {
        toast('Image added to the case', 'ok');
        uiState.focusMedia = result.item.path;
      }
    } catch (e) {
      toast(`Could not add the image: ${e.message}`, 'danger');
    } finally {
      pasteBusy = false;
    }
  }

  // Open the shared details editor (same body as the case sidebar) for this
  // file's case entity — full provenance, derivation chain, title/notes/folder.
  async function openInfo(item) {
    const ent = await lookupEntity(caseState.current?.id, 'path', item.path);
    if (ent) {
      infoEntityId = ent.id;
      infoItem = item;
      readDestinations()
        .then((dirs) => (exportDir = dirs.media))
        .catch(() => {});
    } else toast('This file has no case entity yet', 'warn');
  }

  /**
   * Copy this file out to the media export folder.
   *
   * A copy: the case keeps the original with its hash and its provenance, and
   * the analyst gets the file where they actually work with it.
   */
  async function exportMedia() {
    const item = infoItem;
    if (!item || exportBusy) return;
    exportBusy = true;
    try {
      const result = await api.post(`/api/cases/${caseState.current.id}/media/export`, {
        path: item.path,
      });
      toast(`${result.file} copied to ${destinationLabel(result.folder)}`, 'ok', 5200, {
        label: 'Show',
        onClick: () =>
          api
            .post(`/api/cases/${caseState.current.id}/media/export/reveal`)
            .catch((error) => toast(error.message, 'warn')),
      });
    } catch (error) {
      toast(`Export failed: ${error.message}`, 'danger');
    } finally {
      exportBusy = false;
    }
  }

  async function openMediaExportPicker() {
    try {
      exportDir = (await readDestinations()).media;
    } catch {
      // The picker still has its case-folder default if Settings cannot load.
    }
    exportPicker = true;
  }
</script>

<div
  class="tool"
  role="region"
  aria-label="Media Library"
  ondragover={(e) => {
    e.preventDefault();
    dragOver = true;
  }}
  ondragleave={(e) => {
    if (e.currentTarget === e.target) dragOver = false;
  }}
  ondrop={onDrop}
>
  <div class="tool-header">
    <h2>Media Library</h2>
    <div class="spacer"></div>
    <form
      class="dl-form"
      onsubmit={(e) => {
        e.preventDefault();
        download();
      }}
    >
      <input
        class="input"
        placeholder="Paste a link (X, Telegram, YouTube…)"
        bind:value={url}
      />
      <button type="submit" class="btn btn-primary" disabled={!url.trim()}>
        <Icon name="download" size={15} /> Download
      </button>
    </form>
    <button class="btn" onclick={() => fileInput.click()}>
      <Icon name="upload" size={15} /> Import
    </button>
    <button
      class="btn"
      onclick={() => regenerateThumbs()}
      title="Regenerate missing or failed thumbnails"
      disabled={!items.length}
    >
      <Icon name="reset" size={15} /> Thumbnails
    </button>
    <button
      class="btn"
      onclick={enrichMedia}
      title="Read image EXIF, hashes and video metadata locally"
      disabled={!items.length}
    >
      <Icon name="search" size={15} /> Enrich
    </button>
    <input
      type="file"
      multiple
      hidden
      bind:this={fileInput}
      onchange={(e) => {
        importFiles(e.target.files);
        e.target.value = '';
      }}
    />
  </div>

  <!-- search + sort + category + folder filter bar -->
  {#if showBrowseBar}
    <div class="folder-bar">
      <SearchInput
        bind:value={query}
        placeholder="Search name, source…"
        count={query ? `${filteredItems.length} shown` : null}
      />
      <select class="select sort-select" value={sort} onchange={onSortSelect} title="Sort order">
        {#each SORTS as s (s.id)}
          <option value={s.id}>{s.label}</option>
        {/each}
      </select>
      <div class="view-switch" role="group" aria-label="View">
        {#each VIEWS as v (v.id)}
          <button
            class="view-btn"
            class:active={view === v.id}
            title={`${v.label} view`}
            aria-pressed={view === v.id}
            onclick={() => (view = v.id)}
          >
            <Icon name={v.icon} size={14} /> {v.label}
          </button>
        {/each}
      </div>
      <span class="bar-sep"></span>
      <select
        class="select category-select"
        value={catFilter ?? ''}
        onchange={onCategorySelect}
        title="Filter by type or source"
      >
        <option value="">All types</option>
        {#each activeCats as c (c.key)}
          <option value={c.key}>{c.label} ({c.count})</option>
        {/each}
      </select>

      {#if gpsCount || gpsOnly}
        <button
          class="btn btn-sm gps-filter"
          class:on={gpsOnly}
          type="button"
          aria-pressed={gpsOnly}
          title={`Show only the ${gpsCount} file${gpsCount > 1 ? 's' : ''} whose own metadata states a position`}
          onclick={toggleGpsOnly}
        >
          <Icon name="pin" size={13} /> GPS
        </button>
      {/if}

      <!-- Offered only where the case made something, so a case of imports never
           carries a dead control. Resting, it says how many files it is holding
           back rather than letting them stay out of the grid quietly. -->
      {#if madeHereCount || !collectedOnly}
        <button
          class="btn btn-sm gps-filter"
          class:on={!collectedOnly}
          type="button"
          aria-pressed={!collectedOnly}
          title={collectedOnly
            ? `Show the ${madeHereCount} file${madeHereCount > 1 ? 's' : ''} the case made from material it already holds`
            : 'Show only what the case collected'}
          onclick={toggleCollectedOnly}
        >
          <Icon name="layers" size={13} />
          {collectedOnly
            ? `Show ${madeHereCount} working file${madeHereCount > 1 ? 's' : ''}`
            : 'Hide working files'}
        </button>
      {/if}

      <!-- user-defined folders (independent facet) -->
      {#if folders.length}
        <span class="bar-sep"></span>
        <select
          class="select folder-select"
          value={folderFilter ?? ''}
          onchange={onFolderSelect}
          title="Filter by folder"
        >
          <option value="">All folders</option>
          {#each folders as f (f)}
            <option value={f}>{f}</option>
          {/each}
        </select>
      {/if}
      <button
        class="btn btn-ghost btn-sm reset-filters"
        type="button"
        title="Reset filters"
        disabled={!filtersActive}
        onclick={resetFilters}
      >
        <Icon name="reset" size={13} /> Reset filters
      </button>
    </div>
  {/if}

  <div class="tool-body">
    {#each jobs as job (job.id)}
      <div class="job card">
        <Icon name="download" size={15} />
        <span class="job-url mono" title={job.url}>{job.label ?? job.url}</span>
        <div class="bar">
          <div
            class="fill"
            class:indeterminate={job.progress.percent == null}
            style:width={job.progress.percent != null ? job.progress.percent + '%' : '40%'}
          ></div>
        </div>
        <span class="job-meta">
          {#if job.progress.stage === 'processing'}processing…{:else if job.progress.percent != null}{job.progress.percent}%
            {job.progress.speed ?? ''}{:else}starting…{/if}
        </span>
      </div>
    {/each}

    {#if !items.length && !jobs.length && !browseFiltersActive && madeHereCount}
      <!-- A case of nothing but frames and collages opens on an empty grid. It
           holds files, so say which ones rather than offering to import. -->
      <div class="empty" style="height: 100%">
        <div class="empty-icon"><Icon name="layers" size={38} /></div>
        <h3>Nothing collected yet</h3>
        <p>
          {madeHereCount} working file{madeHereCount > 1 ? 's' : ''}, held back by the switch above.
        </p>
      </div>
    {:else if !items.length && !jobs.length && !browseFiltersActive}
      <div class="empty" style="height: 100%">
        <div class="empty-icon"><Icon name="media" size={42} /></div>
        <h3>No media yet</h3>
        <p>Drop files here, or paste a URL above.</p>
      </div>
    {:else if filteredItems.length === 0}
      <div class="empty" style="height: 100%">
        <div class="empty-icon"><Icon name="folder" size={38} /></div>
        <h3>Nothing here</h3>
        <p>No media matches this filter.</p>
      </div>
    {:else}
      {#if view === 'list'}
        <div class="media-list" role="table" aria-label="Media files">
          <div class="media-row media-head" role="row">
            <span aria-hidden="true"></span>
            {#each LIST_SORTS as column (column.id)}
              <button
                class={`media-head-button media-col-${column.id}`}
                class:active={headerSort === column.id}
                type="button"
                title={`Sort by ${column.label}`}
                aria-label={`Sort by ${column.label}${headerSort === column.id ? `, ${sortDirection === 'asc' ? 'ascending' : 'descending'}` : ''}`}
                onclick={() => setHeaderSort(column.id)}
              >
                {column.label}
                {#if headerSort === column.id}
                  <Icon name={sortDirection === 'asc' ? 'chevronUp' : 'chevronDown'} size={12} />
                {/if}
              </button>
            {/each}
            <span class="media-col-actions" aria-label="Actions"></span>
          </div>
          {#each filteredItems as item (mediaKey(item))}
            <div class="media-row" class:focused={item.path === focusedPath} data-path={item.path} role="row">
              <!-- The preview remains an image-only control; the row itself is not a card. -->
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <div
                class="list-preview"
                class:clickable={item.kind === 'image'}
                onclick={() => item.kind === 'image' && (lightboxItem = item)}
                role={item.kind === 'image' ? 'button' : undefined}
                tabindex={item.kind === 'image' ? 0 : undefined}
                onkeydown={(e) => e.key === 'Enter' && item.kind === 'image' && (lightboxItem = item)}
                aria-label={item.kind === 'image' ? `Preview ${item.filename}` : undefined}
              >
                {#if item.thumbnail && item.thumb_state === 'ready' && !brokenThumbs.has(mediaKey(item))}
                  <img
                    src={fileUrl(caseState.current.id, item.thumbnail)}
                    data-media-key={mediaKey(item)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onerror={markBrokenThumb}
                  />
                {:else if item.thumb_state === 'failed'}
                  <button
                    class="thumb-status thumb-retry"
                    title="Retry thumbnail"
                    onclick={() => regenerateThumbs(item.path)}
                  >
                    <Icon name="reset" size={16} />
                  </button>
                {:else if item.thumb_state === 'queued' || item.thumb_state === 'running'}
                  <Icon name="clock" size={16} />
                {:else}
                  <Icon name={KIND_ICONS[mediaDisplayKind(item)] ?? 'file'} size={18} />
                {/if}
              </div>
              <span class="media-col-name" title={item.filename}>
                <span class="list-name">{item.title ?? item.filename}</span>
              </span>
              <span class="media-col-type">{mediaDisplayKind(item)}</span>
              <span class="media-col-size">{fmtSize(item.size)}</span>
              <span class="media-col-folder" title={item.folder ?? ''}>{item.folder || '—'}</span>
              <span class="media-col-added">{fmtAdded(item)}</span>
              <div class="media-col-actions actions" aria-label={`Actions for ${item.title ?? item.filename}`}>
                {#if mediaPoint(item)}
                  <button
                    class="btn btn-ghost btn-sm"
                    title={`Metadata says ${pointLabel(item)} — show it on the map`}
                    onclick={() => showOnMap(item)}
                  >
                    <Icon name="pin" size={14} />
                  </button>
                {/if}
                <button class="btn btn-ghost btn-sm" title="Info / Edit notes" onclick={() => openInfo(item)}>
                  <Icon name="note" size={14} />
                </button>
                {#if item.kind === 'file'}
                  <button
                    class="btn btn-ghost btn-sm"
                    title="Open the folder this file is in"
                    onclick={() => revealFolder(item)}
                  >
                    <Icon name="folderOpen" size={14} />
                  </button>
                {:else}
                  <a
                    class="btn btn-ghost btn-sm"
                    href={fileUrl(caseState.current.id, item.path)}
                    target="_blank"
                    rel="noreferrer"
                    title="Open file"
                  >
                    <Icon name="external" size={14} />
                  </a>
                {/if}
                {#if item.kind === 'image' || item.kind === 'video'}
                  <button class="btn btn-ghost btn-sm" title="Open in Inspect" onclick={() => inspect(item)}>
                    <Icon name="inspect" size={14} />
                  </button>
                {/if}
                {#if item.kind === 'image'}
                  <button class="btn btn-ghost btn-sm" title="Send to Geo Proof" onclick={() => sendToComposer(item)}>
                    <Icon name="proof" size={14} />
                  </button>
                {/if}
                <button class="btn btn-ghost btn-sm del" title="Delete" onclick={() => (deleteTarget = item)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          {/each}
        </div>
      {:else}
      <div class="grid" class:compact={view === 'small'}>
        {#each filteredItems as item (mediaKey(item))}
          <div
            class="media-card card"
            class:focused={item.path === focusedPath}
            data-path={item.path}
          >
            <!-- thumbnail — click to lightbox for images -->
            <!-- The role and tab stop deliberately exist only for image previews. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <div
              class="thumb"
              class:clickable={item.kind === 'image'}
              onclick={() => item.kind === 'image' && (lightboxItem = item)}
              role={item.kind === 'image' ? 'button' : undefined}
              tabindex={item.kind === 'image' ? 0 : undefined}
              onkeydown={(e) => e.key === 'Enter' && item.kind === 'image' && (lightboxItem = item)}
              aria-label={item.kind === 'image' ? `Preview ${item.filename}` : undefined}
            >
              {#if item.thumbnail && item.thumb_state === 'ready' && !brokenThumbs.has(mediaKey(item))}
                <img
                  src={fileUrl(caseState.current.id, item.thumbnail)}
                  data-media-key={mediaKey(item)}
                  alt={item.filename}
                  loading="lazy"
                  decoding="async"
                  onerror={markBrokenThumb}
                />
              {:else if item.thumb_state === 'queued' || item.thumb_state === 'running'}
                <div class="thumb-status">
                  <Icon name="clock" size={22} />
                  <span>Generating…</span>
                </div>
              {:else if item.thumb_state === 'failed'}
                <button
                  class="thumb-status thumb-retry"
                  title="Retry thumbnail"
                  onclick={(e) => {
                    e.stopPropagation();
                    regenerateThumbs(item.path);
                  }}
                >
                  <Icon name="reset" size={20} />
                  <span>Retry</span>
                </button>
              {:else}
                <Icon name={KIND_ICONS[mediaDisplayKind(item)] ?? 'file'} size={34} />
              {/if}
              <span class="kind badge">{mediaDisplayKind(item)}</span>
              {#if mediaPoint(item)}
                <button
                  class="gps-badge badge"
                  title={`Metadata says ${pointLabel(item)} — show it on the map`}
                  aria-label={`Show ${pointLabel(item)} on the map`}
                  onclick={(e) => showOnMap(item, e)}
                >
                  <Icon name="pin" size={11} />
                </button>
              {/if}
              {#if item.folder}
                <span class="folder-badge badge">
                  <Icon name="folder" size={10} />{item.folder}
                </span>
              {/if}
            </div>
            <div class="body">
              <span class="name" title={item.filename}>{item.title ?? item.filename}</span>
              <span class="meta">
                {fmtSize(item.size)} ·
                <span class="mono" title={item.sha256}>{item.sha256.slice(0, 8)}</span>
                {#if item.source?.type === 'download'}
                  · <a href={item.source.webpage_url ?? item.source.url} target="_blank" rel="noreferrer">source</a>
                {/if}
              </span>
              {#if item.notes}
                <span class="notes-preview" title={item.notes}>{item.notes}</span>
              {/if}
            </div>
            <div class="actions">
              <button
                class="btn btn-ghost btn-sm"
                title="Info / Edit notes"
                onclick={() => openInfo(item)}
              >
                <Icon name="note" size={14} />
              </button>
              {#if item.kind === 'file'}
                <button
                  class="btn btn-ghost btn-sm"
                  title="Open the folder this file is in"
                  onclick={() => revealFolder(item)}
                >
                  <Icon name="folderOpen" size={14} />
                </button>
              {:else}
                <a
                  class="btn btn-ghost btn-sm"
                  href={fileUrl(caseState.current.id, item.path)}
                  target="_blank"
                  rel="noreferrer"
                  title="Open file"
                >
                  <Icon name="external" size={14} />
                </a>
              {/if}
              {#if item.kind === 'image' || item.kind === 'video'}
                <button
                  class="btn btn-ghost btn-sm"
                  title="Open in Inspect"
                  onclick={() => inspect(item)}
                >
                  <Icon name="inspect" size={14} />
                </button>
              {/if}
              {#if item.kind === 'image'}
                <button
                  class="btn btn-ghost btn-sm"
                  title="Send to Geo Proof"
                  onclick={() => sendToComposer(item)}
                >
                  <Icon name="proof" size={14} />
                </button>
              {/if}
              <button class="btn btn-ghost btn-sm del" title="Delete" onclick={() => (deleteTarget = item)}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          </div>
        {/each}
      </div>
      {/if}
      {#if pl.hasMore}
        <div class="show-more">
          <button class="btn" onclick={() => pl.loadMore()} disabled={pl.loading}>
            {pl.loading ? 'Loading…' : 'Show more'}
          </button>
        </div>
      {/if}
    {/if}
  </div>

  {#if dragOver}
    <div class="drop-overlay">
      <div class="drop-box">
        <Icon name="upload" size={40} />
        <span>Drop to add to the case</span>
      </div>
    </div>
  {/if}
</div>

<!-- multi-item picker: shown when a URL has several attachments (e.g. a tweet
     with several photos) — pick which ones to download, before anything is fetched -->
{#if picker}
  <Modal title="Choose media to download" onclose={() => (picker = null)} width="560px">
    <p class="picker-hint">This link has {picker.items.length} attachments. Pick which to fetch.</p>
    <div class="picker-toolbar">
      <button class="btn btn-ghost btn-sm" onclick={() => selectAllPicker(true)}>Select all</button>
      <button class="btn btn-ghost btn-sm" onclick={() => selectAllPicker(false)}>Select none</button>
    </div>
    <div class="picker-list">
      {#each picker.items as item (item.index)}
        <label class="picker-row" class:selected={item.selected}>
          <input type="checkbox" bind:checked={item.selected} />
          <div class="picker-thumb">
            {#if item.thumbnail}
              <img src={item.thumbnail} alt="" loading="lazy" />
            {:else}
              <Icon name={KIND_ICONS[item.kind] ?? 'file'} size={20} />
            {/if}
          </div>
          <input class="input picker-title" placeholder="Title" bind:value={item.title} />
        </label>
      {/each}
    </div>
    <div class="modal-actions">
      <div style="flex:1"></div>
      <button class="btn" onclick={() => (picker = null)}>Cancel</button>
      <button
        class="btn btn-primary"
        disabled={!picker.items.some((i) => i.selected)}
        onclick={confirmPicker}
      >
        <Icon name="download" size={14} />
        Download {picker.items.filter((i) => i.selected).length} selected
      </button>
    </div>
  </Modal>
{/if}

<!-- cookie affordance: shown only when a download hits a login wall. The first
     attempt is always cookie-less, so this never interrupts public media. -->
{#if authPrompt}
  {@const chromiumBlocked =
    authPrompt.guidance === 'windows-chromium' ||
    (authPrompt.platform === 'win32' && CHROMIUM_BROWSERS.has(authPrompt.browser))}
  <Modal title="This link needs a login" onclose={() => (authPrompt = null)} width="480px">
    <p class="auth-hint">
      Works only if you're already signed in to this site in the browser you pick. Azimut borrows
      that session; it never asks for a password.
    </p>

    <div class="auth-source">
      <label class="auth-label" for="cookie-browser">Use cookies from</label>
      <select id="cookie-browser" class="input" bind:value={authPrompt.browser}>
        {#each COOKIE_BROWSERS as b (b.id)}
          <option value={b.id}>{b.label}</option>
        {/each}
      </select>
      <button class="btn btn-primary" disabled={authPrompt.busy || chromiumBlocked} onclick={retryWithBrowser}>
        <Icon name="download" size={14} /> Download signed in
      </button>
    </div>

    {#if chromiumBlocked}
      <p class="auth-note">
        Windows locks Chrome-family cookies, so Azimut can't read them. Quit that browser and pick
        Firefox, or use an exported cookies.txt below.
      </p>
    {/if}

    <div class="auth-divider"><span>or</span></div>

    <input
      type="file"
      accept=".txt"
      hidden
      bind:this={cookieFileInput}
      onchange={(e) => retryWithCookieFile(e.currentTarget.files[0])}
    />
    <button
      class="btn btn-ghost auth-file"
      disabled={authPrompt.busy}
      onclick={() => cookieFileInput.click()}
    >
      <Icon name="upload" size={14} /> Use a cookies.txt file
    </button>

    <div class="modal-actions">
      <div style="flex:1"></div>
      <button class="btn" disabled={authPrompt.busy} onclick={() => (authPrompt = null)}>Cancel</button>
    </div>
  </Modal>
{/if}

<!-- details modal: the same editor body as the case sidebar (provenance,
     derivation chain, title/notes/folder) so both stay in step -->
{#if infoEntityId}
  <Modal title="Details" onclose={closeInfo} width="520px">
    <EntityDetails
      entityId={infoEntityId}
      bind:dirty={infoDirty}
      onclose={() => (infoEntityId = null)}
      ondeleted={() => (infoEntityId = null)}
    >
      {#snippet previewActions()}
        <button class="btn btn-sm" onclick={exportMedia} disabled={exportBusy}>
          <Icon name="download" size={14} />
          {exportBusy ? 'Exporting…' : 'Export'}
        </button>
        <button
          class="btn btn-ghost btn-sm"
          onclick={openMediaExportPicker}
          title="Change export folder"
          aria-label="Change export folder"
        >
          <Icon name="folder" size={14} />
        </button>
      {/snippet}
    </EntityDetails>
  </Modal>
{/if}

{#if infoDiscarding}
  <ConfirmDialog
    title="Discard changes?"
    message="This item has edits that Save has not taken."
    confirmLabel="Discard"
    icon="alert"
    onconfirm={() => { infoDiscarding = false; infoDirty = false; infoEntityId = null; }}
    oncancel={() => (infoDiscarding = false)}
  />
{/if}

{#if exportPicker}
  <ExportFolderPicker
    kind="media"
    current={exportDir}
    onclose={() => (exportPicker = false)}
    onchosen={(path) => (exportDir = path)}
  />
{/if}

<!-- lightbox -->
<svelte:window onkeydown={onLightboxKey} />
{#if lightboxItem}
  <div
    class="lightbox"
    onclick={(e) => e.target === e.currentTarget && (lightboxItem = null)}
    onkeydown={(e) => e.key === 'Escape' && (lightboxItem = null)}
    role="dialog"
    aria-label="Image preview"
    tabindex="-1"
  >
    <button class="lb-close btn btn-ghost" onclick={() => (lightboxItem = null)} aria-label="Close">
      <Icon name="x" size={20} />
    </button>
    {#if lightboxImages.length > 1}
      <button
        class="lb-nav prev btn btn-ghost"
        onclick={(e) => (e.stopPropagation(), lightboxStep(-1))}
        aria-label="Previous image"
        title="Previous (←)"
      >
        <Icon name="chevronLeft" size={26} />
      </button>
      <button
        class="lb-nav next btn btn-ghost"
        onclick={(e) => (e.stopPropagation(), lightboxStep(1))}
        aria-label="Next image"
        title="Next (→)"
      >
        <Icon name="chevronRight" size={26} />
      </button>
    {/if}
    <img
      src={fileUrl(caseState.current.id, lightboxItem.path)}
      alt={lightboxItem.filename}
    />
    <span class="lb-caption">
      {lightboxItem.title ?? lightboxItem.filename}
      {#if lightboxImages.length > 1}
        · {lightboxImages.findIndex((i) => i.path === lightboxItem.path) + 1}/{lightboxImages.length}
      {/if}
    </span>
  </div>
{/if}

<!-- delete confirm: the file waits in the case trash with the entity -->
{#if deleteTarget}
  <ConfirmDialog
    title="Delete this media?"
    message={`“${deleteTarget.title ?? deleteTarget.filename}” and its entity will be removed from the case.`}
    detail="Moves the media and its file to the case trash."
    restorable={RESTORABLE}
    confirmLabel="Delete"
    tone="default"
    busy={deleteBusy}
    onconfirm={confirmDelete}
    oncancel={() => (deleteTarget = null)}
  />
{/if}

<!-- Ctrl+V: the screenshot that only exists in the clipboard -->
{#if pasted}
  <PasteDialog
    resolved={pasted}
    busy={pasteBusy}
    onconfirm={confirmPaste}
    onclose={() => (pasted = null)}
  />
{/if}

<style>
  .tool {
    position: relative;
  }
  .spacer {
    flex: 1;
  }
  .dl-form {
    display: flex;
    gap: 8px;
    width: min(480px, 40vw);
  }

  /* folder filter bar */
  .folder-bar {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-1);
    overflow-x: auto;
    flex-shrink: 0;
  }
  .bar-sep {
    width: 1px;
    align-self: stretch;
    margin: 2px 4px;
    background: var(--border);
    flex-shrink: 0;
  }
  .show-more {
    display: flex;
    justify-content: center;
    padding: 16px 0 4px;
  }
  .sort-select {
    width: auto;
    font-size: var(--fs-xs);
    padding: 4px 8px;
    flex-shrink: 0;
  }
  .folder-select {
    width: auto;
    min-width: 150px;
    font-size: var(--fs-xs);
    padding: 4px 8px;
    flex-shrink: 0;
  }
  .category-select {
    width: auto;
    min-width: 130px;
    font-size: var(--fs-xs);
    padding: 4px 8px;
    flex-shrink: 0;
  }
  .gps-filter {
    flex-shrink: 0;
    white-space: nowrap;
  }
  .gps-filter.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .reset-filters {
    margin-left: auto;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .view-switch {
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    flex-shrink: 0;
  }
  .view-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: var(--r-sm);
    color: var(--text-3);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .view-btn:hover {
    color: var(--text-1);
  }
  .view-btn.active {
    background: var(--bg-3);
    color: var(--text-1);
  }

  .job {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 14px 20px 0;
    padding: 10px 14px;
    color: var(--text-2);
  }
  .job-url {
    font-size: var(--fs-xs);
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--bg-3);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    border-radius: 3px;
    transition: width 0.4s var(--ease);
  }
  .fill.indeterminate {
    animation: slide 1.2s infinite var(--ease);
  }
  @keyframes slide {
    from { transform: translateX(-100%); }
    to { transform: translateX(350%); }
  }
  .job-meta {
    font-size: var(--fs-xs);
    color: var(--text-3);
    min-width: 90px;
    text-align: right;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 14px;
    padding: 18px 20px;
  }
  .grid.compact {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }
  .media-card {
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: border-color 0.15s var(--ease);
  }
  .media-card:hover {
    border-color: var(--border-strong);
  }
  .media-card.focused {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
    animation: focus-flash 0.9s var(--ease) 2;
  }
  @keyframes focus-flash {
    0%, 100% { box-shadow: 0 0 0 2px var(--accent-soft); }
    50% { box-shadow: 0 0 0 4px var(--accent-soft); }
  }
  .thumb {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 10;
    min-width: 0;
    min-height: 0;
    background: var(--bg-2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-3);
    overflow: hidden;
    flex: 0 0 auto;
  }
  .thumb.clickable {
    cursor: zoom-in;
  }
  .thumb-status {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    color: var(--text-3);
    font-size: var(--fs-xs);
    background: none;
    border: none;
  }
  .thumb-status :global(svg) {
    opacity: 0.85;
    animation: thumb-pulse 1.6s ease-in-out infinite;
  }
  @keyframes thumb-pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.9; }
  }
  .thumb-retry {
    cursor: pointer;
  }
  .thumb-retry:hover {
    color: var(--text-1);
  }
  .thumb-retry :global(svg) {
    animation: none;
  }
  .thumb img {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    object-fit: cover;
  }
  .kind {
    position: absolute;
    top: 8px;
    left: 8px;
    background: rgba(16, 16, 16, 0.75);
    backdrop-filter: blur(4px);
  }
  /* a stated position, as one glyph: the coordinates are in the tooltip, and the
     badge is the way to the map rather than a second line of text */
  .gps-badge {
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 3px 5px;
    border: 0;
    background: rgba(16, 16, 16, 0.75);
    backdrop-filter: blur(4px);
    color: var(--accent);
    cursor: pointer;
  }
  .gps-badge:hover {
    color: var(--accent-text, #fff);
    background: var(--accent);
  }
  .folder-badge {
    position: absolute;
    bottom: 6px;
    right: 6px;
    display: flex;
    align-items: center;
    gap: 3px;
    background: rgba(16, 16, 16, 0.75);
    backdrop-filter: blur(4px);
    font-size: 10px;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .body {
    padding: 10px 12px 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .name {
    font-size: var(--fs-sm);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .notes-preview {
    font-size: var(--fs-xs);
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-style: italic;
  }
  .actions {
    display: flex;
    gap: 2px;
    padding: 4px 8px 8px;
  }
  /* Cards only — a list row shares this class and must stay on one line. A card
     clips its overflow, so a button row that does not fit loses its last button,
     and the last one is Delete. Wrapping costs a few pixels of card height; a
     delete button that is there but unclickable costs trust. */
  .grid .actions {
    flex-wrap: wrap;
  }
  /* Small cards are 150px wide and hold the same five actions a large one does:
     at the default padding that is 184px of buttons inside 150px of card. Tighten
     the buttons rather than drop an action — every one of them is the only way to
     reach what it does from this view. */
  .grid.compact .actions {
    gap: 1px;
    padding-inline: 6px;
  }
  .grid.compact .actions .btn {
    padding-inline: 4px;
  }
  .del {
    margin-left: auto;
  }
  /* Details list: deliberately plain rows, not card-shaped mini tiles. */
  .media-list {
    /* Every row, including the header, must share this exact grid. An `auto`
       actions column is empty in the header but wide in a data row, which
       shifts every sortable heading out of alignment.

       So the actions cell is a fixed width, and it is computed rather than typed:
       one ghost icon button is a 14px glyph plus 8px of padding and a 1px border
       on each side, and the widest row holds six of them — GPS pin, info,
       open, inspect, proof, delete. A literal here goes stale the next time a tool earns
       a row action, and the symptom is the delete button quietly clipped off the
       end of the row. */
    --media-action: 32px;
    --media-action-gap: 2px;
    /* the seven buttons plus slack. Sized to the exact sum, the cell fits only
       until a sub-pixel of rounding says otherwise, and then Delete — which
       `margin-left: auto` holds at the right edge — is the one that goes. The
       slack is also where that auto margin lives, so the row still reads as
       "actions, then delete". */
    --media-actions: calc(6 * var(--media-action) + 5 * var(--media-action-gap) + 10px);
    --media-columns: 54px minmax(180px, 1fr) 90px 82px minmax(100px, 0.45fr) 132px
      var(--media-actions);
    padding: 6px 20px 18px;
  }
  .media-row {
    display: grid;
    grid-template-columns: var(--media-columns);
    align-items: center;
    /* the sum of the columns above, so the row scrolls rather than crushing its
       last cell when the panel is narrow */
    min-width: calc(624px + var(--media-actions));
    min-height: 54px;
    gap: 10px;
    padding: 5px 8px;
    border-bottom: 1px solid var(--border);
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .media-row:not(.media-head):hover {
    background: var(--bg-2);
  }
  .media-row.focused {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    animation: focus-flash 0.9s var(--ease) 2;
  }
  .media-head {
    position: sticky;
    top: 0;
    z-index: 1;
    min-height: 32px;
    background: var(--bg-1);
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .media-head-button {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 4px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-align: left;
    text-transform: inherit;
    cursor: pointer;
  }
  .media-head-button:hover,
  .media-head-button.active {
    color: var(--text-1);
  }
  .media-col-name {
    min-width: 0;
  }
  .media-col-type,
  .media-col-size,
  .media-col-folder,
  .media-col-added {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .list-preview {
    width: 46px;
    height: 34px;
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-3);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .list-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .list-preview.clickable {
    cursor: zoom-in;
  }
  .list-name {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-1);
    font-weight: 600;
  }
  .media-col-actions {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: var(--media-action-gap);
    /* a row is one line. The cell is sized to hold every button, so wrapping here
       would only ever mean the width calculation is wrong — and it would hide the
       error by dropping Delete onto a second line instead of showing it. */
    flex-wrap: nowrap;
  }
  .media-col-actions > * {
    flex: 0 0 auto;
  }
  .media-row:not(.media-head) .media-col-actions {
    opacity: 0.72;
  }
  .media-row:not(.media-head):hover .media-col-actions,
  .media-row.focused .media-col-actions {
    opacity: 1;
  }
  .drop-overlay {
    position: absolute;
    inset: 0;
    background: rgba(16, 16, 16, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
    pointer-events: none;
  }
  .drop-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 44px 64px;
    border: 2px dashed var(--accent);
    border-radius: var(--r-lg);
    color: var(--accent);
    font-weight: 700;
    background: var(--accent-soft);
  }

  /* shared across picker + details modals */
  .modal-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
  }

  /* cookie affordance */
  .auth-hint {
    font-size: var(--fs-sm);
    color: var(--text-2);
    margin: 0 0 14px;
  }
  .auth-source {
    display: flex;
    align-items: end;
    gap: 8px;
  }
  .auth-source .input {
    flex: 1;
  }
  .auth-label {
    display: block;
    font-size: var(--fs-sm);
    color: var(--text-2);
    margin-bottom: 4px;
  }
  .auth-note {
    font-size: var(--fs-sm);
    color: var(--warn, var(--text-2));
    margin: 10px 0 0;
  }
  .auth-divider {
    display: flex;
    align-items: center;
    text-align: center;
    color: var(--text-2);
    font-size: var(--fs-sm);
    margin: 14px 0 10px;
  }
  .auth-divider::before,
  .auth-divider::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--border);
  }
  .auth-divider span {
    padding: 0 10px;
  }
  .auth-file {
    width: 100%;
    justify-content: center;
  }

  /* multi-item picker */
  .picker-hint {
    font-size: var(--fs-sm);
    color: var(--text-2);
    margin: 0 0 10px;
  }
  .picker-toolbar {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }
  .picker-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 46vh;
    overflow-y: auto;
  }
  .picker-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r);
    cursor: pointer;
  }
  .picker-row.selected {
    border-color: var(--accent);
    background: var(--bg-3);
  }
  .picker-thumb {
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    border-radius: var(--r-sm, 6px);
    overflow: hidden;
    background: var(--bg-2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-3);
  }
  .picker-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .picker-title {
    flex: 1;
    min-width: 0;
  }

  /* lightbox */
  .lightbox {
    position: fixed;
    inset: 0;
    background: rgba(4, 7, 12, 0.92);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 950;
    cursor: zoom-out;
  }
  .lightbox img {
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 80px);
    object-fit: contain;
    border-radius: var(--r);
    box-shadow: var(--shadow-2);
    cursor: default;
  }
  .lb-close {
    position: absolute;
    top: 14px;
    right: 14px;
  }
  .lb-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    padding: 14px 8px;
    color: var(--text-1);
    background: rgba(16, 16, 16, 0.55);
    border-radius: var(--r-md);
  }
  .lb-nav:hover {
    background: rgba(16, 16, 16, 0.85);
  }
  .lb-nav.prev {
    left: 14px;
  }
  .lb-nav.next {
    right: 14px;
  }
  .lb-caption {
    position: absolute;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    font-size: var(--fs-xs);
    color: var(--text-2);
    background: rgba(16, 16, 16, 0.75);
    padding: 4px 12px;
    border-radius: var(--r-sm);
    white-space: nowrap;
  }
</style>
