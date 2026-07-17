<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { toast, prefs, applyPrefs } from '../lib/state.svelte.js';
  import { formatCoords, parseHomeView } from '../lib/coords.js';
  import { formatDistance, formatArea } from '../lib/measure.js';
  import {
    monthCount,
    tilesOfFree,
    freeTierShare,
    usageBlocked,
    providerStatus,
    USAGE_LINKS,
    BLOCK_SHARE,
    ECO_MAX_ZOOM,
    FREE_TIER,
  } from '../lib/usage.js';
  import { probeKey, googleMapsLoadedKey } from '../lib/gmaps.js';
  import { extensionVersion } from '../lib/extBridge.js';
  import Icon from '../components/Icon.svelte';

  // Imagery and Usage were the same four objects seen from two rooms: the key
  // here, the meter it feeds there. One tab, one card per provider.
  const TABS = [
    { id: 'preferences', label: 'Preferences', icon: 'sliders' },
    { id: 'imagery', label: 'Imagery', icon: 'key' },
    { id: 'extension', label: 'Capture extension', icon: 'crop' },
    { id: 'about', label: 'About', icon: 'compass' },
  ];
  let tab = $state('preferences');

  const REPO_URL = 'https://github.com/OsintMeThat/azimut';
  const SITE_URL = 'https://osintmethat.com';

  // The keyed imagery providers the app knows how to light up (IMAGERY_PROVIDERS.md).
  // Keys are app-wide, stored locally in settings.json, never written into a
  // case folder or export bundle — they're the user's own billing identity.
  //
  // Each provider is one collapsed row until you open it: `gives` and `cost`
  // are all a closed card says, so the tab reads at a glance and only the
  // provider you're actually setting up spends any text. Everything below them
  // (`steps`, `warning`, `overage`) lives in the opened body — the nuance is
  // still here, it just isn't charged to the other three providers.
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
      overage:
        'Past the free tier Mapbox bills extra tiles automatically — pay-as-you-go, no hard cap. Set a spending alert in your Mapbox account.',
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
      overage:
        'Extra tiles are billed to your Cloud project, and Google also enforces 15k tiles/day. A quota cap in the Cloud Console makes it stop serving instead of billing.',
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
      // a JS key proves itself only in a browser — Test loads a real 1-tile map
      browserTest: true,
      steps: [
        'In the Google Cloud Console, enable the "Maps JavaScript API" on your project.',
        'Create an API key (Credentials) and restrict it to that API.',
        'Optional but recommended: restrict the key to your own referrers.',
      ],
      overage:
        'A map load is one widget instantiation (~10k free/month) — pan and zoom on an open map are free. Azimut builds the widget once per session and reuses it, so normal use stays far under the tier.',
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
        'Open it and turn Show logo and Show warnings OFF — both are burned into every tile.',
        'Copy the ID under "Service endpoints" and paste it here.',
      ],
      overage:
        'A free Copernicus account gets 30,000 requests and 30,000 processing units a month (one tile = 1 request = 1 PU; a date lookup is 1 request but ~0.01 PU) and simply stops serving until the 1st — it never bills you.',
      // the correction the free-allowance box exists for, told where it's useful
      tierNote:
        'Copernicus still documents 10,000 while provisioning 30,000, and the figure is per-account — check yours on the dashboard.',
    },
  ];

  /** A per-provider map over KEYED — the shape every key/pref state uses. */
  const perProvider = (value) => Object.fromEntries(KEYED.map((k) => [k.id, value(k)]));

  const COORD_CHOICES = [
    { id: 'dd', label: 'Decimal' },
    { id: 'dms', label: 'DMS' },
    { id: 'mgrs', label: 'MGRS' },
  ];
  const UNIT_CHOICES = [
    { id: 'metric', label: 'Metric' },
    { id: 'imperial', label: 'Imperial' },
  ];

  let keys = $state(perProvider(() => ''));
  let shown = $state(perProvider(() => false));
  // every card starts closed: four providers' worth of setup is four walls of
  // text, and you only ever set up one at a time
  let open = $state(perProvider(() => false));
  let termsOpen = $state(false);
  let usage = $state({});
  let month = $state('');
  let testing = $state(perProvider(() => false));
  let testResult = $state(perProvider(() => null)); // { ok, detail } | null
  // keyed-provider preferences (IMAGERY_PROVIDERS.md) — saved on toggle
  let enabled = $state(perProvider(() => true));
  let overrides = $state(perProvider(() => false));
  let eco = $state(true);
  let ecoMaxZoom = $state(ECO_MAX_ZOOM);
  // per-provider eco thresholds ('' = inherit, '0' = eco off for that basemap);
  // the Maps JS widget is absent — an eco swap would re-bill a map load
  let ecoZooms = $state(perProvider(() => ''));
  // The account's real monthly allowance per meter ('' = the shipped default).
  // A free tier belongs to the provider's account, not to us: they hand out
  // more than they document and change it silently (Copernicus documents 10k
  // and provisions 30k), so the number the counter and the soft block measure
  // against has to be the user's to correct. `tiers` is the resolved figure the
  // helpers read; `tierEdits` is what's in the boxes.
  let tiers = $state(null);
  let tierEdits = $state(perProvider(() => ''));
  let about = $state({ version: '', workspace_root: '' });

  // --- capture extension: pairing token + detection (lib/extBridge.js) ---
  let ingestToken = $state('');
  let tokenShown = $state(false);
  // read once per mount: the marker is stamped before the app loads, so a
  // mid-session install genuinely needs a tab reload (the text says so)
  const extDetected = extensionVersion();

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(ingestToken);
      toast('Pairing token copied', 'ok');
    } catch {
      tokenShown = true; // clipboard blocked — show it for manual copy
      toast('Could not copy — the token is shown for manual copy', 'warn');
    }
  }

  async function rotateToken() {
    const r = await api.post('/api/settings/ingest-token/rotate');
    ingestToken = r.ingest_token;
    toast('New token minted — every paired extension must re-pair', 'ok', 6000);
  }
  // the home-view fields are edited as text, so a half-typed "-" or "48." isn't
  // fought by the number parser mid-keystroke; committed on change
  let home = $state({ lat: '', lon: '', zoom: '' });
  let mention = $state('');
  // the analyst's logo: app-wide like the API keys, and under the same rule —
  // it lives beside settings.json and only ever reaches a case as pixels in a
  // rendered proof PNG. `sigBust` re-fetches the <img> after a replace.
  let signature = $state(false);
  let sigBust = $state(0);
  let sigInput = $state(null);

  // The downloaders age faster than Azimut releases: sites change, and a stale
  // yt-dlp just stops finding media. They can be refreshed from PyPI in place,
  // without waiting for (or reinstalling) the app — see engine/scrapers.py.
  const SCRAPER_LABELS = { 'yt-dlp': 'yt-dlp', 'gallery-dl': 'gallery-dl' };
  let scrapers = $state([]);
  let checking = $state(false);
  let updating = $state({}); // { [dist]: true } while its request is in flight

  async function loadScrapers(check = false) {
    const path = check ? '/api/settings/scrapers?check=true' : '/api/settings/scrapers';
    scrapers = (await api.get(path)).scrapers;
  }

  // Opt-in, never on mount: Azimut is local-first, so opening Settings must not
  // phone out. The user asks, and only then do we look at PyPI.
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

  async function updateScraper(dist) {
    if (updating[dist]) return;
    updating[dist] = true;
    try {
      const r = await api.post(`/api/settings/scrapers/${dist}/update`);
      if (!r.ok) toast(`${dist}: ${r.detail}`, 'danger');
      else toast(`${dist} ${r.detail}`, r.restart_required ? 'warn' : 'ok');
      await loadScrapers();
      // keep the "restart to use it" state visible — a reload would drop it
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
      if (r.restart_required) toast(`${dist} reverted — restart Azimut to use it`, 'warn');
      else toast(`${dist} reverted to the bundled version`, 'ok');
    } catch (e) {
      toast(`${dist}: ${e.message}`, 'danger');
    }
  }

  async function load() {
    const s = await api.get('/api/settings');
    signature = !!s.signature;
    keys = perProvider((k) => s.api_keys[k.id] ?? '');
    usage = s.usage;
    month = s.month;
    enabled = perProvider((k) => s.providers_enabled[k.id] ?? true);
    overrides = perProvider((k) => !!s.usage_overrides[k.id]);
    // a stored verdict (key test, or a live auth failure) shows up like a
    // fresh test result — it's also what benches the basemap, so it must be
    // visible, not buried in settings.json
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
    about = { version: s.version ?? '', workspace_root: s.workspace_root ?? '' };
    ingestToken = s.ingest_token ?? '';
    home = { lat: String(s.home_view.lat), lon: String(s.home_view.lon), zoom: String(s.home_view.zoom) };
    mention = s.post_mention ?? '';
    applyPrefs(s); // the rest of the app reads these live
    await loadScrapers().catch(() => {}); // local disk read; never blocks Settings
  }

  // Every preference saves on change — no "Save" button to forget. The server's
  // answer is the source of truth, so clamped/normalised values show up here.
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
    // per-provider thresholds ride along: '' = inherit (server drops the
    // override on null), a number (0 included — eco off) sets it
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
    // echo back what the server stored — a point off the globe is refused there
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
    formatCoords(Number(home.lat) || 48.8584, Number(home.lon) || 2.2945, prefs.coordFormat)
  );

  onMount(() => {
    load().catch((e) => toast(`Could not load settings: ${e.message}`, 'danger'));
  });

  // Keys save on change like every other preference here — no Save button to
  // forget. The status chip flipping to "Untested" is the receipt, which beats
  // a toast: it also says what to do next.
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
            detail: 'Google Maps is already loaded with the previous key — reload the app (F5), then test',
          };
        } else {
          const url = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(keys[id].trim())}&v=weekly`;
          const { billed, ...verdict } = await probeKey(url);
          testResult[id] = verdict;
          // The probe is a real map load on the user's bill, and it happens in
          // this browser where no backend proxy can count it — report it, or
          // testing a key silently drifts the counter under Google's number.
          if (billed) await api.post(`/api/satellite/usage/${id}`).catch(() => {});
        }
        // persist the browser's verdict — it's what benches/unbenches the basemap
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
          class="rail-tab"
          class:active={tab === t.id}
          onclick={() => (tab = t.id)}
          aria-current={tab === t.id ? 'page' : undefined}
        >
          <Icon name={t.icon} size={15} />
          {t.label}
        </button>
      {/each}
    </nav>

    <div class="pane">
      {#if tab === 'preferences'}
        <section class="group">
          <h3>Coordinates</h3>
          <div class="row">
            <div class="row-label">
              <span>Format</span>
              <span class="row-hint">How every tool prints a latitude/longitude.</span>
            </div>
            <div class="seg" role="group" aria-label="Coordinate format">
              {#each COORD_CHOICES as c (c.id)}
                <button
                  class="seg-btn"
                  class:on={prefs.coordFormat === c.id}
                  onclick={() => savePrefs({ coord_format: c.id })}
                >{c.label}</button>
              {/each}
            </div>
          </div>
          <p class="sample mono">{coordSample}</p>
          <p class="note">
            Display only — captures, proofs and <span class="mono">case.json</span> always
            keep decimal degrees, so a case reads the same for everyone.
          </p>
        </section>

        <section class="group">
          <h3>Measurements</h3>
          <div class="row">
            <div class="row-label">
              <span>Units</span>
              <span class="row-hint">The Satellite ruler, area and readouts.</span>
            </div>
            <div class="seg" role="group" aria-label="Units">
              {#each UNIT_CHOICES as c (c.id)}
                <button
                  class="seg-btn"
                  class:on={prefs.units === c.id}
                  onclick={() => savePrefs({ units: c.id })}
                >{c.label}</button>
              {/each}
            </div>
          </div>
          <p class="sample mono">
            {formatDistance(1234, prefs.units)} · {formatArea(52000, prefs.units)}
          </p>
        </section>

        <section class="group">
          <h3>Satellite home view</h3>
          <p class="intro">
            Where the Satellite tab opens. A case artifact or a “go to coordinates”
            handoff still wins — this is only the starting point.
          </p>
          <div class="grid-3">
            <label class="field">
              <span>Latitude</span>
              <input class="input mono" bind:value={home.lat} onchange={saveHome} inputmode="decimal" spellcheck="false" />
            </label>
            <label class="field">
              <span>Longitude</span>
              <input class="input mono" bind:value={home.lon} onchange={saveHome} inputmode="decimal" spellcheck="false" />
            </label>
            <label class="field">
              <span>Zoom</span>
              <input class="input mono" bind:value={home.zoom} onchange={saveHome} type="number" min="1" max="21" />
            </label>
          </div>
        </section>

        <section class="group">
          <h3>Post composer</h3>
          <div class="row">
            <div class="row-label">
              <span>Default mention</span>
              <span class="row-hint">Pre-filled on a new draft. Leave empty for none.</span>
            </div>
            <input
              class="input mention"
              bind:value={mention}
              onchange={() => savePrefs({ post_mention: mention })}
              placeholder="@GeoConfirmed"
              spellcheck="false"
            />
          </div>
        </section>

        <section class="group">
          <h3>Signature</h3>
          <div class="row">
            <div class="row-label">
              <span>Your logo</span>
              <span class="row-hint">
                A transparent PNG, under 2 MB. Stays on this machine — the proof
                composer stamps it onto proofs you tick “Signature” on, and
                nothing else ever carries it.
              </span>
            </div>
            <div class="sig-side">
              {#if signature}
                <img class="sig-preview" src={`/api/settings/signature.png?v=${sigBust}`} alt="Your signature" />
              {/if}
              <div class="sig-buttons">
                <button class="btn btn-sm" onclick={() => sigInput?.click()}>
                  {signature ? 'Replace…' : 'Choose PNG…'}
                </button>
                {#if signature}
                  <button class="btn btn-danger btn-sm" onclick={removeSignature}>Remove</button>
                {/if}
              </div>
            </div>
            <input
              bind:this={sigInput}
              class="sig-file"
              type="file"
              accept="image/png"
              onchange={uploadSignature}
            />
          </div>
        </section>
      {/if}

      {#if tab === 'imagery'}
        <section class="group">
          <h3>Providers</h3>
          <p class="intro">
            Optional. The built-in basemaps (Esri, OSM, OpenTopoMap) never need a key — your own
            Mapbox / Google / Copernicus accounts just unlock extra ones in the Satellite tab.
            Keys stay in <span class="mono">settings.json</span> on this machine, never in a case
            or an export, and Azimut counts every request it sends so a free tier is never a
            surprise.
          </p>

          <div class="cards">
            {#each KEYED as k (k.id)}
              {@const count = monthCount(usage, k.id, month)}
              {@const share = freeTierShare(count, k.id, tiers)}
              {@const st = providerStatus({
                key: keys[k.id],
                enabled: enabled[k.id],
                status: testResult[k.id],
                count,
                meter: k.id,
                overrides,
                tiers,
              })}
              <div class="card" class:open={open[k.id]}>
                <div class="card-head">
                  <button
                    class="card-toggle"
                    onclick={() => (open[k.id] = !open[k.id])}
                    aria-expanded={open[k.id]}
                  >
                    <Icon name={open[k.id] ? 'chevronDown' : 'chevronRight'} size={13} />
                    <span class="card-name">{k.label}</span>
                    <span class="card-gives">{k.gives}</span>
                  </button>
                  <span
                    class="chip {st.tone}"
                    title={st.tone === 'bad' ? testResult[k.id]?.detail : undefined}
                  >{st.label}</span>
                  {#if keys[k.id]}
                    <input
                      class="card-enable"
                      type="checkbox"
                      bind:checked={enabled[k.id]}
                      onchange={saveProviderPrefs}
                      title="Show or hide this basemap in the Satellite tab — the key stays saved"
                      aria-label="Show {k.label} in the Satellite tab"
                    />
                  {/if}
                </div>

                <!-- one line either way: what it would cost, or what it has cost -->
                {#if keys[k.id] || count}
                  <div class="card-meter">
                    <div class="meter-track" aria-hidden="true">
                      <div
                        class="meter-fill"
                        class:hot={share >= BLOCK_SHARE}
                        style="width:{Math.min(share * 100, 100)}%"
                      ></div>
                    </div>
                    <span class="mono meter-read">{tilesOfFree(count, k.id, tiers)}</span>
                  </div>
                {:else if !open[k.id]}
                  <!-- open, the body's overage already leads with the cost -->
                  <p class="card-cost">{k.cost}</p>
                {/if}

                {#if open[k.id]}
                  <div class="card-body">
                    {#if k.warning}
                      <p class="key-warning"><Icon name="alert" size={12} /> {k.warning}</p>
                    {/if}
                    {#if k.steps}
                      <ol class="key-steps">
                        {#each k.steps as step (step)}
                          <li>{step}</li>
                        {/each}
                      </ol>
                    {/if}

                    <label class="key-label" for="key-{k.id}">
                      {k.field}
                      <a href={k.help} target="_blank" rel="noreferrer" title="How to get one">
                        how to get one <Icon name="external" size={11} />
                      </a>
                    </label>
                    <div class="key-line">
                      <input
                        id="key-{k.id}"
                        class="input"
                        type={shown[k.id] ? 'text' : 'password'}
                        placeholder={k.placeholder}
                        bind:value={keys[k.id]}
                        onchange={() => saveKey(k.id)}
                        autocomplete="off"
                        spellcheck="false"
                      />
                      <button
                        class="btn btn-ghost btn-sm"
                        onclick={() => (shown[k.id] = !shown[k.id])}
                        title={shown[k.id] ? 'Hide key' : 'Show key'}
                        aria-label={shown[k.id] ? 'Hide key' : 'Show key'}
                      >
                        <Icon name={shown[k.id] ? 'eyeOff' : 'eye'} size={14} />
                      </button>
                      <button
                        class="btn btn-sm"
                        onclick={() => testKey(k.id)}
                        disabled={testing[k.id] || !keys[k.id].trim()}
                        title="Exercise this key against the real service"
                      >
                        {testing[k.id] ? 'Testing…' : 'Test'}
                      </button>
                    </div>
                    {#if testResult[k.id] && !testResult[k.id].ok}
                      <p class="verdict bad">
                        <Icon name="alert" size={12} />
                        {testResult[k.id].detail}
                      </p>
                    {/if}

                    <p class="overage">{k.cost} — {k.overage}</p>

                    {#if keys[k.id] || count}
                      {#if usageBlocked(count, k.id, overrides, tiers)}
                        <p class="blocked">
                          <Icon name="alert" size={12} />
                          Paused at {Math.round(BLOCK_SHARE * 100)}% of the free tier — the map and
                          captures fall back to free imagery until next month, or:
                        </p>
                      {/if}
                      {#if share >= BLOCK_SHARE || overrides[k.id]}
                        <label
                          class="toggle override"
                          title="Serve past the pause — extra tiles are billed by the provider"
                        >
                          <input
                            type="checkbox"
                            bind:checked={overrides[k.id]}
                            onchange={saveProviderPrefs}
                          />
                          keep serving past {Math.round(BLOCK_SHARE * 100)}% (billed)
                        </label>
                      {/if}

                      <div class="card-controls">
                        <label
                          class="ctrl"
                          title={k.tierNote ??
                            "What this account's monthly free allowance really is — check the provider's dashboard"}
                        >
                          <span>Free allowance</span>
                          <input
                            class="input num mono"
                            type="number"
                            min="1"
                            step="1000"
                            placeholder={String(FREE_TIER[k.id] ?? '')}
                            bind:value={tierEdits[k.id]}
                            onchange={saveFreeTier}
                          />
                          <span class="ctrl-note">
                            {tierEdits[k.id].trim() === ''
                              ? 'blank = the documented default'
                              : `default is ${(FREE_TIER[k.id] ?? 0).toLocaleString('en-US')}`}
                          </span>
                        </label>

                        {#if k.browserTest}
                          <p class="ctrl-note">
                            No eco mode: swapping the widget out and back would bill a fresh map load.
                          </p>
                        {:else}
                          <label
                            class="ctrl"
                            title="Own threshold for this basemap — blank inherits the global one, 0 turns eco off for it"
                          >
                            <span>Eco below z ≤</span>
                            <input
                              class="input num mono"
                              type="number"
                              min="0"
                              max="21"
                              placeholder={k.id === 'sentinelhub' ? '11' : String(ecoMaxZoom)}
                              bind:value={ecoZooms[k.id]}
                              onchange={saveEcoZoom}
                              disabled={!eco}
                              aria-label="Eco threshold for {k.label}"
                            />
                            <span class="ctrl-note">
                              {k.id === 'sentinelhub'
                                ? 'blank = 11 (it caps at z14)'
                                : 'blank = the global threshold'}
                            </span>
                          </label>
                        {/if}
                      </div>

                      <a class="card-link" href={k.usage} target="_blank" rel="noreferrer">
                        {k.label} usage & limits <Icon name="external" size={11} />
                      </a>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>

          <div class="cards-foot">
            <span class="row-hint">Counters for {month} — local bookkeeping, never sent anywhere.</span>
            <button class="btn btn-ghost btn-sm" onclick={() => load()} title="Refresh counters">
              <Icon name="reset" size={13} /> Refresh
            </button>
          </div>
        </section>

        <section class="group">
          <h3>Eco mode</h3>
          <label
            class="toggle eco"
            title="Zoomed out this far, billed basemaps silently swap to free imagery — paid detail only matters up close"
          >
            <input type="checkbox" bind:checked={eco} onchange={saveEcoZoom} />
            Use free imagery when zoomed out, up to z ≤
            <input
              class="input num mono"
              type="number"
              min="1"
              max="21"
              bind:value={ecoMaxZoom}
              onchange={saveEcoZoom}
              disabled={!eco}
              aria-label="Eco mode zoom threshold"
            />
          </label>
          <p class="note">
            Paid detail only matters up close. Each provider can override this from its card.
          </p>
        </section>

        <section class="group">
          <div class="card">
            <div class="card-head">
              <button
                class="card-toggle"
                onclick={() => (termsOpen = !termsOpen)}
                aria-expanded={termsOpen}
              >
                <Icon name={termsOpen ? 'chevronDown' : 'chevronRight'} size={13} />
                <span class="card-name">Provider terms</span>
                <span class="card-gives">Encoded — nothing to do</span>
              </button>
            </div>
            {#if termsOpen}
              <ul class="rules">
                <li>Google tiles are never cached to disk, and a Google capture is a flattened screenshot with the copyright line burned into its footer; both are conditions of Google's Map Tiles API terms.</li>
                <li>Mapbox captures keep the © Mapbox © OpenStreetMap attribution in their provenance.</li>
                <li>Keys are never bundled into a shared case or export.</li>
              </ul>
            {/if}
          </div>
        </section>
      {/if}

      {#if tab === 'extension'}
        <section class="group">
          <h3>Capture extension</h3>
          <p class="note">
            A small browser extension (Chrome/Edge and Firefox) that files the map you
            are looking at into Azimut as a capture — one screenshot per click,
            coordinates parsed from the page URL, source and timestamp recorded. It
            serves two things: <strong>capturing external map sites</strong> (Google
            Maps &amp; Earth, Bing, Yandex, OpenStreetMap, Apple Maps, Zoom Earth,
            Satellites.pro), and the <strong>Capture button on the Google (Maps JS)
            basemap</strong>, whose imagery may only leave the widget as a screenshot.
          </p>
          <div class="row">
            <div class="row-label">
              <span>Status in this browser</span>
              <span class="row-hint">
                {#if extDetected}
                  detected · <span class="mono">v{extDetected}</span>
                {:else}
                  not detected — after installing, reload this tab
                {/if}
              </span>
            </div>
            <a class="btn btn-sm btn-primary" href="/api/ingest/extension.zip" download>
              <Icon name="download" size={13} /> Download extension (.zip)
            </a>
          </div>
          <p class="note">
            Browsers do not let an app install extensions for you — it's two manual
            steps, once: <strong>Chrome/Edge</strong>: unzip somewhere permanent →
            <span class="mono">chrome://extensions</span> → enable Developer mode →
            "Load unpacked" → pick the folder. <strong>Firefox</strong>:
            <span class="mono">about:debugging</span> → "This Firefox" → "Load
            Temporary Add-on" → pick <span class="mono">manifest.json</span> (Firefox
            forgets temporary add-ons on exit — see the README in the zip for a
            permanent install). Then reload this tab.
          </p>
        </section>

        <section class="group">
          <h3>Pairing</h3>
          <p class="note">
            Pairing lets the extension file captures from <em>external</em> map sites
            into your local Azimut. Paste this token once into the extension's
            options page. The Google (Maps JS) capture inside Azimut does not need
            pairing. Rotating the token instantly unpairs every extension.
          </p>
          <div class="row">
            <div class="row-label">
              <span>Pairing token</span>
              <span class="row-hint mono">{tokenShown ? ingestToken : '•'.repeat(24)}</span>
            </div>
            <div class="scraper-actions">
              <button class="btn btn-sm" onclick={() => (tokenShown = !tokenShown)}>
                {tokenShown ? 'Hide' : 'Show'}
              </button>
              <button class="btn btn-sm btn-primary" onclick={copyToken}>
                <Icon name="copy" size={13} /> Copy
              </button>
              <button class="btn btn-sm" onclick={rotateToken}>Rotate</button>
            </div>
          </div>
          <p class="note">
            The token only authorizes filing captures into this Azimut on
            <span class="mono">127.0.0.1</span> — nothing leaves your machine. The
            extension takes one screenshot per explicit click, reads only the page
            URL, and refuses non-map sites.
          </p>
        </section>
      {/if}

      {#if tab === 'about'}
        <section class="group">
          <h3>Azimut</h3>
          <dl class="facts">
            <dt>Version</dt>
            <dd class="mono">{about.version || '—'}</dd>
            <dt>Workspace</dt>
            <dd class="mono">{about.workspace_root || '—'}</dd>
            <dt>License</dt>
            <dd>AGPL-3.0-or-later</dd>
          </dl>
          <p class="note">
            The workspace is a plain folder: cases, media and proofs are files you can
            zip, back up or put under git. No account, no telemetry, no upload — network
            access only happens when a tool inherently needs it (map tiles, geocoding,
            media download), always directly to the third party.
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
          <h3>Downloaders</h3>
          <p class="note">
            Media download leans on two projects that track sites as they change. They
            age faster than Azimut does — if a link stops resolving, update these first.
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
                  class="btn btn-sm"
                  class:btn-primary={s.outdated}
                  disabled={updating[s.dist]}
                  onclick={() => updateScraper(s.dist)}
                >
                  {updating[s.dist] ? 'Updating…' : 'Update'}
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
            Checking and updating are the only things here that use the network, and only
            when you press them — the newest release is fetched from PyPI into your
            workspace, verified against the hash PyPI publishes, and used instead of the
            bundled copy. <strong>Revert</strong> goes back to the version this build
            shipped with, if an update ever makes things worse.
          </p>
        </section>
      {/if}
    </div>
  </div>
</div>

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
  .sub {
    color: var(--text-3);
    font-size: var(--fs-sm);
  }

  /* a preferences window, not a dashboard: a rail of sections on the left,
     one flat scrolling pane on the right — no cards, no boxes */
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

  .pane {
    flex: 1;
    overflow-y: auto;
    padding: 6px 18px 32px;
    max-width: 640px;
  }
  .group {
    padding: 14px 0 18px;
    border-bottom: 1px solid var(--border);
  }
  .group:last-child {
    border-bottom: 0;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-3);
    margin-bottom: 12px;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 8px;
  }
  .row-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--fs-sm);
    color: var(--text-1);
  }
  .row-hint {
    color: var(--text-3);
    font-size: var(--fs-xs);
    line-height: 1.4;
  }
  /* Recipe for a provider whose "key" is a configuration you build yourself */
  .key-steps {
    margin: 4px 0 8px;
    padding-left: 18px;
    color: var(--text-3);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }
  .key-steps li {
    margin: 1px 0;
  }
  .key-warning {
    display: flex;
    align-items: baseline;
    gap: 5px;
    margin: 4px 0 8px;
    color: var(--warn, #d8a03d);
    font-size: var(--fs-xs);
    line-height: 1.45;
  }
  .scraper-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  /* the one state worth pulling the eye: this downloader will fail on real links */
  .stale {
    color: var(--warn, var(--text-1));
    font-weight: 500;
  }
  .sig-side {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .sig-preview {
    /* checkerboard: a logo is meant to be transparent — show whether it is */
    max-width: 88px;
    max-height: 44px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background-color: var(--bg-2);
    background-image:
      linear-gradient(45deg, var(--bg-3) 25%, transparent 25% 75%, var(--bg-3) 75%),
      linear-gradient(45deg, var(--bg-3) 25%, transparent 25% 75%, var(--bg-3) 75%);
    background-size: 10px 10px;
    background-position: 0 0, 5px 5px;
  }
  .sig-buttons {
    display: flex;
    gap: 6px;
  }
  .sig-file {
    display: none;
  }

  /* segmented control — one row of mutually exclusive choices */
  .seg {
    display: flex;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    overflow: hidden;
  }
  .seg-btn {
    padding: 5px 12px;
    border: 0;
    border-left: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-xs);
    cursor: pointer;
    transition: background 0.12s var(--ease), color 0.12s var(--ease);
  }
  .seg-btn:first-child {
    border-left: 0;
  }
  .seg-btn:hover {
    background: var(--bg-3);
    color: var(--text-1);
  }
  .seg-btn.on {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }

  .sample {
    color: var(--text-2);
    font-size: var(--fs-sm);
    padding: 6px 9px;
    border-radius: var(--r-sm);
    background: var(--bg-2);
    border: 1px solid var(--border);
    display: inline-block;
    margin-top: 4px;
  }
  .note {
    color: var(--text-3);
    font-size: var(--fs-xs);
    line-height: 1.5;
    margin-top: 8px;
  }
  /* same voice as .note, but leading a group instead of trailing one */
  .intro {
    color: var(--text-3);
    font-size: var(--fs-xs);
    line-height: 1.5;
    margin: 0 0 14px;
  }

  .grid-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 90px;
    gap: 10px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    font-weight: 600;
  }
  .mention {
    width: 200px;
    flex-shrink: 0;
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
  .links {
    display: flex;
    gap: 8px;
    margin-top: 14px;
    flex-wrap: wrap;
  }
  .links .btn {
    gap: 6px;
    text-decoration: none;
  }

  /* --- provider cards: one row each until you open one --------------------
     A closed card answers the only two questions you have from across the
     room — what does it give me, and is it working — in one line. Setting a
     provider up is the rare act; reading the tab is the common one. */
  .cards {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .card {
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    padding: 8px 10px;
    background: var(--bg-2);
    transition: border-color 0.12s var(--ease);
  }
  .card.open {
    border-color: var(--text-3);
    background: none;
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .card-toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-3);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .card-name {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-1);
    flex-shrink: 0;
  }
  .card-gives {
    font-size: var(--fs-xs);
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-enable {
    accent-color: var(--accent);
    margin: 0;
    flex-shrink: 0;
    cursor: pointer;
  }
  /* the verdict, in one word — the detail is a tooltip, and the fix is inside */
  .chip {
    flex-shrink: 0;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: var(--fs-xs);
    color: var(--text-3);
    white-space: nowrap;
  }
  .chip.ok {
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 40%, transparent);
  }
  .chip.bad {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  }
  .chip.warn {
    color: var(--warn, #d8a03d);
    border-color: color-mix(in srgb, var(--warn, #d8a03d) 40%, transparent);
  }
  .card-meter {
    display: flex;
    align-items: center;
    gap: 9px;
    margin: 7px 0 1px;
  }
  .card-meter .meter-track {
    flex: 1;
  }
  .meter-read,
  .card-cost {
    font-size: var(--fs-xs);
    color: var(--text-3);
    white-space: nowrap;
  }
  .card-cost {
    margin: 5px 0 1px 21px; /* aligned under the name, past the chevron */
  }
  .card-body {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .card-controls {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-top: 9px;
  }
  .ctrl {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  /* both control rows put their box at the same x — they read as a column */
  .ctrl > span:first-child {
    min-width: 104px;
    color: var(--text-2);
  }
  .ctrl-note {
    opacity: 0.8;
  }
  .card-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: 10px;
    color: var(--accent);
    font-size: var(--fs-xs);
  }
  .cards-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 12px;
  }
  .key-label {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    font-weight: 600;
    margin-bottom: 5px;
  }
  .key-label a {
    color: var(--accent);
    font-weight: 400;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .key-line {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .key-line .input {
    flex: 1;
    font-family: var(--font-mono);
  }
  .verdict {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 5px;
    font-size: var(--fs-xs);
    line-height: 1.4;
  }
  .verdict.bad {
    color: var(--danger);
  }
  .meter-track {
    height: 5px;
    border-radius: var(--r-sm);
    background: var(--bg-2);
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .meter-fill {
    height: 100%;
    background: var(--accent);
    border-radius: inherit;
    transition: width 0.3s var(--ease);
  }
  .meter-fill.hot {
    background: var(--danger);
  }
  .overage {
    margin-top: 9px;
    color: var(--text-3);
    font-size: var(--fs-xs);
    line-height: 1.45;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    cursor: pointer;
    user-select: none;
  }
  .toggle input {
    accent-color: var(--accent);
    margin: 0;
  }
  .toggle.override {
    margin-top: 6px;
    color: var(--danger);
  }
  .toggle.eco {
    display: flex;
    margin: 2px 0;
  }
  /* every small numeric box in this tab: eco thresholds, free allowances */
  .num {
    width: 92px;
    padding: 2px 6px;
    flex-shrink: 0;
  }
  .blocked {
    margin-top: 6px;
    color: var(--danger);
    font-size: var(--fs-xs);
    display: flex;
    align-items: center;
    gap: 5px;
    line-height: 1.4;
  }
  .rules {
    margin: 12px 0 2px;
    padding-left: 18px;
    color: var(--text-2);
    font-size: var(--fs-xs);
    display: flex;
    flex-direction: column;
    gap: 6px;
    line-height: 1.45;
  }
</style>
