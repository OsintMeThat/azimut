<script>
  /**
   * The guide's own tab (`#guide?page=…`), mounted by `main.js` in place of the app.
   *
   * It reads its place from the address, and again when the app's button sends it a
   * new one. The theme and the accent follow the app's, changed in the other tab.
   */
  import { onDestroy } from 'svelte';
  import GuideDialog from './GuideDialog.svelte';
  import { splitHash } from '../lib/hash.js';
  import { readGuidePlace } from '../lib/guideWindow.js';
  import { applyTheme, loadTheme } from '../lib/theme.js';
  import { ACCENT_KEY, applyAccent, loadAccent } from '../lib/accent.js';

  const read = () => readGuidePlace(splitHash(location.hash).params);
  let place = $state.raw(read());

  document.title = 'Azimut guide';

  const onhashchange = () => (place = read());
  const onstorage = (event) => {
    if (event.key === 'azimut:theme') applyTheme(loadTheme());
    if (event.key === ACCENT_KEY) applyAccent(loadAccent());
  };
  window.addEventListener('hashchange', onhashchange);
  window.addEventListener('storage', onstorage);
  onDestroy(() => {
    window.removeEventListener('hashchange', onhashchange);
    window.removeEventListener('storage', onstorage);
  });
</script>

{#key place}
  <GuideDialog detached {place} />
{/key}
