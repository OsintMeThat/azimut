import { expect } from '@playwright/test';

export const CASE_ID = 'browser-test';
export const PANEL_PATH = 'media/panel.svg';

const PANEL_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
    <rect width="640" height="360" fill="#304b65"/>
    <path d="M0 300L180 150L300 250L450 90L640 280V360H0Z" fill="#6c8f55"/>
    <circle cx="520" cy="76" r="34" fill="#f4c95d"/>
  </svg>`;

const TILE_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <rect width="256" height="256" fill="#243747"/>
    <path d="M0 190L70 120L140 175L210 80L256 140V256H0Z" fill="#4f7047"/>
  </svg>`;

const media = [{
  path: PANEL_PATH,
  filename: 'panel.svg',
  kind: 'image',
  width: 640,
  height: 360,
  size: 256,
  sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  source: { type: 'upload' },
  thumbnail: null,
  thumb_state: 'ready',
  enrich_state: 'ready',
  folder: '',
  notes: '',
}];

// Saved work as the Map panel reads it (GET /satellite/index). Empty by
// default: each spec that needs saved items overrides this route itself.
const savedIndex = [];

const caseOverview = {
  id: CASE_ID,
  name: 'Browser Test',
  scratch: false,
  entities: [],
  links: [],
  folders: [],
};

const settings = {
  coord_format: 'dd',
  units: 'metric',
  home_view: { lat: 48.8584, lon: 2.2945, zoom: 16 },
  post_mention: '@GeoConfirmed',
  post_target: 'x',
  signature_handle: '',
  signature: false,
  export_dirs: { notes: '', media: '', proofs: '' },
  api_keys: {},
  providers_enabled: {},
  free_tiers: {},
  eco_max_zooms: {},
  provider_status: {},
  ingest_token: '',
  version: '0.2.7',
  workspace_root: '/tmp/azimut-browser-fixture',
  extension_version: '0.2.7',
  update_check_on_start: false,
  update_dismissed_version: '',
  usage: {},
  usage_overrides: {},
  eco_zoom_fallback: true,
  eco_max_zoom: 15,
  free_tier: {},
  month: '2026-07',
};

// A workspace that is present and nobody else's, so the app runs instead of
// showing the stopped screen (GET /settings/workspace), and no folder in it is
// waiting to become a case (GET /workspace/folders).
const workspaceStatus = {
  locked_by: null,
  locked_detail: '',
  root: '/tmp/azimut-browser-fixture',
  default_root: '/tmp/azimut-browser-fixture',
  pointed: false,
  environment: false,
  missing: false,
  moving: false,
  cases: 1,
  move: null,
};
const workspaceFolders = [];

