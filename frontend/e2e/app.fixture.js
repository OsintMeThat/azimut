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
  version: '0.2.8',
  workspace_root: '/tmp/azimut-browser-fixture',
  extension_version: '0.2.5', // tracks the extension, so it lags the app version
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

// The graph readings, as `engine/graph.py` resolves them from the two registries: a
// set of verbs from the relation types, and a set of node roles from the entity types.
// Held here as data because a browser spec must not depend on the backend running,
// and kept in step with those registries for the same reason the relation slice is:
// a stale lens would let a spec prove the opposite of the shipped contract.
//
// What every reading of the *case* leaves out: the analyst's own output, which is the
// filing rather than the case. `My work` is the one lens that draws it.
const GRAPH_FILED = ['inspect-session', 'note', 'post'];

export const graphLenses = {
  lenses: [
    { id: 'all', label: 'Everything', hint: 'every connection between the things the case is about', types: ['derived-from', 'depends-on', 'located-at', 'depicts', 'owns', 'part-of', 'member-of', 'posted', 'appears-in', 'sited-at', 'instance-of', 'in-network', 'same-image-as', 'mentions', 'about', 'at', 'cites'], hides: GRAPH_FILED },
    { id: 'subjects', label: 'Subjects', hint: 'who owns, belongs to, posted or appears in what', types: ['owns', 'part-of', 'member-of', 'posted', 'appears-in', 'instance-of', 'in-network', 'same-image-as'], hides: GRAPH_FILED },
    { id: 'ground', label: 'Ground', hint: 'what is tied to a place on the map', types: ['located-at', 'depicts', 'sited-at'], hides: GRAPH_FILED },
    { id: 'claims', label: 'Statements', hint: 'what is asserted, and what it rests on', types: ['about', 'at', 'cites'], hides: GRAPH_FILED },
    { id: 'work', label: 'My work', hint: 'what you wrote, what it was made from, and what it points at', types: ['derived-from', 'depends-on', 'mentions'], hides: [] },
  ],
  orders: [
    { value: 'degree', label: 'Most connected', hint: 'keeps the hubs, so a cut view still shows the shape' },
    { value: 'recent', label: 'Latest work', hint: 'keeps what entered the case last' },
  ],
  max_hops: 3,
};

/** Where a graph node's preview is served from, as `media_thumbs` reports it. */
export const GRAPH_THUMB = 'media/.thumbs/harbour.svg';

/** The default drawn case: one hub, its members, a place and something unconnected. */
const graphNodes = [
  { id: 'org-1', type: 'organization', label: '3rd Battalion', family: 'actor', status: 'confirmed', at: '2026-08-01T09:00:00Z', degree: 3 },
  // The one node with a picture: a card shows a preview, everything else a glyph.
  // `kind` is what the bytes are, which the payload carries for media alone: one
  // type covers image, video and audio, so the node has to say which it holds.
  { id: 'med-1', type: 'media', label: 'harbour frame', family: 'collected', status: 'confirmed', at: '2026-08-01T09:30:00Z', degree: 1, kind: 'image', thumb: GRAPH_THUMB, folder: 'harbour' },
  { id: 'per-1', type: 'person', label: 'Section chief', family: 'actor', status: 'confirmed', at: '2026-08-01T10:00:00Z', degree: 1 },
  { id: 'veh-1', type: 'vehicle', label: 'BTR-82A 4721', family: 'asset', status: 'confirmed', at: '2026-08-01T11:00:00Z', degree: 1, attrs: { plate: 'AX-904-ZT' } },
  { id: 'acc-1', type: 'account', label: '@harbourwatch', family: 'identifier', status: 'suggested', at: '2026-08-02T08:00:00Z', degree: 1 },
  { id: 'plc-1', type: 'place', label: 'checkpoint north', family: 'place', status: 'confirmed', at: '2026-08-02T09:00:00Z', degree: 0 },
  { id: 'dom-1', type: 'domain', label: 'nothing.test', family: 'identifier', status: 'confirmed', at: '2026-08-02T10:00:00Z', degree: 0 },
];

/**
 * The seed edges. Copied per fixture rather than read directly, because a link
 * written from a surface has to be there on the next read: a graph that answered
 * without the edge just filed would make a spec prove the opposite of the shipped
 * behaviour, since the tool says nothing when the edge appears and speaks up when it
 * does not.
 */
const graphLinks = [
  { id: 'l-1', from: 'per-1', to: 'org-1', type: 'member-of', provenance: { by: 'user', at: '2026-08-02T09:00:00Z', status: 'confirmed' } },
  { id: 'l-4', from: 'acc-1', to: 'med-1', type: 'posted', provenance: { by: 'user', at: '2026-08-02T09:20:00Z', status: 'confirmed' } },
  { id: 'l-2', from: 'org-1', to: 'veh-1', type: 'owns', provenance: { by: 'user', at: '2026-08-02T09:05:00Z', status: 'confirmed' } },
  { id: 'l-3', from: 'org-1', to: 'acc-1', type: 'owns', provenance: { by: 'enrich', at: '2026-08-02T09:10:00Z', status: 'suggested' } },
];

