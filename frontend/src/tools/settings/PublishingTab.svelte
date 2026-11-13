<script>
  /**
   * What a new post starts from, who a report is from, and the handle
   * signed proofs carry.
   *
   * The logo and the signature picture live beside settings.json and reach a
   * case only inside what is exported (a proof PNG, a plate, a note's PDF), and
   * every tool reads the logo at `myLogoUrl()`, which changes with it. A logo picked
   * opens the logo editor first, and Edit… opens it again on the picture as picked
   * (`LogoEditor.svelte`). In reports, a note prints your name, role and
   * organisation where it says `{name}`, `{role}` and `{organisation}`
   * (`lib/notes/reportParts.js`), as its Signature block does. The hover texts
   * live in `lib/publishingHelp.js`.
   */
  import { defaultMention, POST_TARGETS } from '../../lib/post.js';
  import { api } from '../../lib/api.js';
  import { prefs, toast } from '../../lib/state.svelte.js';
  import { LOGO_MAX_BYTES, PUBLISHING_HELP as HELP, REPORT_FIELD_MAX, SIGNATURE_MAX_MB } from '../../lib/publishingHelp.js';
  import { myLogoUrl } from '../../lib/myLogo.js';
  import LogoEditor from './LogoEditor.svelte';

  let {
    signature,
    logoLook = null,
    savePrefs,
    removeSignature,
    saveLogo,
    mention = $bindable(),
    postTarget = $bindable(),
    postPrefill = $bindable(),
    signatureHandle = $bindable(),
  } = $props();

  // What a new Bluesky post is addressed to: its own once chosen, else what the app
  // decides from the X mention as saved (lib/post.js `defaultMention`), shown in the
  // field so the analyst sees it. Nothing is saved until the field is edited, and an
  // emptied one is no mention, which is a choice too.
  const blueskyMention = $derived(defaultMention('bluesky', { x: prefs.postMention, bluesky: prefs.postMentionBluesky }));

  let handInput = $state(null);
  let logoInput = $state(null);
  // The picture the logo editor works on and the look it opens with, while it is open.
  let editing = $state.raw(null);

  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  async function pickLogo(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = ''; // the same file can be picked again
    if (!file) return;
    if (file.size > LOGO_MAX_BYTES) {
      toast('The logo must be under 2 MB', 'danger');
      return;
    }
    const head = new Uint8Array(await file.slice(0, PNG_MAGIC.length).arrayBuffer());
    if (!PNG_MAGIC.every((byte, index) => head[index] === byte)) {
      toast('The logo must be a PNG picture', 'danger');
      return;
    }
    editing = { picture: file, look: null };
  }

  /** Open the editor on the picture as picked: the original of a framed logo, or the logo itself. */
  async function editLogo() {
    try {
      const path = logoLook ? '/api/settings/logo-original.png' : '/api/settings/signature.png';
      const { data } = await api.get(path, { bytes: true, cache: 'no-store' });
      editing = { picture: new Blob([data], { type: 'image/png' }), look: logoLook };
    } catch (error) {
      toast(`Could not open the logo: ${error.message}`, 'danger');
    }
  }

  async function saveEdited({ logo, look }) {
    await saveLogo({ logo, original: editing.picture, look });
    editing = null;
  }

  /** A line of who signs, saved once the field is left. */
  function saveLine(key, value) {
    const line = value.replace(/\s+/g, ' ').trim();
    savePrefs({ [key]: line });
  }

  async function uploadHand(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = ''; // the same file can be picked again
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    try {
      await api.post('/api/settings/report-signature', body);
      prefs.signatureSet = true;
      prefs.picturesRev += 1;
      toast('Signature saved', 'ok');
    } catch (error) {
      toast(`Could not save the signature: ${error.message}`, 'danger');
    }
  }

  async function removeHand() {
    try {
      await api.del('/api/settings/report-signature');
      prefs.signatureSet = false;
      prefs.picturesRev += 1;
      toast('Signature removed', 'ok');
    } catch (error) {
      toast(`Could not remove the signature: ${error.message}`, 'danger');
    }
  }
</script>

