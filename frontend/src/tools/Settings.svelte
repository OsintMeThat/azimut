<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { toast, prefs, applyPrefs, uiState, updatesState } from '../lib/state.svelte.js';
  import { updateBadges, carryLatest } from '../lib/staleness.js';
  import {
    templatesState, loadTemplates, saveTemplate, deleteTemplate,
  } from '../lib/state.svelte.js';
  import { templateFromProof, textSignatureStyle } from '../lib/composer.js';
  import { templateFromPost } from '../lib/post.js';
  import { formatCoords, parseHomeView } from '../lib/coords.js';
  import { USAGE_LINKS, ECO_MAX_ZOOM } from '../lib/usage.js';
  import { probeKey, googleMapsLoadedKey } from '../lib/gmaps.js';
  import { extensionVersion } from '../lib/extBridge.js';
  import { CASE_FOLDER_LABEL, saveDestination } from '../lib/exportDest.js';
  import Icon from '../components/Icon.svelte';
  import ExportFolderPicker from '../components/ExportFolderPicker.svelte';
  import ProofTemplateEditor from '../components/ProofTemplateEditor.svelte';
  import PostTemplateEditor from '../components/PostTemplateEditor.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import ExtensionTab from './settings/ExtensionTab.svelte';
  import GeneralTab from './settings/GeneralTab.svelte';
  import ImageryTab from './settings/ImageryTab.svelte';
  import PublishingTab from './settings/PublishingTab.svelte';
  import StorageTab from './settings/StorageTab.svelte';
  import SystemTab from './settings/SystemTab.svelte';
  import TemplatesTab from './settings/TemplatesTab.svelte';

  // Keep workflow choices above app maintenance in the settings rail.
  const TABS = [
    { id: 'general', label: 'General', icon: 'sliders' },
    { id: 'publishing', label: 'Publishing', icon: 'edit' },
    { id: 'imagery', label: 'Imagery', icon: 'key' },
    { id: 'templates', label: 'Templates', icon: 'layers' },
    { id: 'extension', label: 'Capture extension', icon: 'crop' },
    { id: 'storage', label: 'Storage', icon: 'folder' },
    { id: 'system', label: 'System', icon: 'compass' },
  ];
  let tab = $state('general');

  const REPO_URL = 'https://github.com/OsintMeThat/azimut';
  const SITE_URL = 'https://osintmethat.com';

  // Imagery keys and their usage meters share one card per provider.
  // The keyed imagery providers the app knows how to light up (IMAGERY_PROVIDERS.md).
  // Keys are app-wide and stored in settings.json, outside cases and exports.
  //
  // Collapsed cards show `gives` and `cost`; setup details stay in the open card.
  const KEYED = [
    {
      id: 'mapbox',
      label: 'Mapbox',
      gives: 'Satellite basemap',
      cost: '$0.50 / 1,000 past the tier',
      field: 'Mapbox public access token',
      placeholder: 'pk.…',
      help: 'https://account.mapbox.com/access-tokens/',
      usage: USAGE_LINKS.mapbox,
      steps: [
        'Sign in (or create a free account) at mapbox.com.',
        'Open Account → Tokens and copy the default public token, or create a new one.',
        'No referrer restriction needed: Azimut calls Mapbox from its own backend, not the browser.',
      ],
      overage:
        'Past the tier, Mapbox bills extra tiles automatically; set a spending alert in your account.',
    },
    {
      id: 'google',
      label: 'Google',
      gives: 'Satellite basemap',
      cost: '$0.60 / 1,000 past the tier',
      field: 'Google Maps Platform API key',
      placeholder: 'AIza…',
      help: 'https://developers.google.com/maps/documentation/tile/get-api-key',
      usage: USAGE_LINKS.google,
      warning:
        'EEA billing accounts: since 8 July 2025 Google no longer serves satellite tiles to Europe (403). Use a Maps JavaScript API key instead.',
      steps: [
        'In the Google Cloud Console, enable the "Map Tiles API" on your project.',
        'Create an API key (Credentials) and restrict it to that API.',
        'Use an IP restriction, not a referrer one: Azimut calls Google from its own backend, not the browser.',
      ],
      overage:
        'Extra tiles are billed to your Cloud project; a quota cap in the Cloud Console makes it stop serving instead.',
    },
    {
      id: 'google_js',
      label: 'Google (Maps JS)',
      gives: 'Satellite basemap · works in the EEA',
      cost: 'Billed per map load, not per tile',
      field: 'Google Maps JavaScript API key',
      placeholder: 'AIza…',
      help: 'https://developers.google.com/maps/documentation/javascript/get-api-key',
      usage: USAGE_LINKS.google_js,
      // A JavaScript key must be tested in the browser with a real map load.
      browserTest: true,
      steps: [
        'In the Google Cloud Console, enable the "Maps JavaScript API" on your project.',
        'Create an API key (Credentials) and restrict it to that API.',
        'Optional but recommended: restrict the key to your own referrers.',
      ],
      overage:
        'One load per widget, ~10k free a month; Azimut reuses one widget per session, so normal use stays far under the tier.',
    },
    {
      id: 'sentinelhub',
      label: 'Sentinel Hub',
      gives: 'Sentinel-2 · free · 10 m/px',
      cost: 'Never billed',
      field: 'Copernicus configuration instance ID',
      placeholder: 'a1b2c3d4-0000-0000-0000-000000000000',
      help: 'https://shapps.dataspace.copernicus.eu/dashboard/#/configurations',
      usage: USAGE_LINKS.sentinelhub,
      // Not a token you're issued but a configuration you build, so the field
      // needs the recipe, not just a "get one here" link.
      steps: [
        'Register (free) on dataspace.copernicus.eu, then open the Sentinel Hub Dashboard.',
        'Configuration Utility → New configuration, based on "Simple Sentinel-2 L2A template".',
        'Open it and turn off Show logo and Show warnings. Both are burned into every tile.',
        'Copy the ID under "Service endpoints" and paste it here.',
      ],
      overage:
        'A free account gets 30,000 requests a month and simply stops serving until the 1st. It never bills.',
      // the correction the free-allowance box exists for, told where it's useful
      tierNote:
        'Copernicus documents 10,000 but provisions 30,000, per account; check yours on the dashboard.',
    },
  ];

  /** Build the per-provider shape used by key and preference state. */
  const perProvider = (value) => Object.fromEntries(KEYED.map((k) => [k.id, value(k)]));

  let keys = $state(perProvider(() => ''));
  let usage = $state({});
  let month = $state('');
  let testing = $state(perProvider(() => false));
  let testResult = $state(perProvider(() => null)); // { ok, detail } | null
  // Keyed-provider preferences are saved on toggle.
  let enabled = $state(perProvider(() => true));
  let overrides = $state(perProvider(() => false));
  let eco = $state(true);
  let ecoMaxZoom = $state(ECO_MAX_ZOOM);
  // Per-provider eco thresholds: '' inherits and '0' disables eco mode.
  // Maps JS has no threshold because reopening its widget starts a billed load.
  let ecoZooms = $state(perProvider(() => ''));
  // The account's monthly allowance per meter; '' uses the shipped default.
  // Users can correct provider-specific allowances that differ from documentation.
  let tiers = $state(null);
  let tierEdits = $state(perProvider(() => ''));
  let about = $state({ version: '', workspace_root: '', extension_version: '' });
  // ffmpeg powers video thumbnails, frame scans and merged-stream downloads.
  // The binaries bundle it; a pip install uses a system copy on PATH. Read-only.
  let ffmpeg = $state({ available: false, version: null, source: null, path: null });

  // Capture extension pairing and detection.
  let ingestToken = $state('');
  let tokenShown = $state(false);
  // Read once per mount because an extension installed mid-session needs a reload.
  const extDetected = extensionVersion();

  // Every dot in this tool comes from the same place as the one on the Settings
  // icon, so a tab can never disagree with the rail that led the user to it.
  let badges = $derived(updateBadges(updatesState, prefs.updateDismissedVersion));
  let extOutdated = $derived(badges.extensionOutdated);

  async function copyToken() {
    try {
      await ensureToken();
      await navigator.clipboard.writeText(ingestToken);
      toast('Pairing token copied', 'ok');
    } catch {
      tokenShown = true; // Show the token when clipboard access is blocked.
      toast('Could not copy. The token is shown for manual copy', 'warn');
    }
  }

  // Mint the token only when the user reveals or copies it.
  async function ensureToken() {
    if (ingestToken) return ingestToken;
    const r = await api.post('/api/settings/ingest-token');
    ingestToken = r.ingest_token;
    return ingestToken;
  }

  async function rotateToken() {
    const r = await api.post('/api/settings/ingest-token/rotate');
    ingestToken = r.ingest_token;
    toast('New token minted. Every extension must pair again', 'ok', 6000);
  }
  // Keep home-view fields as text until change so partial numbers remain editable.
  let home = $state({ lat: '', lon: '', zoom: '' });
  let mention = $state('');
  let postTarget = $state('x');
  let updateOnStart = $state(true); // pop a notice on load when a release is out
  // whether saving a proof files its point as a place, or asks first
  let proofPlaceAuto = $state(true);
  // The app-wide logo lives beside settings.json and reaches cases only in proof PNGs.
  // `sigBust` refreshes the preview after replacement.
  let signature = $state(false);
  let signatureHandle = $state('');
  let sigBust = $state(0);
  let sigInput = $state(null);

  // Move the app's own state between machines: the export writes one JSON file
  // holding settings, templates and the signature logo; the import merges it
  // back. A file written before those sections existed is a bare settings blob,
  // so it gets wrapped into the current shape.
  let settingsFile = $state(null);
  let exportDirs = $state({ notes: '', media: '', proofs: '', views: '' });
  let exportPickerKind = $state(null);

  const EXPORT_KINDS = [
    { id: 'notes', label: 'Note PDFs' },
    { id: 'media', label: 'Media copies' },
    { id: 'proofs', label: 'Proof PNGs' },
    { id: 'views', label: 'Analysis plates' },
    { id: 'sheets', label: 'Sheet CSVs' },
  ];

  async function resetExportDestination(kind) {
    try {
      const saved = await saveDestination(kind, '');
      exportDirs = saved;
      toast(`${EXPORT_KINDS.find((entry) => entry.id === kind)?.label} use ${CASE_FOLDER_LABEL}`, 'ok');
    } catch (e) {
      toast(`Could not reset the export folder: ${e.message}`, 'danger');
    }
  }

  async function importSettings(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const bundle = parsed.settings ? parsed : { settings: parsed };
      const r = await api.post('/api/settings/import', bundle);
      const restored = [
        `${r.imported.length} setting${r.imported.length === 1 ? '' : 's'}`,
        r.templates ? `${r.templates} template${r.templates === 1 ? '' : 's'}` : null,
        r.signature ? 'signature' : null,
      ].filter(Boolean);
      toast(`Backup restored: ${restored.join(', ')}`, 'ok');
      await load();
      await loadTemplates();
      sigBust += 1; // the logo changed on disk; re-fetch it past the cache
    } catch (e) {
      toast(`Could not import the backup: ${e.message}`, 'danger');
    } finally {
      event.currentTarget.value = '';
    }
  }

  let scrapers = $state([]);
  let checking = $state(false);
  let updating = $state({}); // { [dist]: true } while its request is in flight

  async function loadScrapers(check = false) {
    const path = check ? '/api/settings/scrapers?check=true' : '/api/settings/scrapers';
    const fresh = (await api.get(path)).scrapers;
    // A local read knows the installed version and nothing about PyPI, so it
    // would blank the verdict the startup check found. Carry `latest` across
    // and judge it again, and updating one downloader stops clearing the other
    // one's badge.
    scrapers = check ? fresh : carryLatest(fresh, updatesState.scrapers);
    updatesState.scrapers = scrapers;
  }

  // Scraper checks run only when requested and never on Settings mount: the
  // startup check already asked, and its answer is in the store.
  async function checkScrapers() {
    if (checking) return;
    checking = true;
    try {
      await loadScrapers(true);
      const stale = scrapers.filter((s) => s.outdated);
      const failed = scrapers.find((s) => s.check_error);
      if (failed) toast(`Could not reach PyPI: ${failed.check_error}`, 'danger');
      else if (!stale.length) toast('Downloaders are up to date', 'ok');
    } catch (e) {
      toast(`Could not check for updates: ${e.message}`, 'danger');
    } finally {
      checking = false;
    }
  }

  // The startup check's answer, until the user asks for a fresher one. Both land
  // in the same place so the row and the dot beside it can't tell different
  // stories — { current, latest, update_available, url, error } or null.
  let appUpdate = $derived(updatesState.app);
  let checkingApp = $state(false);

  async function checkAppUpdate() {
    if (checkingApp) return;
    checkingApp = true;
    try {
      const fresh = await api.get('/api/settings/update?check=true');
      updatesState.app = fresh;
      if (fresh.error) toast(`Could not reach GitHub: ${fresh.error}`, 'danger');
      else if (!fresh.update_available) toast('Azimut is up to date', 'ok');
    } catch (e) {
      toast(`Could not check for updates: ${e.message}`, 'danger');
    } finally {
      checkingApp = false;
    }
  }

  // Report an issue. The server builds the body and the pre-filled link; this
  // only keeps them fresh as the user types, so the link is a real anchor and no
  // popup blocker sees a window.open after an await.
  let reportKind = $state('bug');
  let reportSummary = $state('');
  let report = $state(null); // { kind, title, report, url }
  let reportTimer = null;

  async function loadReport() {
    const params = new URLSearchParams({ kind: reportKind, summary: reportSummary });
    try {
      report = await api.get(`/api/settings/diagnostics?${params}`);
    } catch {
      report = null; // System falls back to a plain link to the tracker
    }
  }

  // Debounced: typing a paragraph shouldn't rebuild the report on every key.
  function refreshReport() {
    clearTimeout(reportTimer);
    reportTimer = setTimeout(loadReport, 400);
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(report.report);
      toast('Report copied', 'ok');
    } catch {
      toast('Could not copy. Select the report text instead', 'warn');
    }
  }

  async function updateScraper(dist) {
    if (updating[dist]) return;
    updating[dist] = true;
    try {
      const r = await api.post(`/api/settings/scrapers/${dist}/update`);
      if (!r.ok) toast(`${dist}: ${r.detail}`, 'danger');
      else toast(`${dist} ${r.detail}`, r.restart_required ? 'warn' : 'ok');
      await loadScrapers();
      // Preserve the restart-required state after reloading the scraper list.
      if (r.ok && r.restart_required) {
        const entry = scrapers.find((s) => s.dist === dist);
        if (entry) entry.restart_required = true;
      }
    } catch (e) {
      toast(`${dist}: ${e.message}`, 'danger');
    } finally {
      updating[dist] = false;
    }
  }

  async function resetScraper(dist) {
    try {
      const r = await api.del(`/api/settings/scrapers/${dist}`);
      await loadScrapers();
      if (r.restart_required) toast(`${dist} reverted. Restart Azimut to use it`, 'warn');
      else toast(`${dist} reverted to the bundled version`, 'ok');
    } catch (e) {
      toast(`${dist}: ${e.message}`, 'danger');
    }
  }

  async function load() {
    const s = await api.get('/api/settings');
    signature = !!s.signature;
    signatureHandle = s.signature_handle ?? '';
    keys = perProvider((k) => s.api_keys[k.id] ?? '');
    usage = s.usage;
    month = s.month;
    enabled = perProvider((k) => s.providers_enabled[k.id] ?? true);
    overrides = perProvider((k) => !!s.usage_overrides[k.id]);
    // Show stored key-test and live-auth verdicts in the provider card.
    testResult = perProvider((k) => s.provider_status?.[k.id] ?? null);
    eco = s.eco_zoom_fallback;
    ecoMaxZoom = s.eco_max_zoom ?? ECO_MAX_ZOOM;
    ecoZooms = perProvider((k) => {
      const v = s.eco_max_zooms?.[k.id];
      return v === undefined || v === null ? '' : String(v);
    });
    tiers = s.free_tier ?? null;
    tierEdits = perProvider((k) => {
      const v = s.free_tiers?.[k.id];
      return v === undefined || v === null ? '' : String(v);
    });
    about = {
      version: s.version ?? '',
      workspace_root: s.workspace_root ?? '',
      extension_version: s.extension_version ?? '',
    };
    exportDirs = {
      notes: s.export_dirs?.notes ?? '',
      media: s.export_dirs?.media ?? '',
      proofs: s.export_dirs?.proofs ?? '',
    };
    ingestToken = s.ingest_token ?? '';
    home = { lat: String(s.home_view.lat), lon: String(s.home_view.lon), zoom: String(s.home_view.zoom) };
    mention = s.post_mention ?? '';
    postTarget = s.post_target ?? 'x';
    updateOnStart = s.update_check_on_start ?? true;
    proofPlaceAuto = s.proof_place_auto ?? true;
    applyPrefs(s); // the rest of the app reads these live
    await loadScrapers().catch(() => {}); // local disk read; never blocks Settings
    // shells out to `ffmpeg -version`; non-blocking, System only reads it
    api.get('/api/settings/ffmpeg').then((r) => (ffmpeg = r)).catch(() => {});
  }

  // General settings save on change; the server returns canonical values.
  async function savePrefs(patch) {
    try {
      const saved = await api.put('/api/settings/prefs', patch);
      applyPrefs(saved);
      return saved;
    } catch (e) {
      toast(`Could not save preferences: ${e.message}`, 'danger');
      await load().catch(() => {}); // don't leave a rejected value on screen
      return null;
    }
  }

  async function uploadSignature(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    try {
      await api.post('/api/settings/signature', body);
      signature = true;
      sigBust++;
      toast('Signature saved', 'ok');
    } catch (e) {
      toast(`Could not save the signature: ${e.message}`, 'danger');
    }
    if (sigInput) sigInput.value = ''; // let the same file be picked again
  }

  async function removeSignature() {
    try {
      await api.del('/api/settings/signature');
      signature = false;
      toast('Signature removed', 'ok');
    } catch (e) {
      toast(`Could not remove the signature: ${e.message}`, 'danger');
    }
  }

  function saveProviderPrefs() {
    savePrefs({
      providers_enabled: enabled,
      usage_overrides: overrides,
      eco_zoom_fallback: eco,
      eco_max_zoom: Number(ecoMaxZoom) || ECO_MAX_ZOOM,
    });
  }

  async function saveEcoZoom() {
    // Empty thresholds inherit; zero disables eco mode for that provider.
    const perProviderZooms = {};
    for (const [id, v] of Object.entries(ecoZooms)) {
      perProviderZooms[id] = v === '' ? null : Number(v);
    }
    const saved = await savePrefs({
      eco_zoom_fallback: eco,
      eco_max_zoom: Number(ecoMaxZoom) || ECO_MAX_ZOOM,
      eco_max_zooms: perProviderZooms,
    });
    if (saved) {
      ecoMaxZoom = saved.eco_max_zoom; // reflect the server's clamping
      ecoZooms = perProvider((k) => {
        const v = saved.eco_max_zooms?.[k.id];
        return v === undefined || v === null ? '' : String(v);
      });
    }
  }

  async function saveFreeTier() {
    // '' = back to the documented default (the server drops the override on null)
    const patch = {};
    for (const [id, v] of Object.entries(tierEdits)) {
      patch[id] = v.trim() === '' ? null : Number(v);
    }
    const saved = await savePrefs({ free_tiers: patch });
    if (saved) {
      // re-read the *resolved* tiers: the server clamps, and a cleared
      // override has to fall back to the default in the readout too
      const s = await api.get('/api/settings').catch(() => null);
      if (s) tiers = s.free_tier ?? null;
      tierEdits = perProvider((k) => {
        const v = saved.free_tiers?.[k.id];
        return v === undefined || v === null ? '' : String(v);
      });
    }
  }

  async function saveHome() {
    const view = parseHomeView(home);
    if (!view) {
      toast('Home view needs a latitude, a longitude and a zoom', 'danger');
      await load();
      return;
    }
    const saved = await savePrefs({ home_view: view });
    // Reflect the validated value returned by the server.
    if (saved) {
      home = {
        lat: String(saved.home_view.lat),
        lon: String(saved.home_view.lon),
        zoom: String(saved.home_view.zoom),
      };
    }
  }

  // a live sample so the format choice is legible before it's applied elsewhere
  const coordSample = $derived(
    formatCoords(Number(home.lat) || 43, Number(home.lon) || 25, prefs.coordFormat)
  );

  onMount(() => {
    load().catch((e) => toast(`Could not load settings: ${e.message}`, 'danger'));
    loadTemplates();
  });

  // Build the report the first time System is opened: it reads the log buffer and
  // shells nothing out, but there's no reason to do it for the other tabs.
  $effect(() => {
    if (tab === 'system' && !report) loadReport();
  });

  $effect(() => {
    if (uiState.tool !== 'settings') return;
    const aliases = { preferences: 'general', about: 'system' };
    const target = aliases[uiState.settingsTab] ?? uiState.settingsTab;
    if (!target) return;
    if (TABS.some((t) => t.id === target)) tab = target;
    uiState.settingsTab = null;
  });

  // ---- reusable templates (proof house style + post thread) ----------------
  // One editor draft at a time. `editing` = { kind, id|null, name, data }; a
  // fresh id is null until first save. Content-free presets, workspace-level.
  let editing = $state(null);
  let savingTpl = $state(false);
  let deleteTpl = $state(null); // { kind, id, name } pending confirmation

  function freshTemplate(kind) {
    return kind === 'proof' ? templateFromProof({}) : templateFromPost({});
  }

  function newTemplate(kind) {
    editing = { kind, id: null, name: '', data: freshTemplate(kind) };
  }

  function editTemplate(kind, rec) {
    // deep copy so a cancelled edit leaves the stored template untouched. A JSON
    // round-trip (not structuredClone) because `rec.data` is a Svelte state
    // proxy and structuredClone throws on a proxy.
    editing = { kind, id: rec.id, name: rec.name, data: JSON.parse(JSON.stringify(rec.data)) };
  }

  function cancelEdit() {
    editing = null;
  }

  async function saveEditingTemplate() {
    if (!editing || savingTpl) return;
    const name = editing.name.trim();
    if (!name) {
      toast('Give the template a name', 'warn');
      return;
    }
    savingTpl = true;
    try {
      const data = editing.kind === 'proof'
        ? { ...editing.data, signatureText: textSignatureStyle(editing.data.signatureText) }
        : editing.data;
      await saveTemplate(editing.kind, { id: editing.id, name, data });
      toast('Template saved', 'ok', 1600);
      editing = null;
    } catch (e) {
      toast(`Could not save the template: ${e.message}`, 'danger');
    } finally {
      savingTpl = false;
    }
  }

  async function confirmDeleteTemplate() {
    const t = deleteTpl;
    deleteTpl = null;
    try {
      await deleteTemplate(t.kind, t.id);
      if (editing?.kind === t.kind && editing?.id === t.id) editing = null;
      toast(`Deleted "${t.name}"`, 'info');
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  // Keys save on change and reset their status to Untested.
  async function saveKey(id) {
    try {
      await api.put('/api/settings/keys', { [id]: keys[id] });
      testResult[id] = null; // the old verdict was about the old key (so does the server)
    } catch (e) {
      toast(`Could not save the key: ${e.message}`, 'danger');
    }
  }

  // exercise the *saved* key against the real service (Mapbox: one tile;
  // Google: createSession) so a typo shows up here, not mid-investigation
  async function testKey(id) {
    if (testing[id]) return;
    testing[id] = true;
    testResult[id] = null;
    try {
      await api.put('/api/settings/keys', { [id]: keys[id] }); // test what's in the field
      const def = KEYED.find((k) => k.id === id);
      if (def?.browserTest) {
        // a Maps JS key only proves itself in a browser; Google's script also
        // binds to one key per page life, so a changed key needs a reload
        const bound = googleMapsLoadedKey();
        if (bound && bound !== keys[id].trim()) {
          testResult[id] = {
            ok: false,
            detail: 'Google Maps still has the previous key. Reload the app (F5), then test.',
          };
        } else {
          const url = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(keys[id].trim())}&v=weekly`;
          const { billed, ...verdict } = await probeKey(url);
          testResult[id] = verdict;
          // Count the billed browser probe because the backend cannot observe it.
          if (billed) await api.post(`/api/satellite/usage/${id}`).catch(() => {});
        }
        // Persist the browser verdict used to enable or disable the basemap.
        await api.post(`/api/settings/keys/${id}/status`, testResult[id]).catch(() => {});
      } else {
        testResult[id] = await api.post(`/api/settings/keys/${id}/test`);
      }
    } catch (e) {
      testResult[id] = { ok: false, detail: e.message };
    } finally {
      testing[id] = false;
    }
  }
</script>

<div class="tool">
  <div class="tool-header">
    <h2>Settings</h2>
    <span class="sub">Applies to every case on this machine</span>
  </div>

  <div class="split">
    <nav class="rail" aria-label="Settings sections">
      {#each TABS as t (t.id)}
        <button
          class="rail-tab dotted"
          class:active={tab === t.id}
          class:rail-break={t.id === 'storage'}
          onclick={() => (tab = t.id)}
          aria-current={tab === t.id ? 'page' : undefined}
        >
          <Icon name={t.icon} size={15} />
          {t.label}
          {#if badges.tabs[t.id]}
            <span class="update-dot" aria-label="something to install or update"></span>
          {/if}
        </button>
      {/each}
    </nav>

    <div class="pane settings-pane">
      {#if tab === 'general'}
        <GeneralTab
          {prefs}
          {home}
          {coordSample}
          {savePrefs}
          {saveHome}
          bind:proofPlaceAuto
        />
      {/if}

      {#if tab === 'publishing'}
        <PublishingTab
          {signature}
          {sigBust}
          {savePrefs}
          {removeSignature}
          {uploadSignature}
          bind:mention
          bind:postTarget
          bind:signatureHandle
          bind:sigInput
        />
      {/if}

      {#if tab === 'imagery'}
        <ImageryTab
          {KEYED}
          {keys}
          {usage}
          {month}
          {tiers}
          {tierEdits}
          {enabled}
          {overrides}
          {testResult}
          {testing}
          {ecoZooms}
          {load}
          {saveKey}
          {testKey}
          {saveProviderPrefs}
          {saveEcoZoom}
          {saveFreeTier}
          bind:eco
          bind:ecoMaxZoom
        />
      {/if}

      {#if tab === 'extension'}
        <ExtensionTab
          {about}
          {badges}
          {extDetected}
          {extOutdated}
          {ingestToken}
          {copyToken}
          {ensureToken}
          {rotateToken}
          bind:tokenShown
        />
      {/if}

      {#if tab === 'storage'}
        <StorageTab
          {about}
          {exportDirs}
          {EXPORT_KINDS}
          {importSettings}
          {resetExportDestination}
          bind:exportPickerKind
          bind:settingsFile
        />
      {/if}

      {#if tab === 'system'}
        <SystemTab
          {about}
          {ffmpeg}
          {badges}
          {appUpdate}
          {checkingApp}
          {checkAppUpdate}
          {scrapers}
          {checking}
          {checkScrapers}
          {updating}
          {updateScraper}
          {resetScraper}
          {savePrefs}
          {report}
          {loadReport}
          {refreshReport}
          {copyReport}
          {REPO_URL}
          {SITE_URL}
          bind:updateOnStart
          bind:reportKind
          bind:reportSummary
        />
      {/if}

      {#if tab === 'templates'}
        <TemplatesTab {newTemplate} {editTemplate} bind:deleteTpl />
      {/if}
    </div>
  </div>
</div>


{#if exportPickerKind}
  <ExportFolderPicker
    kind={exportPickerKind}
    current={exportDirs[exportPickerKind]}
    onchosen={(path) => (exportDirs = { ...exportDirs, [exportPickerKind]: path })}
    onclose={() => (exportPickerKind = null)}
  />
{/if}

{#if editing}
  <div class="tpl-modal-overlay" role="presentation"
    onclick={(e) => e.target === e.currentTarget && cancelEdit()}>
    <div class="tpl-modal">
      <div class="tpl-modal-head">
        <input class="tpl-title" type="text" placeholder="Template name"
          maxlength="120" bind:value={editing.name} />
        <button class="btn btn-ghost btn-sm" onclick={cancelEdit} aria-label="Close">
          <Icon name="x" size={16} />
        </button>
      </div>
      <div class="tpl-modal-body">
        {#if editing.kind === 'proof'}
          <ProofTemplateEditor bind:data={editing.data} />
        {:else}
          <PostTemplateEditor bind:data={editing.data} />
        {/if}
      </div>
      <div class="tpl-modal-foot">
        <button class="btn btn-ghost" onclick={cancelEdit}>Cancel</button>
        <button class="btn btn-primary" disabled={savingTpl} onclick={saveEditingTemplate}>
          <Icon name="save" size={14} /> {savingTpl ? 'Saving…' : 'Save template'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if deleteTpl}
  <ConfirmDialog
    title="Delete template"
    message={`Delete "${deleteTpl.name}"?`}
    detail="This preset is removed for every case. Proofs already made keep their style."
    confirmLabel="Delete"
    tone="danger"
    onconfirm={confirmDeleteTemplate}
    oncancel={() => (deleteTpl = null)}
  />
{/if}


<style>
  .tool {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .tool-header {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 14px 18px 10px;
  }

  .tool-header h2 {
    font-size: var(--fs-lg);
  }


  /* Settings use a section rail and one scrolling pane. */
  .split {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .rail {
    width: 168px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 4px 8px 8px 12px;
    border-right: 1px solid var(--border);
  }

  .rail-tab {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 10px;
    border: 0;
    border-radius: var(--r-md);
    background: none;
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
    transition: background 0.12s var(--ease), color 0.12s var(--ease);
  }

  .rail-tab:hover {
    background: var(--bg-2);
    color: var(--text-1);
  }

  .rail-tab.active {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }

  .rail-tab.rail-break {
    margin-top: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }


  .pane {
    flex: 1;
    overflow-y: auto;
    padding: 6px 18px 32px;
    max-width: 640px;
  }

  /* The path can be long, so the button sits after it and never squeezes it. */


  .tpl-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .tpl-modal {
    width: min(920px, 100%);
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--r-lg, 12px);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
  }

  .tpl-modal-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }

  .tpl-title {
    flex: 1;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-1);
    padding: 7px 10px;
    font: inherit;
    font-weight: 600;
  }

  .tpl-modal-body {
    padding: 16px;
    overflow-y: auto;
  }

  .tpl-modal-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 14px;
    border-top: 1px solid var(--border);
  }
</style>
