<script>
  /**
   * Settings › Website › WordPress: the site a note is sent to as a draft.
   *
   * The address and the username save when a field is left; the application password
   * goes up once when typed and never comes back, only whether one is kept and its
   * last four characters (`lib/wordpress.js`). Nothing here reaches the site but Test
   * connection, on its press, which says so with a spinner while it waits. The steps are the export dialog's too (`lib/wordpressSetup.js`),
   * open while something is missing.
   */
  import BusyLabel from '../../components/BusyLabel.svelte';
  import Icon from '../../components/Icon.svelte';
  import HubCard from './website/HubCard.svelte';
  import HubField from './website/HubField.svelte';
  import { toast } from '../../lib/state.svelte.js';
  import { BUSY, WEBSITE_HELP as HELP } from '../../lib/websiteSetup.js';
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

<HubCard label="WordPress" guide="settings.wordpress" title="WordPress">
  {#snippet aside()}
    {#if ready}<span class="hub-pill ok">Set up</span>{:else if state}<span class="hub-pill">Not set up</span>{/if}
  {/snippet}
  <p class="lead">Send a note to your own WordPress site as a draft, pictures and sources included. You publish it there.</p>
  <HubField id="wordpress-site" label="Site address" hint={WORDPRESS_FIELDS[0][1]}>
    <input id="wordpress-site" class="input" bind:value={site} onchange={saveSite} placeholder="https://example.org" spellcheck="false"
      autocomplete="url" disabled={state === null} title={HELP.wordpressSite} />
  </HubField>
  <HubField id="wordpress-user" label="Username" hint={WORDPRESS_FIELDS[1][1]}>
    <input id="wordpress-user" class="input" bind:value={user} onchange={saveUser} placeholder="editor" spellcheck="false"
      autocomplete="username" disabled={state === null} title={HELP.wordpressUser} />
  </HubField>
  <HubField id="wordpress-password" label="Application password"
    hint={state?.password.set
      ? `Kept on this computer${state.password.hint ? `, ending ${state.password.hint.replace('…', '')}` : ''}. Type a new one to replace it.`
      : `Made in ${PASSWORD_WHERE}. Kept on this computer only, never in a backup.`}>
    <input id="wordpress-password" class="input hub-mono" type="password" bind:value={password} onchange={savePassword}
      placeholder={state?.password.set ? `•••• •••• ${state.password.hint.replace('…', '')}` : 'abcd EFGH 1234 ijkl MNOP 6789'}
      autocomplete="new-password" spellcheck="false" disabled={state === null} title={HELP.wordpressPassword} />
  </HubField>
  <div class="actions">
    <button type="button" class="btn btn-sm" onclick={test} disabled={!ready || saving || tested === 'testing'} aria-busy={tested === 'testing'}
      title={HELP.wordpressTest}><BusyLabel busy={tested === 'testing'} text={BUSY.test}>Test connection</BusyLabel></button>
    <button type="button" class="btn btn-ghost btn-sm" onclick={forget} disabled={!state || (!state.site && !state.user && !state.password.set)}
      title={HELP.wordpressForget}>Forget</button>
    <span class="said hub-line" role="status" data-state={tested === 'testing' ? '' : tested?.ok ? 'ok' : tested ? 'error' : ''}>
      {#if tested && tested !== 'testing'}<Icon name={tested.ok ? 'check' : 'alert'} size={12} /> {tested.text}
      {:else if ready}Drafts go to {siteHost(state.site)} as {state.user}.{/if}
    </span>
  </div>
  {#if state}
    <details class="how hub-how" open={!ready}>
      <summary title={HELP.wordpressHow}>How to connect a site</summary>
      <dl>
        {#each WORDPRESS_FIELDS as [name, said] (name)}
          <dt>{name}</dt><dd>{said}</dd>
        {/each}
      </dl>
      <p class="note-line">{WORDPRESS_FREE}</p>
      <p class="note-line">{WORDPRESS_COM}</p>
      <a class="hub-ext" href={WORDPRESS_GUIDE} target="_blank" rel="noopener noreferrer" title={HELP.wordpressGuide}>
        WordPress's guide to application passwords <Icon name="external" size={11} /></a>
    </details>
  {/if}
</HubCard>

<style>
  .lead { margin: 0 0 6px; color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
  .said { flex: 1 1 200px; margin-left: 4px; }
  .how dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 10px 0 2px; font-size: var(--fs-xs); }
  .how dt { color: var(--text-1); font-weight: 600; }
  .how dd { margin: 0; color: var(--text-2); line-height: 1.5; }
  .how .hub-ext { margin-top: 8px; }
  .note-line { margin: 6px 0 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
</style>
