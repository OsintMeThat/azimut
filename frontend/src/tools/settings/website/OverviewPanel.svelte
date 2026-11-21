<script>
  /**
   * The Overview: the four steps from a note to a reader, the checklist of what is set and what is
   * left, each item saying its state and opening the panel where it is done, and three tips. Items
   * that need the site read say so until it is.
   */
  import Icon from '../../../components/Icon.svelte';
  import HubCard from './HubCard.svelte';
  import HubPanel from './HubPanel.svelte';
  import {
    CHECKLIST_TITLE, FLOW_AFTER, FLOW_REFRESHES, HUB_LEADS, HUB_TABS, HUB_TIPS, SIZE_TIP_TITLE, WEBSITE_HELP as HELP, flowSteps,
    sizeTipSaid,
  } from '../../../lib/websiteSetup.js';

  let {
    active = false,
    /** The repository and the site's host, once known, for the flow to name. */
    repository = '',
    host = '',
    /** The checklist and its count (`checklist`, `progressOf`). */
    steps = [],
    progress = { done: 0, total: 0, unknown: 0 },
    /** `{ weight, percent }` once the site passes four fifths of what Pages serves, else null. */
    big = null,
    ongo = () => {},
  } = $props();

  const [title, sub] = HUB_LEADS.overview;
  const flow = $derived(flowSteps({ repository, host }));
  const labelOf = (id) => HUB_TABS.find((tab) => tab.id === id)?.label ?? id;
</script>

<HubPanel id="overview" {active} {title} {sub}>
  <ol class="flow">
    {#each flow as [name, said], index (name)}
      <li class="step"><span class="k">{index + 1}</span><h3>{name}</h3><p>{said}</p></li>
    {/each}
  </ol>
  <p class="after">{FLOW_AFTER}
    <span class="pills">{#each FLOW_REFRESHES as what (what)}<span class="pill">{what}</span>{/each}</span></p>

  <div class="grid">
    <HubCard title={CHECKLIST_TITLE} label={CHECKLIST_TITLE}>
      <p>{progress.done} of {progress.total} done.{progress.unread ? ` ${progress.unread} need${progress.unread === 1 ? 's' : ''} a read of the site.` : ''}</p>
      <div class="progress" role="progressbar" aria-label="Steps done" aria-valuemin="0" aria-valuemax={progress.total} aria-valuenow={progress.done}>
        <i style="width: {progress.total ? (progress.done / progress.total) * 100 : 0}%"></i>
      </div>
      <ul class="check">
        {#each steps as step (step.id)}
          <li data-state={step.state}>
            <span class="tick {step.state}" aria-hidden="true">{#if step.state === 'done'}<Icon name="check" size={11} />{:else if step.state === 'unknown'}?{/if}</span>
            <span class="what">{step.label}{step.optional ? ' · optional' : ''}
              <small>{step.said}</small></span>
            <button type="button" class="go" onclick={() => ongo(step.go)} title={HELP.hubGo}>{labelOf(step.go)} ›</button>
          </li>
        {/each}
      </ul>
    </HubCard>
    <div class="tips">
      {#if big}
        <HubCard title={SIZE_TIP_TITLE} know>
          <p>{sizeTipSaid(big.weight, big.percent)}</p>
          <p><button type="button" class="go" onclick={() => ongo('hosting')} title={HELP.hubGo}>Hosting ›</button></p>
        </HubCard>
      {/if}
      {#each HUB_TIPS as [tip, said] (tip)}
        <HubCard title={tip} know><p>{said}</p></HubCard>
      {/each}
    </div>
  </div>
</HubPanel>

<style>
  .flow { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--border);
    border-radius: 10px; background: var(--bg-1); overflow: hidden; }
  .step { position: relative; padding: 16px 16px 18px; }
  .step + .step { border-left: 1px solid var(--border); }
  .step + .step::before { content: ''; position: absolute; left: -7px; top: 30px; width: 12px; height: 12px; background: var(--bg-1);
    border-top: 1px solid var(--border-strong); border-right: 1px solid var(--border-strong); transform: rotate(45deg); }
  .k { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent);
    font-weight: 700; font-size: var(--fs-sm); margin-bottom: 10px; }
  .step h3 { display: block; margin: 0 0 4px; font-size: var(--fs-md); font-weight: 600; text-transform: none; letter-spacing: 0; color: var(--text-1); }
  .step p { margin: 0; color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; }
  .after { margin: 10px 2px 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; color: var(--text-2); font-size: var(--fs-sm); }
  .pills { display: flex; gap: 6px; flex-wrap: wrap; }
  .pill { display: inline-flex; padding: 1px 8px; border-radius: 99px; border: 1px solid var(--border-strong); color: var(--text-2); font-size: var(--fs-xs); white-space: nowrap; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 22px; align-items: start; }
  .tips { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .progress { height: 4px; border-radius: 2px; background: var(--bg-3); overflow: hidden; margin-top: 6px; }
  .progress i { display: block; height: 100%; background: var(--accent); }
  .check { list-style: none; margin: 10px 0 0; padding: 0; }
  .check li { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 9px 0; border-top: 1px solid var(--border); }
  .check li:first-child { border-top: 0; }
  .tick { width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; }
  .tick.done { background: var(--ok); color: #10200f; }
  .tick.todo { border: 1.5px dashed var(--accent); }
  .tick.unknown { border: 1.5px dotted var(--text-3); color: var(--text-3); }
  .what { font-size: var(--fs-sm); color: var(--text-1); min-width: 0; }
  .what small { display: block; color: var(--text-3); font-size: var(--fs-xs); overflow-wrap: anywhere; }
  .go { border: 0; background: none; padding: 0; font: inherit; font-size: var(--fs-xs); color: var(--text-2); cursor: pointer; white-space: nowrap; }
  .go:hover { color: var(--accent); }
  @media (max-width: 900px) {
    .flow { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .grid { grid-template-columns: 1fr; }
  }
</style>
