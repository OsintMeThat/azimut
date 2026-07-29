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
  source: { type: 'upload' },
  thumbnail: null,
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
  update_check_on_start: false,
  update_dismissed_version: '',
  usage: {},
  usage_overrides: {},
  eco_zoom_fallback: true,
  eco_max_zoom: 15,
  free_tier: {},
  month: '2026-07',
};

// The relation vocabulary as engine/links.py serves it (ONTOLOGY §3).
const relationTypes = [
  { type: 'located-at', label: 'was shot at', from_types: ['capture', 'media'], to_types: ['place'], manual: true },
  { type: 'depicts', label: 'shows', from_types: ['capture', 'media'], to_types: ['place'], manual: true },
  { type: 'same-image-as', label: 'is the same picture as', from_types: ['media'], to_types: ['media'], manual: false },
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
  const trashGroups = [...(options.trashGroups ?? [])];
  const trashWrites = [];
  const bundleCalls = [];
  const bundlePreview = options.bundlePreview;
  const bundleJob = options.bundleJob ?? { state: 'ready' };
  // Relations, keyed by entity id: what the bounded chain endpoint answers for
  // the row whose relations a surface asked for.
  const fixtureChains = options.chains ?? {};
  const linkWrites = [];

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
    if (path === '/api/settings') return json(route, settings);
    if (path === '/api/templates') return json(route, { proof: [], post: [] });
    if (path === '/api/cases/relation-types') return json(route, relationTypes);
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
      return json(route, { total: 1, by_type: { media: 1 }, by_status: { confirmed: 1 }, by_folder: {} });
    }
    if (caseId && path === `/api/cases/${caseId}/catalog/entities`) {
      return json(route, { items: [], next_cursor: null });
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
    if (path === `/api/cases/${CASE_ID}/media`) return json(route, media);
    // One media file with everything its sidecar holds. The browse index leaves
    // enrichment's metadata dumps out, so the Details panel reads a file at a time.
    if (path === `/api/cases/${CASE_ID}/media/item`) {
      const wanted = url.searchParams.get('path');
      const found = media.find((item) => item.path === wanted);
      return found ? json(route, found) : route.fulfill({ status: 404, body: '{}' });
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
      return json(route, { entity: null });
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
    trashWrites,
    bundleCalls,
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
