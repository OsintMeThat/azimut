/** Preview a case-place deletion before using the shared Trash lifecycle. */
export function createPlaceDeletionState({ api, caseId, notify, reloadCase, ondeleted, refresh }) {
  let target = $state(null);
  let loading = $state(false);
  let busy = $state(false);
  let sequence = 0;

  function cancel() { sequence += 1; target = null; loading = false; }

  async function open(id) {
    const owner = caseId();
    if (!owner || busy) return;
    const stamp = ++sequence;
    loading = true;
    target = null;
    try {
      const [usage, consequences] = await Promise.all([
        api.get(`/api/cases/${owner}/map-layers/places/${id}/usage`),
        api.get(`/api/cases/${owner}/entities/${id}/dependents`),
      ]);
      if (caseId() === owner && stamp === sequence) target = { owner, id, usage, consequences };
    } catch (error) {
      if (caseId() === owner && stamp === sequence) notify(error.message, 'danger');
    } finally {
      if (stamp === sequence) loading = false;
    }
  }

  async function confirm() {
    const held = target;
    if (!held || busy || caseId() !== held.owner) return;
    busy = true;
    try {
      const result = await api.del(`/api/cases/${held.owner}/entities/${held.id}`);
      if (caseId() !== held.owner) return;
      cancel();
      await reloadCase();
      await refresh?.();
      ondeleted(held.owner, result, held.usage.place.label);
    } catch (error) { notify(error.message, 'danger'); }
    finally { busy = false; }
  }

  return { get target() { return target; }, get loading() { return loading; },
    get busy() { return busy; }, open, cancel, confirm };
}
