<script>
  /**
   * Support & feedback: a tip, a vote, an idea, the Discord, a problem, and who makes it. Opened from the rail and from
   * nowhere else, it never comes to the analyst, and nothing here reaches the network
   * until a link is pressed. A block waits for its link (lib/support.js).
   */
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import { openIssueReport } from '../lib/navigate.js';
  import {
    DISCORD_URL,
    FEEDBACK_FORM_URL,
    KOFI_URL,
    SITE_URL,
    TIP_LINE_SECONDS,
    drawTipLine,
  } from '../lib/support.js';

  let { kofi = KOFI_URL, form = FEEDBACK_FORM_URL, discord = DISCORD_URL, site = SITE_URL, onclose } = $props();
  const siteName = $derived(site ? new URL(site).host : '');

  // The line turns on its own unless a pointer or the keyboard rests on it, or the
  // system asks for less motion. Its box keeps the height of the longest, so the tip
  // button never moves under the cursor.
  let line = $state(drawTipLine(''));
  let held = $state(false);
  const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;

  $effect(() => {
    const shown = line;
    if (!kofi || held || still) return;
    const timer = setTimeout(() => (line = drawTipLine(shown)), TIP_LINE_SECONDS * 1000);
    return () => clearTimeout(timer);
  });

  function report() {
    openIssueReport();
    onclose();
  }
</script>

<Modal title="Support & feedback" {onclose} width="360px">
  {#if kofi}
    <button
      type="button"
      class="words"
      title="Another one"
      onclick={() => (line = drawTipLine(line))}
      onpointerenter={() => (held = true)}
      onpointerleave={() => (held = false)}
      onfocus={() => (held = true)}
      onblur={() => (held = false)}
    >
      {#key line}<span class="said">{line}</span>{/key}
    </button>
    <a class="btn btn-primary tip" href={kofi} target="_blank" rel="noreferrer">
      <Icon name="heart" size={14} /> Tip on Ko-fi <Icon name="external" size={12} />
    </a>
  {/if}
  <div class="choices">
    {#if form}
      <a class="choice" href={form} target="_blank" rel="noreferrer">
        <span class="say"><span class="what">Vote on what comes next</span><span class="why">Pick what gets built first</span></span>
        <Icon name="external" size={12} />
      </a>
      <a class="choice" href={form} target="_blank" rel="noreferrer">
        <span class="say"><span class="what">Suggest an idea</span><span class="why">A few words are enough</span></span>
        <Icon name="external" size={12} />
      </a>
    {/if}
    {#if discord}
      <a class="choice" href={discord} target="_blank" rel="noreferrer">
        <span class="say"><span class="what">Join the Discord</span><span class="why">Questions, ideas and news</span></span>
        <Icon name="external" size={12} />
      </a>
    {/if}
    <button type="button" class="choice" onclick={report}>
      <span class="say"><span class="what">Report a problem</span><span class="why">A ready report you send yourself</span></span>
      <Icon name="arrowRight" size={13} />
    </button>
  </div>
  {#if site}
    <p class="made">
      Made by one analyst · <a href={site} target="_blank" rel="noreferrer">{siteName}</a>
    </p>
  {/if}
</Modal>

<style>
  .words {
    display: block;
    width: 100%;
    min-height: calc(3 * 1.45em);
    margin: 0 0 12px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-sm);
    line-height: 1.45;
    text-align: left;
    cursor: pointer;
  }
  .words:hover {
    color: var(--text-1);
  }
  .said {
    display: block;
    animation: said 0.25s ease-out;
  }
  @keyframes said {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .said {
      animation: none;
    }
  }
  .tip {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    width: 100%;
    text-decoration: none;
  }
  .say {
    display: grid;
    gap: 1px;
  }
  .why {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .made {
    margin: 12px 0 0;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    color: var(--text-3);
    font-size: var(--fs-xs);
    text-align: center;
  }
  .made a {
    color: var(--text-2);
  }
  .made a:hover {
    color: var(--accent);
  }
  .choices {
    display: grid;
    gap: 2px;
  }
  .tip + .choices {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  .choice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    padding: 7px 8px;
    border-radius: var(--r-sm);
    color: var(--text-1);
    font-size: var(--fs-sm);
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }
  .choice:hover {
    background: var(--bg-2);
    color: var(--accent);
  }
</style>
