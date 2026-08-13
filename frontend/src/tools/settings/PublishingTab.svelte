<script>
  /**
   * What a new Geo Report starts from, and the logo signed proofs carry.
   *
   * The logo lives beside settings.json and reaches a case only inside an
   * exported proof PNG; `sigBust` re-fetches the preview past the cache after a
   * replacement.
   */
  import { POST_TARGETS } from '../../lib/post.js';

  let {
    signature,
    sigBust,
    savePrefs,
    removeSignature,
    uploadSignature,
    mention = $bindable(),
    postTarget = $bindable(),
    signatureHandle = $bindable(),
    sigInput = $bindable(),
  } = $props();
</script>

<section class="group">
  <h3>Geo Report</h3>
  <div class="row">
    <div class="row-label">
      <span>Default mention</span>
      <span class="row-hint">Pre-filled on a new draft. Leave empty for none.</span>
    </div>
    <input
      class="input mention"
      bind:value={mention}
      onchange={() => savePrefs({ post_mention: mention })}
      placeholder="@GeoConfirmed"
      spellcheck="false"
    />
  </div>
  <div class="row">
    <div class="row-label">
      <span>Preferred platform</span>
      <span class="row-hint">Used for new Geo Report drafts.</span>
    </div>
    <div class="seg" role="group" aria-label="Preferred platform">
      {#each Object.values(POST_TARGETS) as option (option.id)}
        <button
          class="seg-btn"
          class:on={postTarget === option.id}
          onclick={() => {
            postTarget = option.id;
            savePrefs({ post_target: option.id });
          }}
        >{option.label}</button>
      {/each}
    </div>
  </div>
</section>

<section class="group">
  <h3>Signature</h3>
  <div class="row">
    <div class="row-label">
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
    />
  </div>
  <div class="row">
    <div class="row-label">
      <span>Your logo</span>
      <span class="row-hint">
        Transparent PNG, up to 2 MB, used only on signed proofs.
      </span>
    </div>
    <div class="sig-side">
      {#if signature}
        <img class="sig-preview" src={`/api/settings/signature.png?v=${sigBust}`} alt="Your signature" />
      {/if}
      <div class="sig-buttons">
        <button class="btn btn-sm" onclick={() => sigInput?.click()}>
          {signature ? 'Replace…' : 'Choose PNG…'}
        </button>
        {#if signature}
          <button class="btn btn-danger btn-sm" onclick={removeSignature}>Remove</button>
        {/if}
      </div>
    </div>
    <input
      bind:this={sigInput}
      class="sig-file"
      type="file"
      accept="image/png"
      onchange={uploadSignature}
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
    /* Checkerboard preview for transparent logos. */
    max-width: 88px;
    max-height: 44px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background-color: var(--bg-2);
    background-image:
      linear-gradient(45deg, var(--bg-3) 25%, transparent 25% 75%, var(--bg-3) 75%),
      linear-gradient(45deg, var(--bg-3) 25%, transparent 25% 75%, var(--bg-3) 75%);
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
</style>