<section class="group" data-guide="settings.report-defaults">
  <h3>Post</h3>
  <div class="row">
    <div class="row-label" title={HELP.mention}>
      <span>Mention on X</span>
      <span class="row-hint">Pre-filled on a new X post. Leave empty for none.</span>
    </div>
    <input
      class="input mention"
      bind:value={mention}
      onchange={() => savePrefs({ post_mention: mention })}
      placeholder="@GeoConfirmed"
      spellcheck="false"
      aria-label="Mention on X"
      title={HELP.mention}
    />
  </div>
  <div class="row">
    <div class="row-label" title={HELP.mentionBluesky}>
      <span>Mention on Bluesky</span>
      <span class="row-hint">A handle there is a domain, like @name.bsky.social. Leave empty for none.</span>
    </div>
    <input
      class="input mention"
      value={blueskyMention}
      onchange={(event) => savePrefs({ post_mention_bluesky: event.currentTarget.value })}
      placeholder="@name.bsky.social"
      spellcheck="false"
      aria-label="Mention on Bluesky"
      title={HELP.mentionBluesky}
    />
  </div>
  <div class="row">
    <div class="row-label" title={HELP.platform}>
      <span>Preferred platform</span>
      <span class="row-hint">Used for new posts.</span>
    </div>
    <div class="seg" role="group" aria-label="Preferred platform">
      {#each Object.values(POST_TARGETS) as option (option.id)}
        <button
          class="seg-btn"
          class:on={postTarget === option.id}
          title={HELP.platform}
          onclick={() => {
            postTarget = option.id;
            savePrefs({ post_target: option.id });
          }}
        >{option.label}</button>
      {/each}
    </div>
  </div>
  <div class="row">
    <div class="row-label" title={HELP.prefill}>
      <span>Let the extension fill the composer</span>
      <span class="row-hint">
        Publish types the thread and attaches the proof with the capture extension,
        and only opens the page without it.
      </span>
    </div>
    <input
      type="checkbox"
      bind:checked={postPrefill}
      onchange={() => savePrefs({ post_prefill: postPrefill })}
      aria-label="Let the extension fill the composer"
      title={HELP.prefill}
    />
  </div>
</section>

<section class="group" data-guide="settings.signature">
  <h3>In reports</h3>
  <p class="note">
    A note prints these where it says so: type / in a note and pick Signature, or Your logo.
    Each is optional, and a line left empty is left out.
  </p>
  <div class="row">
    <div class="row-label" title={HELP.logo}>
      <span>Logo</span>
      <span class="row-hint">Transparent PNG, up to 2 MB. Signed proofs and Map plates carry it too.</span>
    </div>
    <div class="sig-side">
      {#if signature}
        <img class="sig-preview" src={myLogoUrl()} alt="Your logo" />
      {/if}
      <div class="sig-buttons">
        {#if signature}
          <button class="btn btn-sm" title={HELP.logoEdit} onclick={editLogo}>Edit…</button>
        {/if}
        <button class="btn btn-sm" title={HELP.logo} onclick={() => logoInput?.click()}>
          {signature ? 'Replace…' : 'Choose PNG…'}
        </button>
        {#if signature}
          <button class="btn btn-danger btn-sm" title={HELP.logoRemove} onclick={removeSignature}>Remove</button>
        {/if}
      </div>
    </div>
    <input
      bind:this={logoInput}
      class="sig-file"
      type="file"
      accept="image/png"
      title={HELP.logo}
      onchange={pickLogo}
    />
  </div>
  {#if editing}
    <LogoEditor picture={editing.picture} look={editing.look} onsave={saveEdited} onclose={() => (editing = null)} />
  {/if}
  <label class="row" title={HELP.name}>
    <span class="row-label">
      <span>Name</span>
      <span class="row-hint">As it should read under a report, at most {REPORT_FIELD_MAX} characters.</span>
    </span>
    <input class="input who" value={prefs.reportName} maxlength={REPORT_FIELD_MAX} placeholder="A. Analyst" title={HELP.name}
      onchange={(event) => saveLine('report_name', event.currentTarget.value)} />
  </label>
  <label class="row" title={HELP.role}>
    <span class="row-label">
      <span>Role</span>
      <span class="row-hint">Your job title, such as Analyst or Editor.</span>
    </span>
    <input class="input who" value={prefs.reportRole} maxlength={REPORT_FIELD_MAX} placeholder="Analyst" title={HELP.role}
      onchange={(event) => saveLine('report_role', event.currentTarget.value)} />
  </label>
  <label class="row" title={HELP.organisation}>
    <span class="row-label">
      <span>Organisation</span>
      <span class="row-hint">Your team, desk or newsroom.</span>
    </span>
    <input class="input who" value={prefs.reportOrganisation} maxlength={REPORT_FIELD_MAX} placeholder="Open Source Desk" title={HELP.organisation}
      onchange={(event) => saveLine('report_organisation', event.currentTarget.value)} />
  </label>
  <div class="row">
    <div class="row-label" title={HELP.signature}>
      <span>Signature</span>
      <span class="row-hint">
        Sign in dark ink on white paper, photograph it and crop it close. PNG, transparent is best, up to {SIGNATURE_MAX_MB} MB.
      </span>
    </div>
    <div class="sig-side">
      {#if prefs.signatureSet}
        <img class="sig-preview" src={`/api/notes/pictures/my-signature?v=${prefs.picturesRev}`} alt="Your signature" />
      {/if}
      <div class="sig-buttons">
        <button class="btn btn-sm" title={HELP.signature} onclick={() => handInput?.click()}>
          {prefs.signatureSet ? 'Replace…' : 'Choose PNG…'}
        </button>
        {#if prefs.signatureSet}
          <button class="btn btn-danger btn-sm" title={HELP.signatureRemove} onclick={removeHand}>Remove</button>
        {/if}
      </div>
    </div>
    <input bind:this={handInput} class="sig-file" type="file" accept="image/png" title={HELP.signature} onchange={uploadHand} />
  </div>
</section>

<section class="group" data-guide="settings.proof-handle">
  <h3>On proofs</h3>
  <div class="row">
    <div class="row-label" title={HELP.handle}>
      <span>Your account handle</span>
      <span class="row-hint">Shown on proofs that enable “Add account handle”.</span>
    </div>
    <input
      class="input mention"
      bind:value={signatureHandle}
      onchange={() => savePrefs({ signature_handle: signatureHandle })}
      placeholder="@my_handle"
      maxlength="64"
      spellcheck="false"
      title={HELP.handle}
    />
  </div>
</section>

<style>
  .sig-side {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .sig-preview {
    /* A light checkerboard: transparent pictures show as they print on white, dark ink included. */
    max-width: 88px;
    max-height: 44px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background-color: #fff;
    background-image:
      linear-gradient(45deg, #ececec 25%, transparent 25% 75%, #ececec 75%),
      linear-gradient(45deg, #ececec 25%, transparent 25% 75%, #ececec 75%);
    background-size: 10px 10px;
    background-position: 0 0, 5px 5px;
  }

  .sig-buttons {
    display: flex;
    gap: 6px;
  }

  .sig-file {
    display: none;
  }

  .mention {
    width: 200px;
    flex-shrink: 0;
  }

  .who {
    width: 220px;
    flex-shrink: 0;
  }

  label.row {
    cursor: default;
  }
</style>