// The relation vocabulary slice exercised by browser specs. Keep endpoint and
// action metadata exact: a stale action can make an E2E test prove the opposite
// of the production contract.
export const relationTypes = [
  { type: 'located-at', label: 'was recorded at', inverse_label: 'was recorded here', hint: 'where the photo, video or audio was recorded', group: '', action: 'relation', from_types: ['media'], to_types: ['place'], from_media_kinds: ['audio', 'image', 'video'], to_media_kinds: [], manual: true, ratable: true },
  { type: 'depicts', label: 'shows', inverse_label: 'is shown in', hint: 'the place is visible in the image or video', group: '', action: 'relation', from_types: ['capture', 'media'], to_types: ['place'], from_media_kinds: ['image', 'video'], to_media_kinds: [], manual: true, ratable: true },
  { type: 'owns', label: 'owns', inverse_label: 'is owned by', hint: 'ownership rather than use, access or operational control', group: '', action: 'relation', from_types: ['organization', 'person'], to_types: ['account', 'aircraft', 'domain', 'email', 'ip', 'network', 'organization', 'phone', 'structure', 'vehicle', 'vessel'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: true },
  { type: 'part-of', label: 'is part of', inverse_label: 'contains', hint: 'an internal unit inside its parent organization', group: '', action: 'relation', from_types: ['organization'], to_types: ['organization'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: true },
  { type: 'member-of', label: 'is a member of', inverse_label: 'has member', hint: 'membership rather than internal containment', group: '', action: 'relation', from_types: ['organization', 'person'], to_types: ['organization'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: true },
  { type: 'posted', label: 'posted', inverse_label: 'was posted by', hint: 'the account published the content or URL', group: '', action: 'relation', from_types: ['account'], to_types: ['bookmark', 'media'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: true },
  { type: 'appears-in', label: 'appears in', inverse_label: 'shows', hint: 'the entity or a recognizable representation is visible', group: '', action: 'relation', from_types: ['account', 'aircraft', 'domain', 'email', 'ip', 'network', 'organization', 'person', 'phone', 'structure', 'vehicle', 'vessel'], to_types: ['capture', 'media'], from_media_kinds: [], to_media_kinds: ['image', 'video'], manual: true, ratable: true },
  { type: 'sited-at', label: 'is sited at', inverse_label: 'is the site of', hint: 'a permanent site rather than a dated presence', group: '', action: 'relation', from_types: ['structure'], to_types: ['place'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: true },
  { type: 'in-network', label: 'is in network', inverse_label: 'contains', hint: 'the address or subnet belongs inside this network', group: '', action: 'relation', from_types: ['ip', 'network'], to_types: ['network'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: true },
  { type: 'same-image-as', label: 'is the same image as', inverse_label: 'is the same image as', hint: 'enrichment matched the perceptual hashes', group: '', action: 'relation', from_types: ['media'], to_types: ['media'], from_media_kinds: ['image'], to_media_kinds: ['image'], manual: false, ratable: false },
  { type: 'mentions', label: 'mentions', inverse_label: 'is mentioned by', hint: 'the document refers to the entity', group: 'Mentions', action: 'mention', from_types: ['bookmark', 'note', 'post', 'proof'], to_types: ['account', 'aircraft', 'bookmark', 'capture', 'claim', 'domain', 'email', 'inspect-session', 'ip', 'media', 'network', 'note', 'organization', 'person', 'phone', 'place', 'post', 'proof', 'structure', 'vehicle', 'vessel'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: false },
  { type: 'about', label: 'is about', inverse_label: 'has claim', hint: 'what the statement concerns', group: '', action: 'claim', from_types: ['claim'], to_types: ['account', 'aircraft', 'capture', 'domain', 'email', 'ip', 'media', 'network', 'organization', 'person', 'phone', 'place', 'structure', 'vehicle', 'vessel'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: false },
  { type: 'at', label: 'places it at', inverse_label: 'is a claim location', hint: 'where the statement places its subject or event', group: '', action: 'claim', from_types: ['claim'], to_types: ['place'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: false },
  { type: 'cites', label: 'cites', inverse_label: 'supports claim', hint: 'the evidence the statement relies on', group: '', action: 'claim', from_types: ['claim'], to_types: ['bookmark', 'capture', 'media', 'note', 'proof'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: false },
];

// How sure an edge may say the analyst is. Served beside the verbs, and absent from
// this list is "not assessed" — the lack of a rating, never a level.
const confidenceLevels = [
  { value: 3, label: 'Certain', hint: 'established and corroborated' },
  { value: 2, label: 'Probable', hint: 'more likely than not, and short of established' },
  { value: 1, label: 'Possible', hint: 'roughly even odds, and it cannot be excluded' },
  { value: -1, label: 'Ruled out', hint: 'checked and eliminated' },
];

// The entity-vocabulary slice exercised by browser specs: what each used type reads
// as, its family, icon and generated fields. Backend contract tests cover the full
// registry; a browser spec adds a row here when it needs to render that type.
const entityTypes = [
  {
    type: 'person', label: 'Person', family: 'actor', icon: 'user', manual: true, group: '',
    identity_label: 'Full name', identity_placeholder: 'Name or known alias',
    hint: 'a named individual', family_reads: 'a person or organization that can act or hold ownership',
    attrs: [
      { key: 'aliases', label: 'Other names', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
      { key: 'role', label: 'Role', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
      { key: 'nationality', label: 'Nationality', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
    ],
  },
  {
    type: 'organization', label: 'Organization', family: 'actor', icon: 'layers', manual: true, group: '',
    identity_label: 'Organization name', identity_placeholder: 'Name of the organization',
    hint: 'a company, a ministry or a military unit', family_reads: 'a person or organization that can act or hold ownership',
    attrs: [],
  },
  {
    type: 'vehicle', label: 'Vehicle', family: 'asset', icon: 'grip', manual: true, group: '',
    identity_label: 'Vehicle name', identity_placeholder: 'How this vehicle is known',
    hint: 'one particular vehicle, not a model', family_reads: 'a thing that is owned or appears in footage',
    attrs: [
      { key: 'plate', label: 'Plate', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
      { key: 'make', label: 'Make', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
      { key: 'model', label: 'Model', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
      { key: 'colour', label: 'Colour', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
    ],
  },
  {
    type: 'ip', label: 'IP address', family: 'identifier', icon: 'hash', manual: true, group: '',
    identity_label: 'IP address', identity_placeholder: '203.0.113.42',
    hint: 'an address, which is its own identity', family_reads: 'a handle on a system, where the value is the identity',
    attrs: [
      { key: 'network', label: 'Legacy network', hint: 'older free text, replaced by the In network relation', kind: 'text', editable: false, rungs: [], options: [], minimum: null, maximum: null },
      { key: 'asn', label: 'ASN', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
      { key: 'provider', label: 'Provider', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
    ],
  },
  {
    type: 'network', label: 'Network', family: 'identifier', icon: 'globe', manual: true, group: '',
    identity_label: 'Network or CIDR', identity_placeholder: '203.0.113.0/24',
    hint: 'an IP range, named by its network or CIDR', family_reads: 'a handle on a system, where the value is the identity',
    attrs: [
      { key: 'asn', label: 'ASN', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
      { key: 'provider', label: 'Provider', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
      { key: 'country', label: 'Country', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
    ],
  },
  {
    type: 'claim', label: 'Claim', family: 'claim', icon: 'note', manual: true, group: 'Reasoning',
    hint: 'something you are saying about the case',
    identity_label: 'Statement', identity_placeholder: 'What are you asserting?',
    family_reads: 'a statement about the rest of the case, carrying its own reasoning',
    attrs: [
      { key: 'confidence', label: 'Confidence', hint: 'how strongly the statement is supported', kind: 'choice', rungs: [], options: [{ value: 'certain', label: 'Certain' }, { value: 'probable', label: 'Probable' }, { value: 'possible', label: 'Possible' }, { value: 'refuted', label: 'Ruled out' }], minimum: null, maximum: null },
      { key: 'method', label: 'How this was worked out', hint: 'the reasoning a reader would need to check this', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
      { key: 'verbatim', label: 'As the source put it', hint: 'the original wording, quoted rather than paraphrased', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
    ],
  },
  { type: 'media', label: 'Media', family: 'collected', icon: 'image', manual: false, group: '', hint: 'a file the case collected', family_reads: 'bytes gathered into the case rather than written', attrs: [] },
  { type: 'capture', label: 'Capture', family: 'collected', icon: 'satellite', manual: false, group: '', hint: 'a map screenshot', family_reads: 'bytes gathered into the case rather than written', attrs: [] },
  { type: 'place', label: 'Place', family: 'place', icon: 'pin', manual: false, group: 'How precise', hint: 'a saved point', family_reads: 'a point on the map, never a thing standing on it', attrs: [] },
  { type: 'note', label: 'Note', family: 'document', icon: 'note', manual: false, group: '', hint: 'a Markdown page in the case notebook', family_reads: 'something read rather than gathered', attrs: [] },
  {
    type: 'bookmark', label: 'Bookmark', family: 'document', icon: 'globe', manual: false, group: '',
    hint: 'a page the case points at',
    family_reads: 'something read rather than gathered, made or merely consulted',
    attrs: [
      { key: 'archive_url', label: 'Archived copy', hint: 'a snapshot that survives the page being taken down', kind: 'url', rungs: [], options: [], minimum: null, maximum: null },
      {
        key: 'reliability', label: 'Source reliability', kind: 'choice', rungs: [], minimum: null, maximum: null,
        hint: 'how much this source is worth in general, never how sure one claim is',
        options: [
          { value: 'A', label: 'Completely reliable' },
          { value: 'B', label: 'Usually reliable' },
        ],
      },
    ],
  },
];

const providers = [{
  id: 'esri-world-imagery',
  label: 'Esri World Imagery',
  url: 'https://tiles.invalid/{z}/{x}/{y}.png',
  attribution: 'Browser fixture',
  max_zoom: 19,
  tile_size: 256,
  oversample: 1,
  imagery: true,
  capturable: true,
}];

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Run the real Svelte, Konva and Leaflet code while replacing only Azimut's
 * local API and files with deterministic fixtures. Any unexpected request is
 * recorded so a passing interaction test cannot silently depend on the network.
 */
export async function installAppFixture(page, options = {}) {
  const unexpected = [];
  const captures = [];
  const proofSaves = [];
  const fixtureSavedIndex = options.savedIndex ?? savedIndex;
  const fixtureProofIndex = options.proofIndex ?? [];
  const fixtureCases = options.cases ?? [caseOverview];
  const fixtureSavedIndexes = options.savedIndexes ?? { [CASE_ID]: fixtureSavedIndex };
  const fixtureProofIndexes = options.proofIndexes ?? { [CASE_ID]: fixtureProofIndex };
  const savedIndexDelays = options.savedIndexDelays ?? {};
  const proofIndexDelays = options.proofIndexDelays ?? {};
  const fixtureDrafts = options.drafts ?? {};
  const fixtureSettings = {
    ...settings,
    export_dirs: { ...settings.export_dirs, ...(options.exportDirs ?? {}) },
  };
  const settingsWrites = [];
  const folderWrites = [];
  const exportWrites = [];
  const fixtureFolderRoots = options.folderRoots ?? [];
  const fixtureFolderViews = { ...(options.folderViews ?? {}) };
  const fixtureLookupEntities = options.lookupEntities ?? {};
  const trashGroups = [...(options.trashGroups ?? [])];
  const trashWrites = [];
  const bundleCalls = [];
  const bundlePreview = options.bundlePreview;
  const bundleJob = options.bundleJob ?? { state: 'ready' };
  // Relations, keyed by entity id: what the bounded chain endpoint answers for
  // the row whose relations a surface asked for.
  const fixtureChains = options.chains ?? {};
  const linkWrites = [];
  // What the bounded catalog holds, and what the board asked it for. Copied rather
  // than held by reference: a spec's `catalog` is a module constant shared by every
  // test in the file, and confirming or dismissing a row writes to this one.
  const fixtureCatalog = (options.catalog ?? []).map((entity) => ({
    ...entity,
    provenance: { ...entity.provenance },
  }));
  const catalogQueries = [];
  const entityWrites = [];
  const uploads = [];
  const revealed = [];

  await page.addInitScript((caseId) => {
    localStorage.setItem('azimut:lastCase', caseId);
    localStorage.setItem('azimut:theme', 'dark');
  }, CASE_ID);

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (url.hostname !== '127.0.0.1') {
      unexpected.push(`${request.method()} ${request.url()}`);
      return route.abort('blockedbyclient');
    }

    if (path.startsWith('/@') || path.startsWith('/src/') || path.startsWith('/node_modules/') ||
        path === '/' || path === '/index.html' || path === '/favicon.svg') {
      return route.continue();
    }

    if (path === `/files/${CASE_ID}/${PANEL_PATH}`) {
      return route.fulfill({ contentType: 'image/svg+xml', body: PANEL_SVG });
    }
    if (path.startsWith('/api/tiles/')) {
      return route.fulfill({ contentType: 'image/svg+xml', body: TILE_SVG });
    }
    if (path === '/api/events') {
      return route.fulfill({ contentType: 'text/event-stream', body: '' });
    }
    if (path === '/api/settings/signature.png') {
      return route.fulfill({ status: 404, body: '' });
    }
    if (path === '/api/settings') return json(route, fixtureSettings);
    if (path === '/api/settings/prefs' && request.method() === 'PUT') {
      const payload = request.postDataJSON();
      const previousExportDirs = fixtureSettings.export_dirs;
      settingsWrites.push(payload);
      Object.assign(fixtureSettings, payload);
      if (payload.export_dirs) {
        fixtureSettings.export_dirs = { ...previousExportDirs, ...payload.export_dirs };
      }
      return json(route, fixtureSettings);
    }
    if (path === '/api/folders/roots') return json(route, { roots: fixtureFolderRoots });
    if (path === '/api/folders') {
      const wanted = url.searchParams.get('path');
      const view = fixtureFolderViews[wanted];
      return view ? json(route, view) : json(route, { detail: 'Folder not found' }, 404);
    }
    if (path === '/api/folders/create' && request.method() === 'POST') {
      const payload = request.postDataJSON();
      const separator = payload.parent.endsWith('/') ? '' : '/';
      const made = `${payload.parent}${separator}${payload.name}`;
      folderWrites.push({ ...payload, path: made });
      fixtureFolderViews[made] = {
        path: made,
        name: payload.name,
        parent: payload.parent,
        crumbs: [{ name: payload.name, path: made }],
        folders: [],
        truncated: false,
        writable: true,
      };
      return json(route, { name: payload.name, path: made });
    }
    if (path === '/api/settings/scrapers') return json(route, { scrapers: [] });
    if (path === '/api/settings/ffmpeg') {
      return json(route, { available: true, version: 'fixture', source: 'bundled', path: '/tmp/ffmpeg' });
    }
    if (path === '/api/settings/diagnostics') {
      return json(route, { kind: 'bug', title: 'Issue', report: 'Fixture report', url: 'https://example.invalid/issue' });
    }
    // Asked on mount, before any tool: the app has to know the workspace is
    // there and whether a folder in it is still waiting to become a case.
    if (path === '/api/settings/workspace') return json(route, workspaceStatus);
    if (path === '/api/workspace/folders') return json(route, workspaceFolders);
    if (path === '/api/templates') return json(route, { proof: [], post: [] });
    if (path === '/api/cases/relation-types') return json(route, relationTypes);
    if (path === '/api/cases/confidence-levels') return json(route, confidenceLevels);
    if (path === '/api/cases/entity-types') return json(route, entityTypes);
    if (path === '/api/cases/bundles/inspect' && request.method() === 'POST') {
      bundleCalls.push({ kind: 'inspect' });
      return json(route, bundlePreview ?? { detail: 'No bundle fixture' }, bundlePreview ? 200 : 400);
    }
    if (path === '/api/cases') {
      return json(route, fixtureCases.map((item) => ({ entity_count: 1, ...item })));
    }
    const overview = fixtureCases.find((item) => path === `/api/cases/${item.id}`);
    if (overview) return json(route, overview);
    const caseId = fixtureCases.find((item) => path.startsWith(`/api/cases/${item.id}/`))?.id;
    if (caseId && path === `/api/cases/${caseId}/satellite/index`) {
      if (savedIndexDelays[caseId]) {
        await new Promise((resolve) => setTimeout(resolve, savedIndexDelays[caseId]));
      }
      return json(route, fixtureSavedIndexes[caseId] ?? []);
    }
    if (caseId && path === `/api/cases/${caseId}/proofs/index`) {
      if (proofIndexDelays[caseId]) {
        await new Promise((resolve) => setTimeout(resolve, proofIndexDelays[caseId]));
      }
      return json(route, fixtureProofIndexes[caseId] ?? []);
    }
    if (caseId && path === `/api/cases/${caseId}/catalog/summary`) {
      // The count the surface shows when nothing is filtered, so it has to be the
      // catalog's own size rather than a fixed 1 — otherwise "Showing 2 of 1".
      return json(route, {
        total: fixtureCatalog.length || 1,
        by_type: { media: 1 },
        by_status: { confirmed: 1 },
        by_folder: {},
      });
    }
    if (caseId && path === `/api/cases/${caseId}/catalog/entities`) {
      // Filtered here rather than returned whole, so a spec can prove the surface
      // asked the server to narrow instead of hiding rows it had already loaded.
      const wanted = (url.searchParams.get('type') ?? '').split(',').filter(Boolean);
      const term = (url.searchParams.get('q') ?? '').toLowerCase();
      const status = url.searchParams.get('status') ?? '';
      const matching = fixtureCatalog.filter(
        (entity) =>
          (!wanted.length || wanted.includes(entity.type)) &&
          (!status || entity.provenance?.status === status) &&
          (!term || (entity.label ?? '').toLowerCase().includes(term))
      );
      catalogQueries.push(url.search);
      // `catalogPage` makes the fixture answer in pages, which is the only way to
      // reach the surface's server-search mode: a case that fits one page filters
      // in the browser and never asks a second question.
      const page = options.catalogPage ?? 0;
      const items = page ? matching.slice(0, page) : matching;
      return json(route, {
        items,
        next_cursor: page && matching.length > page ? 'cursor-2' : null,
        total: matching.length,
      });
    }
    const entityMatch = caseId && path.match(new RegExp(`^/api/cases/${caseId}/entities/([^/]+)$`));
    if (entityMatch && request.method() !== 'GET') {
      const body = request.method() === 'DELETE' ? null : request.postDataJSON();
      entityWrites.push({ method: request.method(), id: entityMatch[1], body });
      const index = fixtureCatalog.findIndex((entity) => entity.id === entityMatch[1]);
      if (index >= 0) {
        if (request.method() === 'DELETE') fixtureCatalog.splice(index, 1);
        else if (body?.status) fixtureCatalog[index].provenance.status = body.status;
      }
      // the delete route's own shape: what went, and the trash group to put it back
      if (request.method() === 'DELETE') {
        return json(route, {
          status: 'deleted',
          deleted: [entityMatch[1]],
          tombstoned: [],
          trash: 'trash-1',
        });
      }
      return json(route, fixtureCatalog[index] ?? { id: entityMatch[1], ...body });
    }
    if (caseId && path === `/api/cases/${caseId}/entities` && request.method() === 'POST') {
      const payload = request.postDataJSON();
      entityWrites.push(payload);
      return json(route, {
        id: options.newEntityId ?? 'e_new',
        ...payload,
        provenance: { by: 'user', at: '2026-08-03T10:00:00Z', status: 'confirmed' },
      });
    }
    if (caseId && path === `/api/cases/${caseId}/trash`) {
      if (request.method() === 'DELETE') {
        trashWrites.push({ kind: 'empty' });
        const purged = trashGroups.length;
        trashGroups.splice(0);
        return json(route, { purged });
      }
      return json(route, {
        groups: trashGroups,
        items: trashGroups.reduce((total, group) => total + group.item_count, 0),
        size_bytes: trashGroups.reduce((total, group) => total + group.size_bytes, 0),
      });
    }
    const trashMatch = caseId && path.match(new RegExp(`^/api/cases/${caseId}/trash/([^/]+)(/restore)?$`));
    if (trashMatch) {
      const groupId = trashMatch[1];
      const index = trashGroups.findIndex((group) => group.id === groupId);
      if (index < 0) return json(route, { detail: 'Trash group not found' }, 404);
      const kind = trashMatch[2] ? 'restore' : 'purge';
      trashWrites.push({ kind, groupId });
      trashGroups.splice(index, 1);
      return json(route, kind === 'restore' ? { status: 'restored' } : { status: 'purged' });
    }
    if (caseId && path === `/api/cases/${caseId}/bundle/export` && request.method() === 'POST') {
      bundleCalls.push({ kind: 'export', body: request.postDataJSON() });
      return json(route, { job_id: 'bundle-job' });
    }
    if (caseId && path === `/api/cases/${caseId}/bundle/jobs/bundle-job`) {
      bundleCalls.push({ kind: 'job' });
      return json(route, bundleJob);
    }
    if (caseId && path === `/api/cases/${caseId}/search-grids`) return json(route, []);
    const chainMatch = caseId && path.match(new RegExp(`^/api/cases/${caseId}/entities/(.+)/chain$`));
    if (chainMatch) {
      const chain = fixtureChains[chainMatch[1]];
      return json(route, chain ?? { entity: null, sources: [], lost: [], dependents: [], relations: [], empty: true });
    }
    const linkMatch = caseId && path.match(new RegExp(`^/api/cases/${caseId}/links(?:/(.+))?$`));
    if (linkMatch && request.method() !== 'GET') {
      linkWrites.push({
        method: request.method(),
        id: linkMatch[1] ?? null,
        body: request.method() === 'DELETE' ? null : request.postDataJSON(),
      });
      return json(route, request.method() === 'DELETE' ? { status: 'deleted' } : { id: 'link-new' });
    }
    if (caseId && path === `/api/cases/${caseId}/media/reveal` && request.method() === 'POST') {
      revealed.push(request.postDataJSON()?.path ?? '');
      return json(route, { path: '/workspace/cases/browser-test/azimut/media' });
    }
    if (caseId && path === `/api/cases/${caseId}/media/upload` && request.method() === 'POST') {
      // What the importer answers: the entity it filed, with the kind it read off
      // the bytes. `uploadResult` lets a spec make it a duplicate instead.
      uploads.push({ length: request.postData()?.length ?? 0 });
      const result = options.uploadResult ?? {
        duplicate: false,
        entity: {
          id: 'media-imported',
          type: 'media',
          label: 'site plan',
          attrs: { path: 'media/site plan.pdf', kind: 'file', sha256: 'abc' },
          provenance: { by: 'media-library', at: '2026-08-04T09:00:00Z', status: 'confirmed' },
        },
        item: { path: 'media/site plan.pdf', kind: 'file' },
      };
      if (!result.duplicate && result.entity) fixtureCatalog.push(result.entity);
      return json(route, result);
    }
    if (path === `/api/cases/${CASE_ID}/media/page`) {
      return json(route, {
        items: media,
        next_cursor: null,
        total: media.length,
        facets: {
          category_counts: { image: media.length, upload: media.length },
          folder_counts: {},
          gps_count: 0,
          thumbnail_pending: 0,
        },
      });
    }
    if (path === `/api/cases/${CASE_ID}/media`) return json(route, media);
    // One media file with everything its sidecar holds. The browse index leaves
    // enrichment's metadata dumps out, so the Details panel reads a file at a time.
    if (path === `/api/cases/${CASE_ID}/media/item`) {
      const wanted = url.searchParams.get('path');
      const found = media.find((item) => item.path === wanted);
      return found ? json(route, found) : route.fulfill({ status: 404, body: '{}' });
    }
    if (path === `/api/cases/${CASE_ID}/media/export` && request.method() === 'POST') {
      const payload = request.postDataJSON();
      exportWrites.push(payload);
      return json(route, {
        file: 'panel.svg',
        folder: fixtureSettings.export_dirs.media || "the case's exports folder",
      });
    }
    // Two different reads: the capture shelf (pickers list it beside media) and
    // the geo index the Map panel groups. Both are needed — a picker whose
    // shelf 404s shows no panels at all.
    if (path === `/api/cases/${CASE_ID}/satellite`) return json(route, []);
    if (path === `/api/cases/${CASE_ID}/drafts`) {
      return json(route, Object.entries(fixtureDrafts).map(([name, draft]) => ({
        name,
        title: draft.title,
        updated_at: draft.updated_at,
        target: draft.state?.target,
      })));
    }
    if (path.startsWith(`/api/cases/${CASE_ID}/drafts/`)) {
      const name = path.slice(path.lastIndexOf('/') + 1);
      const draft = fixtureDrafts[name];
      return draft ? json(route, draft) : json(route, { detail: 'Draft not found' }, 404);
    }
    if (path === `/api/cases/${CASE_ID}/notes`) return json(route, { text: '' });
    if (path === `/api/cases/${CASE_ID}/entities/lookup`) {
      return json(route, { entity: fixtureLookupEntities[url.searchParams.get('value')] ?? null });
    }
    if (path === '/api/satellite/providers') return json(route, providers);
    if (path === '/api/satellite/imagery-date') {
      return json(route, { supported: false, date: null, source: null });
    }
    if (path === `/api/cases/${CASE_ID}/satellite/capture` && request.method() === 'POST') {
      const payload = request.postDataJSON();
      captures.push(payload);
      return json(route, {
        path: `media/capture-${captures.length}.png`,
        title: `Capture ${captures.length}`,
        ...payload,
        provider_label: 'Esri World Imagery',
        attribution: 'Browser fixture',
        fetched_at: '2026-07-21T00:00:00Z',
        tiles_missing: 0,
        tiles_upscaled: 0,
      });
    }
    if (path === `/api/cases/${CASE_ID}/proofs` && request.method() === 'POST') {
      const payload = request.postDataJSON();
      proofSaves.push(payload);
      return json(route, { name: 'browser-proof', png: 'proofs/browser-proof.png' });
    }

    unexpected.push(`${request.method()} ${path}`);
    return json(route, { detail: `Unhandled browser fixture request: ${path}` }, 404);
  });

  return {
    captures,
    proofSaves,
    linkWrites,
    entityWrites,
    catalogQueries,
    uploads,
    revealed,
    trashWrites,
    bundleCalls,
    settingsWrites,
    folderWrites,
    exportWrites,
    expectNoUnexpectedRequests: () => expect(unexpected).toEqual([]),
  };
}

export async function openProofWithPanel(page) {
  await page.goto('/#proof');
  await expect(page.getByRole('heading', { name: 'Geo Proof' })).toBeVisible();
  await page.getByRole('button', { name: 'New proof' }).first().click();
  await expect(page.getByRole('heading', { name: 'Create proof' })).toBeVisible();
  await page.locator('.selectable-pick').click();
  await page.getByRole('button', { name: 'Create proof' }).click();
  await expect(page.locator('.konva canvas')).toHaveCount(2);
  await expect(page.locator('.panel-row')).toHaveCount(1);
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}