function graphView(url, override, pins = new Map(), held = graphLinks) {
  if (override) return override;
  const lens = url.searchParams.get('lens') ?? 'all';
  const verbs = graphLenses.lenses.find((entry) => entry.id === lens)?.types ?? [];
  // One lens draws one set of verbs, as the engine resolves them. Filtering here
  // rather than blanking a single reading is what lets a spec state an edge into a
  // lens that does not hold its verb, which is the one case the tool words.
  const drawn = held.filter((link) => verbs.includes(link.type));
  // The catalog filters the graph now sends, applied here rather than ignored: a
  // spec has to be able to prove the surface asked the server to narrow. `type` is a
  // comma-separated set, because that is what a family switch resolves to on its way
  // out — read as one string, unticking a family narrowed to nothing.
  const wantedTypes = (url.searchParams.get('type') ?? '').split(',').filter(Boolean);
  const wantedStatus = url.searchParams.get('status') ?? '';
  const wantedFolder = url.searchParams.get('folder') ?? '';
  const recursive = url.searchParams.get('recursive') === 'true';
  const unfiled = url.searchParams.get('unfiled') === 'true';
  const query = (url.searchParams.get('q') ?? '').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const field = url.searchParams.get('attr') ?? '';
  const value = url.searchParams.get('value') ?? '';
  const linked = url.searchParams.get('linked') ?? '';
  const unlinked = url.searchParams.get('unlinked') === 'true';
  const since = url.searchParams.get('since') ?? '';
  const until = url.searchParams.get('until') ?? '';
  const filedBy = (url.searchParams.get('by') ?? '').split(',').filter(Boolean);
  const opened = (url.searchParams.get('expand') ?? '').split(',').filter(Boolean);
  // The drawing is a set the client owns: `keep` draws these and nothing around them,
  // `omit` leaves these out whatever put them there. Honoured here rather than ignored,
  // or a spec would prove a picture the server never sends.
  const byName = (url.searchParams.get('keep') ?? '').split(',').filter(Boolean);
  const out = new Set((url.searchParams.get('omit') ?? '').split(',').filter(Boolean));
  const degrees = new Map(graphNodes.map((node) => [node.id, 0]));
  for (const link of drawn) {
    degrees.set(link.from, degrees.get(link.from) + 1);
    degrees.set(link.to, degrees.get(link.to) + 1);
  }
  // The pins are served back the way the case stores them — keyed by lens as well
  // as by node — so a spec can prove an arrangement survived a reload, and that it
  // did not leak into another reading.
  // What an expansion reaches: the opened nodes and everything one hop from them,
  // kept whatever the filters say — an analyst asking what touches this node is
  // asking about the case, not about the narrowing they set earlier.
  const reached = new Set(opened);
  for (const link of drawn) {
    if (opened.includes(link.from)) reached.add(link.to);
    if (opened.includes(link.to)) reached.add(link.from);
  }
  const typeOf = new Map(graphNodes.map((node) => [node.id, node.type]));
  const reaches = (node, wantedType) => drawn.some(
    (link) =>
      (link.from === node.id && typeOf.get(link.to) === wantedType) ||
      (link.to === node.id && typeOf.get(link.from) === wantedType),
  );
  const hasLink = (node) => drawn.some((link) => link.from === node.id || link.to === node.id);
  const passes = (node) => {
    const searchable = [node.label, node.type, node.folder, node.kind, ...Object.values(node.attrs ?? {})]
      .filter(Boolean).join('\n').toLocaleLowerCase();
    return (
    (!wantedTypes.length || wantedTypes.includes(node.type))
    && (!wantedStatus || node.status === wantedStatus)
    && (!wantedFolder || (recursive
      ? node.folder === wantedFolder || node.folder?.startsWith(`${wantedFolder}/`)
      : node.folder === wantedFolder))
    && (!unfiled || !node.folder)
    && (!query.length || query.every((term) => searchable.includes(term)))
    && (!field || !value || String(node.attrs?.[field] ?? node[field] ?? '') === value)
    && (!linked || reaches(node, linked))
    && (!unlinked || !hasLink(node))
    && (!since || node.at >= since)
    && (!until || node.at <= `${until}T23:59:59Z`)
    && (!filedBy.length || filedBy.includes(node.by ?? 'user'))
    );
  };
  const standing = graphNodes.filter(
    (node) =>
      !out.has(node.id) && (reached.has(node.id) || byName.includes(node.id) || passes(node)),
  );
  // An arrival is held by whatever reaches it, so a removal takes with it the hops no
  // anchor still reaches — or the drawing keeps a handful of dots with no edge to
  // anything. Anchors are the ranked nodes and the ones named, which stand on their
  // own. Mirrors `engine/graph._stranded`, and it is here for the same reason the
  // filters are: a spec must not prove a picture the server never sends.
  const survives = new Set(standing.map((node) => node.id));
  const shown = new Set(
    standing
      .filter((node) => passes(node) || byName.includes(node.id) || opened.includes(node.id))
      .map((node) => node.id),
  );
  for (let growing = true; growing; ) {
    growing = false;
    for (const link of drawn) {
      for (const [near, far] of [[link.from, link.to], [link.to, link.from]]) {
        if (shown.has(near) && survives.has(far) && !shown.has(far)) {
          shown.add(far);
          growing = true;
        }
      }
    }
  }
  const kept = standing.filter((node) => shown.has(node.id));
  // A degree says what a click would bring in, and nothing brings a removal back, so
  // the edges that left with it stop being offered — exactly as the engine corrects it.
  for (const link of drawn) {
    for (const [near, far] of [[link.from, link.to], [link.to, link.from]]) {
      if (out.has(far) && shown.has(near)) degrees.set(near, degrees.get(near) - 1);
    }
  }
  const ranked = new Set(graphNodes.filter(passes).map((node) => node.id));
  const nodes = kept.map((node) => {
    const seat = { ...node, degree: degrees.get(node.id) };
    delete seat.attrs;
    if (query.length) {
      const match = Object.entries(node.attrs ?? {}).find(([, held]) =>
        query.every((term) => String(held).toLocaleLowerCase().includes(term))
      );
      if (match) seat.matches = [{ field: match[0], label: 'Plate', value: String(match[1]) }];
    }
    if (!ranked.has(node.id)) seat.added = true;
    const pin = pins.get(`${lens}|${node.id}`);
    return pin ? { ...seat, pin: [pin.x, pin.y] } : seat;
  });
  return {
    lens,
    order: url.searchParams.get('order') ?? 'degree',
    nodes,
    links: drawn.filter((link) => shown.has(link.from) && shown.has(link.to)),
    total: ranked.size,
    shown: nodes.length,
    truncated: false,
    kept: byName.filter((id) => shown.has(id)),
    expanded: opened.filter((id) => graphNodes.some((node) => node.id === id)),
    isolated: nodes.filter((node) => node.degree === 0).length,
    pinned: [...pins.keys()].filter((key) => key.startsWith(`${lens}|`)).length,
  };
}


/**
 * The shortest route between two entities, as `engine/graph.paths` answers it.
 *
 * A plain breadth-first walk rather than the bidirectional one the server runs: the
 * fixture case is seven nodes, and a spec proves the *tool's* behaviour, never the
 * server's search strategy. Undirected, like the real one.
 */
function graphPaths(url, override, held = graphLinks) {
  // A spec that overrides the drawn case overrides what a route may run through:
  // answering over the default edges would have the route contradict the picture.
  const drawn = override?.nodes ?? graphNodes;
  if (override?.links) held = override.links;
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const near = new Map();
  for (const link of held) {
    for (const [a, b] of [[link.from, link.to], [link.to, link.from]]) {
      if (!near.has(a)) near.set(a, []);
      near.get(a).push([b, link]);
    }
  }
  // Every predecessor at the shortest depth, not one of them: the ties are what the
  // tool draws all of, so a fixture that kept one could not prove it.
  const depth = new Map([[from, 0]]);
  const behind = new Map([[from, []]]);
  let edge = [from];
  while (edge.length && !depth.has(to)) {
    const step = depth.get(edge[0]) + 1;
    const next = [];
    for (const id of edge) {
      for (const [far, link] of near.get(id) ?? []) {
        if (depth.has(far) && depth.get(far) < step) continue;
        if (!depth.has(far)) {
          depth.set(far, step);
          behind.set(far, []);
          next.push(far);
        }
        behind.get(far).push([id, link]);
      }
    }
    edge = next;
  }
  const base = { lens: 'all', from, to, searched: 4, truncated: false };
  if (!depth.has(to)) return { ...base, found: false, hops: 0, routes: [], nodes: [], links: [] };
  const back = (at) => {
    if (at === from) return [{ nodes: [from], links: [] }];
    return (behind.get(at) ?? []).flatMap((step) =>
      back(step[0]).map((route) => ({
        nodes: [...route.nodes, at],
        links: [...route.links, step[1].id],
      })),
    );
  };
  const routes = back(to);
  const seen = new Set(routes.flatMap((route) => route.nodes));
  const used = new Set(routes.flatMap((route) => route.links));
  return {
    ...base,
    found: true,
    hops: routes[0].links.length,
    routes,
    nodes: drawn.filter((node) => seen.has(node.id)),
    links: held.filter((link) => used.has(link.id)),
  };
}

