/**
 * Workspace model (docs/UI.md §3): the rail holds a fixed set of activity
 * workspaces in investigation-pipeline order; tools are tabs inside them.
 * `uiState.tool` stays the single source of truth everywhere — the active
 * workspace is always derived from the active tool, so cross-tool handoffs
 * (`uiState.tool = 'proof'`) keep working untouched.
 *
 * Future tools land as new entries in a workspace's `tools` array rather than as
 * new rail entries.
 *
 * `case` is a workspace like any other — tabs, deep links, its own remembered
 * sidebar — but it is not on the rail. The rail reads as a sequence of stages,
 * and the case is not a stage: it is what every stage files into. It hangs off
 * the case switcher in the topbar instead, beside the name of the case it opens.
 */
export const CASE_WORKSPACE = {
  id: 'case',
  label: 'Case',
  icon: 'graph',
  tools: ['board', 'graph', 'timeline', 'sheet'],
};

/**
 * Where the app opens, and the same argument decides where it sits: the rail is a
 * sequence of stages and home is not one of them, so it hangs off the wordmark in
 * the topbar rather than taking a fifth rail seat. Every app puts home on its own
 * mark, which is the one affordance that needs no label.
 *
 * Two tabs. *Overview* answers "what is this case waiting on" for somebody who has
 * been here before; *Guide* answers "what is this app" for somebody who has not. A
 * fresh install has no case to summarise, so the overview's empty state is the front
 * door and the guide is one click from it.
 */
export const HOME_WORKSPACE = {
  id: 'home',
  label: 'Home',
  icon: 'compass',
  tools: ['overview', 'guide'],
};

/** The rail, in investigation order. */
export const WORKSPACES = [
  { id: 'collect', label: 'Sources', icon: 'download', tools: ['media', 'files', 'reverse'] },
  { id: 'examine', label: 'Examine', icon: 'inspect', tools: ['inspect'] },
  { id: 'map', label: 'Map', icon: 'satellite', tools: ['satellite', 'coordinates'] },
  { id: 'compose', label: 'Compose', icon: 'proof', tools: ['proof', 'post', 'notebook'] },
];

/** Every workspace, on the rail or not — what tool lookup and deep links resolve against. */
export const ALL_WORKSPACES = [HOME_WORKSPACE, CASE_WORKSPACE, ...WORKSPACES];

export const TOOL_LABELS = {
  overview: 'Overview',
  guide: 'Guide',
  board: 'Board',
  graph: 'Graph',
  timeline: 'Timeline',
  sheet: 'Sheet',
  media: 'Media',
  files: 'Files',
  reverse: 'Reverse Search',
  inspect: 'Inspect',
  satellite: 'Satellite',
  coordinates: 'Coords & Sky',
  proof: 'Geo Proof',
  post: 'Geo Report',
  notebook: 'Notebook',
  settings: 'Settings',
};

export function workspaceOf(tool) {
  return ALL_WORKSPACES.find((w) => w.tools.includes(tool)) ?? null;
}

/** Return the session's sidebar state for a workspace, falling back to defaults.
 *
 *  Closed on `map`, which needs the width; on `case`, where the board already lists
 *  the same entities — two lists of one case side by side is a question about which
 *  one is the real one — and on `home`, which is read rather than worked in and whose
 *  whole subject is the case the sidebar would be listing again. */
const SIDEBAR_CLOSED = new Set(['map', 'case', 'home']);

export function sidebarOpenForWorkspace(workspaceId, remembered = {}) {
  if (remembered[workspaceId] !== undefined) return remembered[workspaceId];
  return !SIDEBAR_CLOSED.has(workspaceId);
}

/**
 * Resolve a location hash to a tool id, or null if it matches nothing.
 * Accepted forms, in priority order:
 *   '#<tool>'            — stable pre-workspace links (#media, #proof, …)
 *   '#<workspace>/<tool>' — a specific tab (#compose/post)
 *   '#<workspace>'       — the workspace's first tool (#compose → proof)
 */
export function toolFromHash(hash, allTools) {
  const [head, sub] = hash.replace(/^#/, '').split('/');
  if (allTools.includes(head)) return head;
  const ws = ALL_WORKSPACES.find((w) => w.id === head);
  if (!ws) return null;
  return sub && ws.tools.includes(sub) ? sub : ws.tools[0];
}
