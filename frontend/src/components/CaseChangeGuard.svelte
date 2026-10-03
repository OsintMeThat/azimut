<script>
  import { onDestroy } from 'svelte';
  import { caseState, registerCaseChangeGuard } from '../lib/state.svelte.js';
  import { anyUnsaved } from '../lib/backButton.js';
  import ConfirmDialog from './ConfirmDialog.svelte';

  let pending = $state(null);

  function answer(accepted) {
    const request = pending;
    pending = null;
    request?.resolve(accepted && request.fromId === caseState.current?.id);
  }

  onDestroy(registerCaseChangeGuard(({ fromId, reason }) => {
    if (!anyUnsaved()) return true;
    answer(false);
    return new Promise((resolve) => { pending = { fromId, promote: reason === 'promote', resolve }; });
  }));
  onDestroy(() => answer(false));
</script>

{#if pending?.promote}
  <ConfirmDialog title="Keep this session as a case?" message="Unsaved work in this session will be lost."
                 confirmLabel="Keep as case" cancelLabel="Keep editing" icon="folder"
                 onconfirm={() => answer(true)} oncancel={() => answer(false)} />
{:else if pending}
  <ConfirmDialog title="Change case?" message="Unsaved work in this case will be lost."
                 confirmLabel="Change case" cancelLabel="Keep editing" icon="folder"
                 onconfirm={() => answer(true)} oncancel={() => answer(false)} />
{/if}
