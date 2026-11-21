<script>
  /**
   * Settings › Website › WordPress: the site a note is sent to as a draft.
   *
   * The address and the username save when a field is left; the application password
   * goes up once when typed and never comes back, only whether one is kept and its
   * last four characters (`lib/wordpress.js`). Nothing here reaches the site but Test
   * connection, on its press. The steps are the export dialog's too (`lib/wordpressSetup.js`),
   * open while something is missing.
   */
  import Icon from '../../components/Icon.svelte';
  import { toast } from '../../lib/state.svelte.js';
  import { WEBSITE_HELP as HELP } from '../../lib/websiteSetup.js';
  import { forgetWordPress, readWordPress, saveWordPress, testWordPress } from '../../lib/wordpress.js';
  import {
    PASSWORD_WHERE, WORDPRESS_COM, WORDPRESS_FIELDS, WORDPRESS_FREE, WORDPRESS_GUIDE, siteHost, wordpressReady,
  } from '../../lib/wordpressSetup.js';

  let state = $state(null);
  let site = $state('');
  let user = $state('');
  let password = $state('');
  let saving = $state(false);
  // what Test connection said: null, 'testing', or { ok, text }
  let tested = $state(null);

  const ready = $derived(wordpressReady(state));

  $effect(() => {
    let live = true;
    readWordPress()
      .then((value) => { if (live) take(value); })
      .catch((error) => { if (live) { take({ site: '', user: '', password: { set: false, hint: '' } }); toast(`Could not read the WordPress settings: ${error.message}`, 'warn'); } });
    return () => { live = false; };
  });

  function take(value) {
    state = value;
    site = value.site;
    user = value.user;
  }

  /** One field saved; what the server keeps is what the field shows after. */
  async function save(patch) {
    saving = true;
    tested = null;
    try {
      take(await saveWordPress(patch));
      return true;
    } catch (error) {
      toast(error.message, 'danger', 6000);
      site = state?.site ?? '';
      user = state?.user ?? '';
      return false;
    } finally {
      saving = false;
    }
  }

  function saveSite() {
    if (site.trim() !== (state?.site ?? '')) void save({ site: site.trim() });
  }

  function saveUser() {
    if (user.trim() !== (state?.user ?? '')) void save({ user: user.trim() });
  }

  async function savePassword() {
    const typed = password.trim();
    if (!typed) return;
    if (await save({ password: typed })) {
      password = '';
      toast('Application password kept on this computer', 'ok');
    }
  }

  async function test() {
    tested = 'testing';
    try {
      const answer = await testWordPress();
      const where = answer.site_name ? ` on ${answer.site_name}` : '';
      tested = answer.ok
        ? { ok: true, text: `Connected as ${answer.name || state.user}${where}.` }
        : { ok: false, text: answer.detail || 'The site did not answer as WordPress.' };
    } catch (error) {
      tested = { ok: false, text: error.message };
    }
  }

  async function forget() {
    try {
      take(await forgetWordPress());
      password = '';
      tested = null;
      toast('WordPress forgotten on this computer', 'ok');
    } catch (error) {
      toast(error.message, 'danger');
    }
  }
</script>

<section class="group wordpress" data-guide="settings.wordpress" aria-label="WordPress">
  <h3>WordPress</h3>
  <p class="intro">Send a note to your own WordPress site as a draft, pictures and sources included. You publish it there.</p>
  <label class="row" title={HELP.wordpressSite}>
    <span class="row-label">
      <span>Site address</span>
      <span class="row-hint">{WORDPRESS_FIELDS[0][1]}</span>
    </span>
    <input class="input wide" bind:value={site} onchange={saveSite} placeholder="https://example.org" spellcheck="false"
      autocomplete="url" disabled={state === null} title={HELP.wordpressSite} />
  </label>
  <label class="row" title={HELP.wordpressUser}>
    <span class="row-label">
      <span>Username</span>
      <span class="row-hint">{WORDPRESS_FIELDS[1][1]}</span>
    </span>
    <input class="input wide" bind:value={user} onchange={saveUser} placeholder="editor" spellcheck="false"
      autocomplete="username" disabled={state === null} title={HELP.wordpressUser} />
  </label>
  <label class="row" title={HELP.wordpressPassword}>
    <span class="row-label">
      <span>Application password</span>
      <span class="row-hint">
        {#if state?.password.set}Kept on this computer{state.password.hint ? `, ending ${state.password.hint.replace('…', '')}` : ''}. Type a new one to replace it.
        {:else}Made in {PASSWORD_WHERE}. Kept on this computer only, never in a backup.{/if}
      </span>
    </span>
    <input class="input wide mono" type="password" bind:value={password} onchange={savePassword}
      placeholder={state?.password.set ? `•••• •••• ${state.password.hint.replace('…', '')}` : 'abcd EFGH 1234 ijkl MNOP 6789'}
      autocomplete="new-password" spellcheck="false" disabled={state === null} title={HELP.wordpressPassword} />
  </label>
  <div class="row actions">
    <span class="said" role="status" data-state={tested === 'testing' ? 'testing' : tested?.ok ? 'ok' : tested ? 'error' : ''}>
      {#if tested === 'testing'}Signing in to {siteHost(state?.site)}…
      {:else if tested}<Icon name={tested.ok ? 'check' : 'alert'} size={12} /> {tested.text}
      {:else if ready}Drafts go to {siteHost(state.site)} as {state.user}.{/if}
    </span>
    <button class="btn btn-sm" onclick={test} disabled={!ready || saving || tested === 'testing'} title={HELP.wordpressTest}>
      Test connection</button>
    <button class="btn btn-ghost btn-sm" onclick={forget} disabled={!state || (!state.site && !state.user && !state.password.set)}
      title={HELP.wordpressForget}>Forget</button>
  </div>
  {#if state}
    <details class="how" open={!ready}>
      <summary title={HELP.wordpressHow}>How to connect a site</summary>
      <dl>
        {#each WORDPRESS_FIELDS as [name, said] (name)}
          <dt>{name}</dt><dd>{said}</dd>
        {/each}
      </dl>
      <p class="note">{WORDPRESS_FREE}</p>
      <p class="note">{WORDPRESS_COM}</p>
      <a class="guide" href={WORDPRESS_GUIDE} target="_blank" rel="noopener noreferrer" title={HELP.wordpressGuide}>
        WordPress's guide to application passwords <Icon name="external" size={11} /></a>
    </details>
  {/if}
</section>

<style>
  .wide { width: 300px; flex-shrink: 0; }
  .mono { font-family: var(--font-mono); }
  label.row { cursor: default; }
  .actions { justify-content: flex-end; gap: 8px; margin-top: 4px; }
  .said { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 5px; color: var(--text-3); font-size: var(--fs-xs); }
  .said[data-state='ok'] { color: var(--ok); }
  .said[data-state='error'] { color: var(--danger); }
  .how { margin-top: 10px; border: 1px solid var(--border); border-radius: var(--r-md); padding: 6px 12px 10px; background: var(--bg-1); }
  .how summary { cursor: pointer; color: var(--text-2); font-size: var(--fs-sm); padding: 2px 0; }
  .how dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 10px 0 2px; font-size: var(--fs-xs); }
  .how dt { color: var(--text-1); font-weight: 600; }
  .how dd { margin: 0; color: var(--text-2); line-height: 1.5; }
  .guide { display: inline-flex; align-items: center; gap: 4px; margin-top: 8px; font-size: var(--fs-xs); color: var(--accent); }
</style>
