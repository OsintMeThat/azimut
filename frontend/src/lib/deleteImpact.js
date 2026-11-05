/**
 * What a delete would touch, read before it is pressed.
 *
 * Every delete dialog asks the one route (`POST .../delete-impact`, `engine/uses.py`)
 * and draws the answer the same way, so the analyst always learns what else the
 * click reaches. A dialog names its target the way its delete does: entities by id,
 * a file or a record by its path, and saved work a tool deletes by name by that tool
 * and that name, so the preview is of the very thing the delete will take.
 */
import { api } from './api.js';

/** The tools whose saved work is deleted by name (`api/impact.py`, `Tool`). */
export const NAMED_TOOLS = new Set([
  'collage', 'plate', 'draft', 'comparison', 'find', 'inspect', 'areas', 'zones', 'followups', 'runs',
]);

/** The body of one preview request: only what was named, de-duplicated. */
export function impactBody({ ids = [], paths = [], named = [] } = {}) {
  const unique = (list) => [...new Set(list.filter(Boolean))];
  return {
    ids: unique(ids),
    paths: unique(paths),
    named: named.filter((one) => NAMED_TOOLS.has(one?.tool) && one.name),
  };
}

/** How many things one target description names, so the words can say "it" or "them". */
export function targetCount(target) {
  const body = impactBody(target ?? {});
  return body.ids.length + body.paths.length + body.named.length;
}

/** A stable key for a target, so a dialog asks again only when the target changed. */
export function impactKey(target) {
  if (!target?.caseId) return '';
  const body = impactBody(target);
  if (!body.ids.length && !body.paths.length && !body.named.length) return '';
  return JSON.stringify([target.caseId, body]);
}

/** How long a dialog holds its confirm button for the answer. Past it the button is
 *  freed and the dialog says the check did not come back: a slow server must not
 *  leave a delete that cannot be pressed. */
export const IMPACT_WAIT_MS = 10_000;

/** Ask the server what deleting the target would touch. */
export function fetchImpact(target, { post = api.post, wait = IMPACT_WAIT_MS } = {}) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('the check did not come back')), wait);
  });
  return Promise.race([post(`/api/cases/${target.caseId}/delete-impact`, impactBody(target)), late]).finally(
    () => clearTimeout(timer)
  );
}

/** How many other records the delete reaches, across every group. */
export function impactTotal(impact) {
  const counts = impact?.counts ?? {};
  return (
    (counts.blocking ?? 0) + (counts.cascade ?? 0) + (counts.tombstone ?? 0) + (counts.touched ?? 0)
  );
}

/** Whether the delete will be refused: something holds the target and must let go first
 *  (a Detect routine watching an area). The dialog keeps its confirm button off. */
export function impactBlocked(impact) {
  return (impact?.counts?.blocking ?? impact?.blocking?.length ?? 0) > 0;
}

/** The groups a dialog lists, in the order they matter: what refuses the delete, what
 *  goes, what is scarred, what loses a link. `it` is "it" or "them", after how many
 *  targets there are. */
export function impactGroups(impact, it = 'it') {
  const groups = [
    { key: 'blocking', tone: 'danger', icon: 'lock', heading: `Take ${it} out of these first` },
    { key: 'cascade', tone: 'danger', icon: 'trash', heading: `Deleted with ${it} because they cannot stand alone` },
    { key: 'tombstone', tone: '', icon: 'check', heading: `Kept with a record of ${it === 'it' ? 'its' : 'their'} missing source` },
    { key: 'touched', tone: '', icon: 'link', heading: `Kept, losing their link to ${it}` },
  ];
  return groups
    .map((group) => {
      const items = impact?.[group.key] ?? [];
      const count = impact?.counts?.[group.key] ?? items.length;
      return { ...group, items, more: Math.max(0, count - items.length) };
    })
    .filter((group) => group.items.length > 0);
}

/** The one line above the groups: how many records the delete reaches, or that it
 *  reaches none. */
export function impactLead(impact, it = 'it') {
  const total = impactTotal(impact);
  if (!total) return `Nothing else in the case uses ${it}.`;
  return `Linked to ${total} other ${total === 1 ? 'item' : 'items'} in the case.`;
}

/** What a touched record does with the target, as the muted half of its line. */
export function impactHow(item) {
  return (item?.how ?? []).join(', ');
}

/** The line a dialog shows when the check failed or never came back. */
export function impactUnknown(it = 'it') {
  return `Could not check what else ${it} touches.`;
}

/** Whether a delete that never asked before may still go ahead without asking: yes
 *  when the server says it touches nothing. An unanswered question is not a yes, so
 *  the dialog opens and says what it can. */
export async function touchesNothing(target, { post = api.post } = {}) {
  try {
    return impactTotal(await fetchImpact(target, { post })) === 0;
  } catch {
    return false;
  }
}
