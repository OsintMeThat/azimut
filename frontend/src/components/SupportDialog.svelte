<script>
  /**
   * Support & feedback: a tip, a vote, an idea, a problem. Opened from the rail and from
   * nowhere else, it never comes to the analyst, and nothing here reaches the network
   * until a link is pressed. A block waits for its link (lib/support.js).
   */
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import { openIssueReport } from '../lib/navigate.js';
  import { FEEDBACK_FORM_URL, KOFI_URL } from '../lib/support.js';

  let { kofi = KOFI_URL, form = FEEDBACK_FORM_URL, onclose } = $props();

  function report() {
    openIssueReport();
    onclose();
  }
</script>

<Modal title="Support & feedback" {onclose} width="360px">
  {#if kofi}
    <p class="words">Azimut is free. If it helps your work, a tip helps keep it going.</p>
    <a class="btn btn-primary tip" href={kofi} target="_blank" rel="noreferrer">
      <Icon name="heart" size={14} /> Tip on Ko-fi <Icon name="external" size={12} />
    </a>
  {/if}
  <div class="choices">
    {#if form}
      <a class="choice" href={form} target="_blank" rel="noreferrer">
        Vote on what comes next <Icon name="external" size={12} />
      </a>
      <a class="choice" href={form} target="_blank" rel="noreferrer">
        Suggest an idea <Icon name="external" size={12} />
      </a>
    {/if}
    <button type="button" class="choice" onclick={report}>
      Report a problem <Icon name="arrowRight" size={13} />
    </button>
  </div>
</Modal>

<style>
  .words {
    margin: 0 0 12px;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .tip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    text-decoration: none;
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
