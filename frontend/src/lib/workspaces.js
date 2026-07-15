/**
 * Workspace model (docs/UI.md §3): the rail holds a fixed set of activity
 * workspaces in investigation-pipeline order; tools are tabs inside them.
 * `uiState.tool` stays the single source of truth everywhere — the active
 * workspace is always derived from the active tool, so cross-tool handoffs
 * (`uiState.tool = 'proof'`) keep working untouched.
 *
 * Future tools land as new entries in a workspace's `tools` array, never as
 * new rail entries. The Case workspace arrives with the v3 investigation
 * layer (today the case sidebar covers it).
 */
export const WORKSPACES = [
  { id: 'collect', label: 'Collect', icon: 'download', tools: ['media'] },
  { id: 'examine', label: 'Examine', icon: 'inspect', tools: ['inspect'] },
  { id: 'map', label: 'Map', icon: 'satellite', tools: ['satellite'] },
  { id: 'compose', label: 'Compose', icon: 'proof', tools: ['proof', 'post'] },
];

export function workspaceOf(tool) {
  return WORKSPACES.find((w) => w.tools.includes(tool)) ?? null;
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
  const ws = WORKSPACES.find((w) => w.id === head);
  if (!ws) return null;
  return sub && ws.tools.includes(sub) ? sub : ws.tools[0];
}