function graphHood(url, override, held = graphLinks) {
  if (override) return override;
  const root = url.searchParams.get('root') ?? 'org-1';
  const links = held.filter((link) => link.from === root || link.to === root);
  const reached = new Set([root]);
  for (const link of links) reached.add(link.from === root ? link.to : link.from);
  const nodes = graphNodes
    .filter((node) => reached.has(node.id))
    .map((node) => ({ ...node, hop: node.id === root ? 0 : 1 }));
  return { lens: url.searchParams.get('lens') ?? 'all', root, hops: 1, nodes, links, shown: nodes.length, truncated: false };
}

// The relation vocabulary slice exercised by browser specs. Keep endpoint and
// action metadata exact: a stale action can make an E2E test prove the opposite
// of the production contract.
export const relationTypes = [
  { type: 'located-at', label: 'was recorded at', inverse_label: 'was recorded here', hint: 'where the photo, video or audio was recorded', group: '', action: 'relation', from_types: ['media'], to_types: ['place'], from_media_kinds: ['audio', 'image', 'video'], to_media_kinds: [], manual: true, ratable: true },
  { type: 'depicts', label: 'shows', inverse_label: 'is shown in', hint: 'the place is visible in the image or video', group: '', action: 'relation', from_types: ['capture', 'media'], to_types: ['place'], from_media_kinds: ['image', 'video'], to_media_kinds: [], manual: true, ratable: true },
  { type: 'owns', label: 'owns', inverse_label: 'is owned by', hint: 'ownership rather than use, access or operational control', group: '', action: 'relation', from_types: ['organization', 'person'], to_types: ['account', 'aircraft', 'domain', 'email', 'ip', 'network', 'organization', 'phone', 'structure', 'vehicle', 'vessel'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: true },
  { type: 'part-of', label: 'is part of', inverse_label: 'contains', hint: 'an internal unit inside its parent organization', group: '', action: 'relation', from_types: ['organization'], to_types: ['organization'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: true },
  { type: 'member-of', label: 'is a member of', inverse_label: 'has member', hint: 'membership rather than internal containment', group: '', action: 'relation', from_types: ['organization', 'person'], to_types: ['organization'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: true },
  { type: 'associated-with', label: 'is associated with', inverse_label: 'is associated with', hint: 'a tie that exists, where what kind it is rides on the edge', group: '', action: 'relation', from_types: ['organization', 'person'], to_types: ['organization', 'person'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: true, qualifier: 'How they are tied' },
  { type: 'posted', label: 'posted', inverse_label: 'was posted by', hint: 'the account published the content or URL', group: '', action: 'relation', from_types: ['account'], to_types: ['bookmark', 'media'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: true },
  { type: 'appears-in', label: 'appears in', inverse_label: 'shows', hint: 'the entity or a recognizable representation is visible', group: '', action: 'relation', from_types: ['account', 'aircraft', 'domain', 'email', 'ip', 'network', 'organization', 'person', 'phone', 'structure', 'vehicle', 'vessel'], to_types: ['capture', 'media'], from_media_kinds: [], to_media_kinds: ['image', 'video'], manual: true, ratable: true },
  { type: 'sited-at', label: 'is sited at', inverse_label: 'is the site of', hint: 'a permanent site rather than a dated presence', group: '', action: 'relation', from_types: ['structure'], to_types: ['place'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: true },
  { type: 'in-network', label: 'is in network', inverse_label: 'contains', hint: 'the address or subnet belongs inside this network', group: '', action: 'relation', from_types: ['ip', 'network'], to_types: ['network'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: true },
  { type: 'same-image-as', label: 'is the same image as', inverse_label: 'is the same image as', hint: 'enrichment matched the perceptual hashes', group: '', action: 'relation', from_types: ['media'], to_types: ['media'], from_media_kinds: ['image'], to_media_kinds: ['image'], manual: false, ratable: false },
  { type: 'mentions', label: 'mentions', inverse_label: 'is mentioned by', hint: 'the document refers to the entity', group: 'Mentions', action: 'mention', from_types: ['bookmark', 'note', 'post', 'proof'], to_types: ['account', 'aircraft', 'bookmark', 'capture', 'claim', 'domain', 'email', 'inspect-session', 'ip', 'media', 'network', 'note', 'organization', 'person', 'phone', 'place', 'post', 'proof', 'structure', 'vehicle', 'vessel'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: false },
  { type: 'about', label: 'is about', inverse_label: 'has claim', hint: 'what the statement concerns', group: '', action: 'claim', from_types: ['claim'], to_types: ['account', 'aircraft', 'capture', 'domain', 'email', 'ip', 'media', 'network', 'organization', 'person', 'phone', 'place', 'structure', 'vehicle', 'vessel'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: false },
  { type: 'at', label: 'places it at', inverse_label: 'is a claim location', hint: 'where the statement places its subject or event', group: '', action: 'claim', from_types: ['claim'], to_types: ['place'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: false },
  { type: 'cites', label: 'cites', inverse_label: 'supports claim', hint: 'the evidence the statement relies on', group: '', action: 'claim', from_types: ['claim'], to_types: ['bookmark', 'capture', 'media', 'note', 'proof'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: false },
  { type: 'contradicts', label: 'contradicts', inverse_label: 'is contradicted by', hint: 'the two statements cannot both hold', group: '', action: 'claim', from_types: ['claim'], to_types: ['claim'], from_media_kinds: [], to_media_kinds: [], manual: true, ratable: false },
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
    type: 'person', label: 'Person', family: 'actor', icon: 'user', manual: true, group: '', image_gallery: true,
    identity_label: 'Full name', identity_placeholder: 'Name or known alias',
    hint: 'a named individual', family_reads: 'a person or organization that can act or hold ownership',
    attrs: [
      { key: 'aliases', label: 'Other names', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
      { key: 'role', label: 'Role', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
      { key: 'nationality', label: 'Nationality', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
    ],
  },
  {
    type: 'organization', label: 'Organization', family: 'actor', icon: 'layers', manual: true, group: '', image_gallery: true,
    identity_label: 'Organization name', identity_placeholder: 'Name of the organization',
    hint: 'a company, a ministry or a military unit', family_reads: 'a person or organization that can act or hold ownership',
    attrs: [],
  },
  {
    type: 'vehicle', label: 'Vehicle', family: 'asset', icon: 'grip', manual: true, group: '', image_gallery: true,
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
    type: 'account', label: 'Account', family: 'identifier', icon: 'at', manual: true, group: '',
    identity_label: 'Handle', identity_placeholder: '@handle',
    hint: 'a handle on one platform', family_reads: 'a handle on a system, where the value is the identity',
    attrs: [
      { key: 'platform', label: 'Platform', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
      { key: 'url', label: 'Profile URL', kind: 'url', rungs: [], options: [], minimum: null, maximum: null },
    ],
  },
  {
    type: 'domain', label: 'Domain', family: 'identifier', icon: 'globe', manual: true, group: '',
    identity_label: 'Hostname', identity_placeholder: 'example.test',
    hint: 'a hostname, which is its own identity', family_reads: 'a handle on a system, where the value is the identity',
    attrs: [
      { key: 'registrar', label: 'Registrar', kind: 'text', rungs: [], options: [], minimum: null, maximum: null },
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

function fixtureIso(milliseconds) {
  return new Date(milliseconds).toISOString().replace('.000Z', 'Z');
}

function fixtureTemporalToken(raw) {
  const clean = raw.replace(/[~?%]$/, '');
  const timestamp = clean.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})?$/);
  if (timestamp) {
    if (!timestamp[1]) {
      return {
        earliest: null, latest: null,
        precision: clean.includes('.') ? 'subsecond' : 'second',
        zone: 'local', sortable: false, timestamp: true,
      };
    }
    const earliest = Date.parse(clean);
    if (!Number.isFinite(earliest)) return null;
    return {
      earliest: fixtureIso(earliest),
      latest: fixtureIso(earliest + (clean.includes('.') ? 1 : 1000)),
      precision: clean.includes('.') ? 'subsecond' : 'second',
      zone: timestamp[1] === 'Z' ? 'utc' : 'offset',
      sortable: true,
      timestamp: true,
    };
  }

  const match = clean.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : 1;
  const day = match[3] ? Number(match[3]) : 1;
  const earliest = Date.UTC(year, month - 1, day);
  const latest = match[3]
    ? Date.UTC(year, month - 1, day + 1)
    : match[2] ? Date.UTC(year, month, 1) : Date.UTC(year + 1, 0, 1);
  return {
    earliest: fixtureIso(earliest),
    latest: fixtureIso(latest),
    precision: match[3] ? 'day' : match[2] ? 'month' : 'year',
    zone: 'date-only',
    sortable: true,
    timestamp: false,
  };
}

function fixtureTemporalReading(raw) {
  if (!raw) {
    return {
      earliest: null, latest: null, precision: null, shape: null,
      zone: null, sortable: false, uncertain: false, approximate: false,
    };
  }
  const parts = raw.split('/');
  const start = fixtureTemporalToken(parts[0]);
  const end = parts[1] ? fixtureTemporalToken(parts[1]) : null;
  if (!start || (parts[1] && !end)) {
    return {
      earliest: null, latest: null, precision: null,
      shape: parts[1] ? 'interval' : 'instant', zone: null, sortable: false,
      uncertain: raw.includes('?') || raw.includes('%'),
      approximate: raw.includes('~') || raw.includes('%'),
    };
  }
  return {
    earliest: start.earliest,
    latest: end ? (end.timestamp ? end.earliest : end.latest) : start.latest,
    precision: end && end.precision !== start.precision ? 'mixed' : start.precision,
    shape: end ? 'interval' : 'instant',
    zone: end && end.zone !== start.zone ? 'mixed' : start.zone,
    sortable: start.sortable && (!end || end.sortable),
    uncertain: raw.includes('?') || raw.includes('%'),
    approximate: raw.includes('~') || raw.includes('%'),
  };
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
  const fixtureMedia = (options.media ?? media).map((item) => ({ ...item }));
  const fixtureCases = options.cases ?? [caseOverview];
  const fixtureSavedIndexes = options.savedIndexes ?? { [CASE_ID]: fixtureSavedIndex };
  const fixtureProofIndexes = options.proofIndexes ?? { [CASE_ID]: fixtureProofIndex };
  const savedIndexDelays = options.savedIndexDelays ?? {};
  const proofIndexDelays = options.proofIndexDelays ?? {};
  const caseDelays = options.caseDelays ?? {};
  const graphDelays = options.graphDelays ?? {};
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
  // Where the graph's nodes have been dragged to, held across requests so a spec
  // can reload the view and find the arrangement still there.
  const graphPins = new Map(Object.entries(options.graphPins ?? {}));
  const graphQueries = [];
  const graphPinWrites = [];
  const analysisViews = (options.analysisViews ?? []).map((view) => ({
    ...view,
    spec: structuredClone(view.spec ?? {}),
  }));
  const analysisWrites = [];
  const timelineRows = (options.timelineItems ?? []).map((item) => structuredClone(item));
  const timelineWrites = [];
  const bundlePreview = options.bundlePreview;
  const bundleJob = options.bundleJob ?? { state: 'ready' };
  // Relations, keyed by entity id: what the bounded chain endpoint answers for
  // the row whose relations a surface asked for.
  const fixtureChains = options.chains ?? {};
  const linkWrites = [];
  // The edges this run holds, copied so a write from one spec is not read by the
  // next. What the graph is drawn from, what the catalog's one-hop filter tests, and
  // what a POST, a PATCH or a DELETE moves. A spec that brought its own catalog can
  // bring the edges between those rows too.
  const caseLinks = (options.links ?? graphLinks).map((link) => ({
    ...link,
    provenance: { ...link.provenance },
  }));
  let minted = 0;
  // What the bounded catalog holds, and what the board asked it for. Copied rather
  // than held by reference: a spec's `catalog` is a module constant shared by every
  // test in the file, and confirming or dismissing a row writes to this one.
  const fixtureCatalog = (options.catalog ?? []).map((entity) => ({
    ...entity,
    provenance: { ...entity.provenance },
  }));
  const catalogQueries = [];
  const entityWrites = [];
  const galleryWrites = [];
  const entityImages = new Map(
    Object.entries(options.entityImages ?? {}).map(([id, images]) => [
      id,
      images.map((image) => ({ ...image })),
    ])
  );
  const uploads = [];
  const pastes = [];
  const revealed = [];

  const timelineEntity = (id) => fixtureCatalog.find((entity) => entity.id === id)
    ?? fixtureChains[id]?.entity
    ?? null;
  const timelineReferences = (item, ids, held) => {
    if (Array.isArray(held)) return held.map((entry) => ({ ...entry }));
    return (ids ?? []).map(timelineEntity).filter(Boolean).map((entry) => ({
      id: entry.id, label: entry.label, type: entry.type,
    }));
  };
  const enrichedTimelineItem = (item) => ({
    ...structuredClone(item),
    owner_type: item.owner_type ?? timelineEntity(item.owner_id)?.type ?? '',
    subject_entities: timelineReferences(item, item.subjects, item.subject_entities),
    place_entities: timelineReferences(item, item.places, item.place_entities),
    source_entities: timelineReferences(item, item.sources, item.source_entities),
  });
  /** Where a statement's places sit, read from the place entities themselves. The
   *  projection carries names, and only the map route resolves them to coordinates —
   *  a place the case has not located therefore drops out here, as it does server
   *  side. */
  const positionedPlaces = (item) => (item.places ?? []).map((placeId) => {
    const place = timelineEntity(placeId);
    const lat = Number(place?.attrs?.lat);
    const lon = Number(place?.attrs?.lon);
    if (!place || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      id: place.id,
      label: place.label,
      lat,
      lon,
      radius_m: place.attrs.radius_m ?? null,
      footprint: place.attrs.footprint ?? null,
    };
  }).filter(Boolean);
  /** What a mark carries about the row's own entity, so the card can hand it back to
   *  the tool that owns it and show a photograph rather than a line of text. */
  const mapOwner = (item) => {
    const entity = timelineEntity(item.owner_id);
    return {
      id: item.owner_id,
      type: entity?.type ?? item.owner_type ?? '',
      label: entity?.label ?? item.label ?? '',
      attrs: entity?.attrs ?? {},
      thumb: entity?.thumb ?? entity?.attrs?.thumb ?? null,
    };
  };
  const timelineMatchesTrack = (item, track = {}) => {
    if ((track.hidden ?? []).includes(item.id)) return false;
    const roles = Array.isArray(track.roles) ? track.roles : [];
    if (roles.length && !roles.includes(item.time_role ?? 'unset')) return false;
    const terms = track.terms && typeof track.terms === 'object' ? track.terms : {};
    const relation = track.relation ?? 'any';
    const related = {
      owner: [timelineEntity(item.owner_id)].filter(Boolean),
      about: timelineReferences(item, item.subjects, item.subject_entities),
      place: timelineReferences(item, item.places, item.place_entities),
      source: timelineReferences(item, item.sources, item.source_entities),
    };
    const candidates = relation === 'any'
      ? [...related.owner, ...related.about, ...related.place, ...related.source]
      : related[relation] ?? [];
    const hasTerms = Object.values(terms).some((value) => value !== '' && value !== null && value !== false);
    if (!hasTerms) return !['about', 'place', 'source'].includes(relation) || candidates.length > 0;
    const types = String(terms.type ?? '').split(',').filter(Boolean);
    const words = String(terms.q ?? '').toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return candidates.some((entity) => {
      const text = [entity.label, entity.type, ...Object.values(entity.attrs ?? {})]
        .filter(Boolean).join('\n').toLocaleLowerCase();
      return (!types.length || types.includes(entity.type))
        && (!terms.status || entity.provenance?.status === terms.status)
        && (!words.length || words.every((word) => text.includes(word)));
    });
  };
  const scopedTimelineRows = ({ categories = [], entity = '', track = {}, from = '', to = '', includeUndated = true }) =>
    timelineRows.map(enrichedTimelineItem).filter((item) =>
      (!categories.length || categories.includes(item.category))
      && (!entity || item.owner_id === entity || (item.subjects ?? []).includes(entity)
        || (item.places ?? []).includes(entity) || (item.sources ?? []).includes(entity))
      && timelineMatchesTrack(item, track)
      && (item.earliest
        ? (!from || item.latest > (from.includes('T') ? from : `${from}T00:00:00Z`))
          && (!to || item.earliest < (to.includes('T') ? to : `${to}T23:59:59Z`))
        : includeUndated)
    );
  const analysisSnapshotCount = (spec) => spec?.snapshot?.timeline_items?.length
    ?? spec?.snapshot?.entities?.length
    ?? 0;
  const captureTimelineSnapshot = (spec) => {
    const timeline = spec?.timeline ?? {};
    const visible = new Set(timeline.visible_categories ?? ['statement', 'media']);
    const captured = new Map();
    const timelineTracks = {};
    for (const track of timeline.tracks ?? []) {
      const categories = (track.categories ?? []).filter((category) => visible.has(category));
      const rows = categories.length ? scopedTimelineRows({
        categories,
        entity: timeline.entity?.id ?? '',
        track: { ...(track.query ?? {}), hidden: track.hidden ?? [] },
        from: timeline.from ?? '',
        to: timeline.to ?? '',
      }) : [];
      timelineTracks[track.id] = rows.map((item) => item.id);
      for (const item of rows) captured.set(item.id, item);
    }
    return {
      ...structuredClone(spec),
      snapshot: {
        captured_at: '2026-08-12T12:00:00Z',
        entities: [],
        links: [],
        timeline_items: [...captured.values()],
        timeline_tracks: timelineTracks,
      },
    };
  };

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
    if (path === `/files/${CASE_ID}/${GRAPH_THUMB}`) {
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
    if (path === '/api/cases/graph-lenses') return json(route, graphLenses);
    if (path === '/api/cases/bundles/inspect' && request.method() === 'POST') {
      bundleCalls.push({ kind: 'inspect' });
      return json(route, bundlePreview ?? { detail: 'No bundle fixture' }, bundlePreview ? 200 : 400);
    }
    if (path === '/api/cases') {
      return json(route, fixtureCases.map((item) => ({ entity_count: 1, ...item })));
    }
    const overview = fixtureCases.find((item) => path === `/api/cases/${item.id}`);
    if (overview) {
      if (caseDelays[overview.id]) {
        await new Promise((resolve) => setTimeout(resolve, caseDelays[overview.id]));
      }
      return json(route, overview);
    }
    const caseId = fixtureCases.find((item) => path.startsWith(`/api/cases/${item.id}/`))?.id;
    if (caseId && path === `/api/cases/${caseId}/analysis-views`) {
      if (request.method() === 'GET') {
        return json(route, {
          views: analysisViews.map(({ spec, ...view }) => ({
            ...view,
            snapshot_count: analysisSnapshotCount(spec),
          })),
        });
      }
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        const spec = body.mode === 'snapshot' && body.surface === 'timeline'
          ? captureTimelineSnapshot(body.spec)
          : structuredClone(body.spec ?? {});
        const saved = {
          id: `v_browser_${analysisViews.length + 1}`,
          ...body,
          spec,
          created_at: '2026-08-10T10:00:00Z',
          updated_at: '2026-08-10T10:00:00Z',
          snapshot_count: analysisSnapshotCount(spec),
        };
        analysisViews.push(saved);
        analysisWrites.push({ method: 'POST', caseId, body });
        return json(route, saved);
      }
    }
    const duplicateMatch = caseId && path.match(
      new RegExp(`^/api/cases/${caseId}/analysis-views/([^/]+)/duplicate$`)
    );
    if (duplicateMatch && request.method() === 'POST') {
      const source = analysisViews.find(
        (view) => view.id === decodeURIComponent(duplicateMatch[1])
      );
      if (!source) return json(route, { detail: 'Analysis view not found' }, 404);
      const body = request.postDataJSON();
      const saved = {
        ...structuredClone(source),
        id: `v_browser_${analysisViews.length + 1}`,
        name: body.name,
        created_at: '2026-08-10T10:00:00Z',
        updated_at: '2026-08-10T10:00:00Z',
      };
      analysisViews.push(saved);
      analysisWrites.push({ method: 'POST', body, duplicate: source.id });
      return json(route, saved);
    }
    const analysisMatch = caseId && path.match(
      new RegExp(`^/api/cases/${caseId}/analysis-views/([^/]+)$`)
    );
    if (analysisMatch) {
      const id = decodeURIComponent(analysisMatch[1]);
      const index = analysisViews.findIndex((view) => view.id === id);
      if (index < 0) return json(route, { detail: 'Analysis view not found' }, 404);
      if (request.method() === 'GET') return json(route, analysisViews[index]);
      if (request.method() === 'PUT') {
        const body = request.postDataJSON();
        analysisViews[index] = {
          ...analysisViews[index],
          ...body,
          id,
          updated_at: '2026-08-10T11:00:00Z',
        };
        analysisWrites.push({ method: 'PUT', caseId, id, body });
        return json(route, analysisViews[index]);
      }
      if (request.method() === 'DELETE') {
        analysisViews.splice(index, 1);
        analysisWrites.push({ method: 'DELETE', id });
        return json(route, { status: 'deleted', deleted: [id], trash: 'trash-view-1' });
      }
    }
    // Pins are held per lens, keyed `lens|entity`, because that is how the case
    // stores them: an arrangement belongs to one reading.
    const pinsIn = (lens) => [...graphPins.keys()].filter((key) => key.startsWith(`${lens}|`));
    if (caseId && path === `/api/cases/${caseId}/graph/pins`) {
      if (request.method() === 'PUT') {
        const body = JSON.parse(request.postData());
        graphPinWrites.push({ caseId, body });
        for (const pin of body.pins) {
          graphPins.set(`${body.lens}|${pin.id}`, { x: pin.x, y: pin.y });
        }
        return json(route, { lens: body.lens, pinned: pinsIn(body.lens).length });
      }
      if (request.method() === 'DELETE') {
        const lens = url.searchParams.get('lens') ?? 'all';
        for (const key of pinsIn(lens)) graphPins.delete(key);
        return json(route, { lens, pinned: 0 });
      }
    }
    const unpinned = caseId
      && request.method() === 'DELETE'
      && path.startsWith(`/api/cases/${caseId}/graph/pins/`);
    if (unpinned) {
      const lens = url.searchParams.get('lens') ?? 'all';
      graphPins.delete(`${lens}|${path.slice(`/api/cases/${caseId}/graph/pins/`.length)}`);
      return json(route, { lens, pinned: pinsIn(lens).length });
    }
    if (caseId && path === `/api/cases/${caseId}/graph`) {
      graphQueries.push({ caseId, search: url.search });
      if (graphDelays[caseId]) {
        await new Promise((resolve) => setTimeout(resolve, graphDelays[caseId]));
      }
      const savedView = analysisViews.find((view) => view.id === url.searchParams.get('view'));
      if (savedView?.mode === 'snapshot') {
        const snapshot = savedView.spec?.snapshot ?? { entities: [], links: [] };
        const ids = new Set(snapshot.entities.map((entity) => entity.id));
        const links = snapshot.links.filter((link) => ids.has(link.from) && ids.has(link.to));
        const degrees = new Map(snapshot.entities.map((entity) => [entity.id, 0]));
        for (const link of links) {
          degrees.set(link.from, degrees.get(link.from) + 1);
          degrees.set(link.to, degrees.get(link.to) + 1);
        }
        return json(route, {
          lens: url.searchParams.get('lens') ?? 'all',
          order: 'snapshot',
          nodes: snapshot.entities.map((entity) => ({
            id: entity.id,
            type: entity.type,
            label: entity.label,
            family: 'actor',
            status: entity.provenance?.status ?? 'confirmed',
            at: entity.provenance?.at ?? '',
            degree: degrees.get(entity.id),
          })),
          links,
          total: snapshot.entities.length,
          shown: snapshot.entities.length,
          truncated: false,
          isolated: [...degrees.values()].filter((degree) => degree === 0).length,
          single_account: 0,
          kept: [],
          expanded: [],
          pinned: 0,
          snapshot: true,
          captured_at: snapshot.captured_at,
        });
      }
      const chosen = options.graphs?.[caseId] ?? options.graph;
      const override = typeof chosen === 'function'
        ? await chosen({ caseId, url, catalog: fixtureCatalog, links: caseLinks })
        : chosen;
      return json(route, graphView(url, override, graphPins, caseLinks));
    }
    if (caseId && path === `/api/cases/${caseId}/graph/neighborhood`) {
      return json(route, graphHood(url, options.graph, caseLinks));
    }

    if (caseId && path === `/api/cases/${caseId}/graph/paths`) {
      return json(route, graphPaths(url, options.graph, caseLinks));
    }

    const timelineClaimMatch = caseId && path.match(
      new RegExp(`^/api/cases/${caseId}/timeline/claims(?:/([^/]+))?$`)
    );
    if (timelineClaimMatch && request.method() !== 'GET') {
      const body = request.postDataJSON();
      const ownerId = timelineClaimMatch[1] ?? `claim-browser-${timelineRows.length + 1}`;
      timelineWrites.push({ method: request.method(), ownerId, body });
      const index = timelineRows.findIndex((item) => item.owner_id === ownerId);
      const raw = body.when ?? (index >= 0 ? timelineRows[index].raw : null);
      const reading = fixtureTemporalReading(raw);
      const temporal = {
        id: `temporal:claim:${ownerId}`,
        owner_id: ownerId,
        category: 'statement',
        kind: 'claim',
        label: body.statement ?? (index >= 0 ? timelineRows[index].label : 'Assessment'),
        raw,
        ...reading,
        time_role: body.time_role ?? null,
        status: 'confirmed',
        confidence: body.confidence ?? null,
        parse_error: null,
        subjects: body.about ?? [],
        places: body.at ?? [],
        sources: body.cites ?? [],
      };
      if (index >= 0) timelineRows[index] = temporal;
      else timelineRows.push(temporal);
      return json(route, {
        entity: { id: ownerId, type: 'claim', label: temporal.label, attrs: body, provenance: { by: 'user', at: '2026-08-12T10:00:00Z', status: 'confirmed' } },
        links: [],
        temporal,
      });
    }
    if (caseId && path === `/api/cases/${caseId}/timeline/map`) {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      // Everything dated in the window that the case has put somewhere, in whichever
      // categories the caller asked for — `at` is a Claim's connector, and a layer
      // reading it alone answered a window of located photographs with nothing.
      // `matched` counts the window; `mapped` counts the ones a marker can be put on,
      // so the card can say how much it is not showing.
      const wanted = url.searchParams.getAll('category').flatMap((value) => value.split(','));
      const matched = scopedTimelineRows({
        categories: wanted.filter(Boolean).length ? wanted.filter(Boolean) : ['statement', 'media'],
        from, to, includeUndated: false,
      });
      const mapped = matched
        .map((item) => ({
          ...item,
          place_entities: positionedPlaces(item),
          owner: mapOwner(item),
        }))
        .filter((item) => item.place_entities.length);
      return json(route, {
        items: mapped,
        matched: matched.length,
        mapped: mapped.length,
        marks: mapped.reduce((count, item) => count + item.place_entities.length, 0),
        truncated: false,
        window: { from, to },
      });
    }

    if (caseId && path === `/api/cases/${caseId}/timeline`) {
      const wanted = url.searchParams.getAll('category');
      const entity = url.searchParams.get('entity');
      let track = {};
      try {
        track = JSON.parse(url.searchParams.get('track') ?? '{}');
      } catch {
        return json(route, { detail: 'Invalid timeline track' }, 400);
      }
      const base = scopedTimelineRows({ categories: wanted, entity, track });
      const datedBase = base.filter((item) => item.earliest);
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const includeUndated = url.searchParams.get('include_undated') !== 'false';
      const visible = scopedTimelineRows({
        categories: wanted, entity, track, from, to, includeUndated,
      });
      const bucket = url.searchParams.get('bucket');
      const width = { year: 4, month: 7, day: 10 }[bucket] ?? 0;
      const bucketCounts = new Map();
      if (width) for (const item of datedBase) {
        const key = item.earliest.slice(0, width);
        const held = bucketCounts.get(key) ?? { count: 0, categories: {} };
        held.count += 1;
        held.categories[item.category] = (held.categories[item.category] ?? 0) + 1;
        bucketCounts.set(key, held);
      }
      return json(route, {
        items: visible,
        next_cursor: null,
        total: visible.length,
        undated: base.filter((item) => !item.earliest && !item.raw).length,
        unplaced: base.filter((item) => !item.earliest && item.raw).length,
        buckets: [...bucketCounts]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([start, held]) => ({ start, count: held.count, categories: held.categories })),
        buckets_truncated: false,
        extent: {
          from: datedBase.map((item) => item.earliest).sort()[0] ?? null,
          to: datedBase.map((item) => item.latest).sort().at(-1) ?? null,
        },
        window: { from, to },
      });
    }

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
    // The case as the catalog answers for it: a spec's own list, or the drawn case so
    // the fixture stands for one case rather than two — the graph's search reads the
    // catalog, and it has to be able to find an entity the drawing left out.
    const catalogRows = () =>
      fixtureCatalog.length
        ? fixtureCatalog
        : graphNodes.map((node) => ({
            id: node.id,
            type: node.type,
            label: node.label,
            attrs: {
              ...(node.folder ? { folder: node.folder } : {}),
              ...(node.kind ? { kind: node.kind } : {}),
              ...(node.attrs ?? {}),
            },
            provenance: { by: 'user', at: node.at, status: node.status },
          }));
    if (caseId && path === `/api/cases/${caseId}/catalog/summary`) {
      if (options.summary) return json(route, options.summary);
      // The count the surface shows when nothing is filtered, so it has to be the
      // catalog's own size rather than a fixed 1 — otherwise "Showing 2 of 1".
      //
      // `by_type` is every type the case holds, which is what the graph resolves its
      // family switches against: a spec that set a catalog up is standing for that
      // case, one that did not is standing for the drawn one. Hard-coded, the graph's
      // legend would offer one family for a case holding five.
      const byType = {};
      const rows = catalogRows();
      for (const entity of rows) {
        byType[entity.type] = (byType[entity.type] ?? 0) + 1;
      }
      const typeOf = new Map(rows.map((entity) => [entity.id, entity.type]));
      const linkedTo = {};
      for (const entity of rows) {
        const reached = new Set();
        for (const link of caseLinks) {
          if (link.from === entity.id && typeOf.get(link.to)) reached.add(typeOf.get(link.to));
          if (link.to === entity.id && typeOf.get(link.from)) reached.add(typeOf.get(link.from));
        }
        for (const type of reached) linkedTo[type] = (linkedTo[type] ?? 0) + 1;
      }
      return json(route, {
        total: fixtureCatalog.length || 1,
        by_type: byType,
        by_status: { confirmed: 1 },
        by_folder: {},
        linked_to: linkedTo,
      });
    }
    // Which stored fields the listed types hold, and their values: the menus a field
    // filter is chosen from. Derived from the same rows the page is, so the fixture
    // cannot offer a term the mocked case could not answer.
    if (caseId && path === `/api/cases/${caseId}/catalog/attributes`) {
      const wanted = (url.searchParams.get('type') ?? '').split(',').filter(Boolean);
      const counts = new Map();
      for (const entity of catalogRows()) {
        if (wanted.length && !wanted.includes(entity.type)) continue;
        for (const [key, value] of Object.entries(entity.attrs ?? {})) {
          if (typeof value !== 'string' || !value) continue;
          const held = counts.get(key) ?? new Map();
          held.set(value, (held.get(value) ?? 0) + 1);
          counts.set(key, held);
        }
      }
      return json(route, {
        attrs: [...counts].map(([key, values]) => ({
          key,
          entities: [...values.values()].reduce((sum, n) => sum + n, 0),
          values: [...values]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([value, count]) => ({ value, count })),
          truncated: false,
        })),
      });
    }
    if (caseId && path === `/api/cases/${caseId}/catalog/entities`) {
      // Filtered here rather than returned whole, so a spec can prove the surface
      // asked the server to narrow instead of hiding rows it had already loaded.
      const wanted = (url.searchParams.get('type') ?? '').split(',').filter(Boolean);
      const term = (url.searchParams.get('q') ?? '').toLowerCase();
      const status = url.searchParams.get('status') ?? '';
      const field = url.searchParams.get('attr') ?? '';
      const value = url.searchParams.get('value') ?? '';
      const linked = url.searchParams.get('linked') ?? '';
      const savedView = analysisViews.find(
        (view) => view.id === url.searchParams.get('view')
      );
      const held = savedView?.mode === 'snapshot'
        ? savedView.spec?.snapshot?.entities ?? []
        : catalogRows();
      const typeOf = new Map(held.map((entity) => [entity.id, entity.type]));
      // The one-hop test, over the same edges the graph answers with. Undirected,
      // because "linked to a place" is a question about the pair.
      const reaches = (id, wantedType) =>
        caseLinks.some(
          (link) =>
            (link.from === id && typeOf.get(link.to) === wantedType) ||
            (link.to === id && typeOf.get(link.from) === wantedType)
        );
      // A fact-time window reaches an entity through its own dates and through the
      // statements that name it, which is the join the server makes: a person is in
      // June because something said about them happened in June.
      const temporalFrom = url.searchParams.get('temporal_from') ?? '';
      const temporalTo = url.searchParams.get('temporal_to') ?? '';
      const inPeriod = temporalFrom && temporalTo
        ? new Set(scopedTimelineRows({
            categories: (url.searchParams.get('temporal_category') ?? '').split(',').filter(Boolean),
            from: temporalFrom,
            to: temporalTo,
            includeUndated: false,
          }).flatMap((item) => [
            item.owner_id, ...item.subjects ?? [], ...item.places ?? [], ...item.sources ?? [],
          ]))
        : null;
      const matching = held.filter(
        (entity) =>
          (!wanted.length || wanted.includes(entity.type)) &&
          (!status || entity.provenance?.status === status) &&
          (!term || [entity.label, entity.type, ...Object.values(entity.attrs ?? {})]
            .some((heldValue) => String(heldValue ?? '').toLowerCase().includes(term))) &&
          (!field || !value || String(entity.attrs?.[field] ?? '') === value) &&
          (!linked || reaches(entity.id, linked)) &&
          (!inPeriod || inPeriod.has(entity.id))
      );
      const order = url.searchParams.get('order') ?? '';
      const descending = order.startsWith('-');
      const column = descending ? order.slice(1) : order;
      const direction = descending ? -1 : 1;
      const ordered = column
        ? [...matching].sort((left, right) => {
            const a = column === 'created' ? left.provenance?.at : left.label;
            const b = column === 'created' ? right.provenance?.at : right.label;
            return String(a ?? '').localeCompare(String(b ?? '')) * direction;
          })
        : matching;
      catalogQueries.push(url.search);
      // `catalogPage` makes the fixture answer in pages, which is the only way to
      // reach the surface's server-search mode: a case that fits one page filters
      // in the browser and never asks a second question.
      const page = options.catalogPage ?? 0;
      const items = page ? ordered.slice(0, page) : ordered;
      return json(route, {
        items,
        next_cursor: page && matching.length > page ? 'cursor-2' : null,
        total: matching.length,
      });
    }
    const galleryMatch = caseId && path.match(
      new RegExp(`^/api/cases/${caseId}/entities/([^/]+)/images(?:/([^/]+)(/primary)?)?$`)
    );
    if (galleryMatch) {
      const entityId = decodeURIComponent(galleryMatch[1]);
      const imageId = galleryMatch[2] ? decodeURIComponent(galleryMatch[2]) : null;
      const held = entityImages.get(entityId) ?? [];
      entityImages.set(entityId, held);
      const syncThumb = () => {
        const entity = fixtureCatalog.find((item) => item.id === entityId);
        const primary = held.find((image) => image.primary);
        if (!entity) return;
        if (primary) entity.thumb = primary.thumbnail ?? primary.path;
        else delete entity.thumb;
      };
      if (request.method() === 'GET' && !imageId) return json(route, { images: held });
      if (request.method() === 'POST' && imageId === 'upload') {
        const uploaded = {
          id: `photo-direct-${held.length + 1}`,
          media_id: null,
          direct: true,
          path: PANEL_PATH,
          thumbnail: null,
          title: 'Portrait',
          kind: 'image',
          position: held.length,
          primary: held.length === 0,
          ...(options.entityImageUploadResult ?? {}),
        };
        held.push(uploaded);
        syncThumb();
        galleryWrites.push({ method: 'UPLOAD', entityId, imageId: uploaded.id });
        return json(route, { added: 1, images: held });
      }
      if (request.method() === 'POST' && !imageId) {
        const body = request.postDataJSON();
        let added = 0;
        for (const id of body.media_ids) {
          if (held.some((image) => image.media_id === id)) continue;
          const item = fixtureMedia.find((candidate) => candidate.entity_id === id)
            ?? (options.uploadResult?.entity?.id === id ? options.uploadResult.item : null);
          held.push({
            ...(item ?? { path: PANEL_PATH, title: 'Photo', kind: 'image' }),
            id,
            media_id: id,
            direct: false,
            position: held.length,
            primary: held.length === 0,
          });
          added += 1;
        }
        syncThumb();
        galleryWrites.push({ method: 'POST', entityId, mediaIds: body.media_ids });
        return json(route, { added, images: held });
      }
      if (request.method() === 'PUT' && imageId && galleryMatch[3]) {
        for (const image of held) image.primary = image.id === imageId;
        syncThumb();
        galleryWrites.push({ method: 'PUT', entityId, imageId });
        return json(route, { images: held });
      }
      if (request.method() === 'DELETE' && imageId) {
        const removed = held.findIndex((image) => image.id === imageId);
        if (removed !== -1) held.splice(removed, 1);
        if (held.length && !held.some((image) => image.primary)) held[0].primary = true;
        syncThumb();
        galleryWrites.push({ method: 'DELETE', entityId, imageId });
        return json(route, { images: held });
      }
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
      const created = {
        id: options.newEntityId ?? 'e_new',
        ...payload,
        provenance: { by: 'user', at: '2026-08-03T10:00:00Z', status: 'confirmed' },
      };
      fixtureCatalog.push(created);
      return json(route, created);
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
    const placementMatch = caseId && path.match(
      new RegExp(`^/api/cases/${caseId}/entities/(.+)/placement$`)
    );
    if (placementMatch) {
      return json(
        route,
        options.placements?.[placementMatch[1]] ?? { points: [], truncated: false }
      );
    }
    // What the statements about one entity come to. Details asks for it whenever the
    // Connections tab is on screen, so every spec that opens a panel reaches it. 404 is the
    // ordinary answer — nothing states anything about this row — and `tallies` is how
    // a spec gives one a total.
    const tallyMatch = caseId && path.match(
      new RegExp(`^/api/cases/${caseId}/entities/(.+)/tally$`)
    );
    if (tallyMatch) {
      const row = options.tallies?.[tallyMatch[1]];
      return row ? json(route, row) : route.fulfill({ status: 404, body: '{}' });
    }
    const chainMatch = caseId && path.match(new RegExp(`^/api/cases/${caseId}/entities/(.+)/chain$`));
    if (chainMatch) {
      const chain = fixtureChains[chainMatch[1]];
      return json(route, chain ?? { entity: null, sources: [], lost: [], dependents: [], relations: [], empty: true });
    }
    const linkMatch = caseId && path.match(new RegExp(`^/api/cases/${caseId}/links(?:/(.+))?$`));
    if (linkMatch && request.method() !== 'GET') {
      const body = request.method() === 'DELETE' ? null : request.postDataJSON();
      linkWrites.push({ method: request.method(), id: linkMatch[1] ?? null, body });
      // The write lands in the case, so the next read answers with it. A stub that
      // recorded the request and forgot it made every surface look like it had
      // written nothing.
      if (request.method() === 'DELETE') {
        const gone = caseLinks.findIndex((link) => link.id === linkMatch[1]);
        if (gone !== -1) caseLinks.splice(gone, 1);
        return json(route, { status: 'deleted' });
      }
      if (linkMatch[1]) {
        // The drawn case is not the only place a fixture holds edges — a `chains`
        // entry carries its own — so an id this list does not know is echoed back
        // rather than refused, which is what the real route would answer for it.
        const held = caseLinks.find((link) => link.id === linkMatch[1]);
        if (held) {
          if (body.type) held.type = body.type;
          if (body.status) held.provenance.status = body.status;
        }
        return json(route, held ?? { id: linkMatch[1], ...body });
      }
      minted += 1;
      const filed = {
        id: `link-new-${minted}`,
        from: body.from_id,
        to: body.to_id,
        type: body.type,
        provenance: { by: 'user', at: '2026-08-03T09:00:00Z', status: 'confirmed' },
      };
      caseLinks.push(filed);
      return json(route, filed);
    }
    if (caseId && path === `/api/cases/${caseId}/media/reveal` && request.method() === 'POST') {
      revealed.push(request.postDataJSON()?.path ?? '');
      return json(route, { path: '/workspace/cases/browser-test/azimut/media' });
    }
    if (caseId && path === `/api/cases/${caseId}/media/paste` && request.method() === 'POST') {
      // The clipboard route answers the shape `upload` does, plus whatever the paste
      // dialog stated: the title that names the file and the origin it typed.
      const body = request.postData() ?? '';
      const field = (name) => body.match(new RegExp(`name="${name}"\\r?\\n\\r?\\n([^\\r]*)`))?.[1] ?? '';
      pastes.push({ title: field('title'), source_url: field('source_url'), length: body.length });
      const result = options.pasteResult ?? {
        duplicate: false,
        entity: {
          id: 'media-pasted',
          type: 'media',
          label: field('title') || 'paste-20260811-120000',
          attrs: { path: 'media/pasted.png', kind: 'image', sha256: 'def' },
          provenance: { by: 'paste', at: '2026-08-11T12:00:00Z', status: 'confirmed' },
        },
        item: { path: 'media/pasted.png', kind: 'image' },
      };
      if (!result.duplicate && result.entity) fixtureCatalog.push(result.entity);
      return json(route, result);
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
        items: fixtureMedia,
        next_cursor: null,
        total: fixtureMedia.length,
        facets: {
          category_counts: { image: fixtureMedia.length, upload: fixtureMedia.length },
          folder_counts: {},
          gps_count: 0,
          thumbnail_pending: 0,
        },
      });
    }
    if (path === `/api/cases/${CASE_ID}/media`) return json(route, fixtureMedia);
    // One media file with everything its sidecar holds. The browse index leaves
    // enrichment's metadata dumps out, so the Details panel reads a file at a time.
    if (path === `/api/cases/${CASE_ID}/media/item`) {
      const wanted = url.searchParams.get('path');
      const found = fixtureMedia.find((item) => item.path === wanted);
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
    galleryWrites,
    catalogQueries,
    graphQueries,
    graphPinWrites,
    analysisWrites,
    timelineWrites,
    uploads,
    pastes,
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
