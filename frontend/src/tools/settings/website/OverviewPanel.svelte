<script>
  /**
   * The Overview: the four steps from a note to a reader and the checklist of what is set and what is
   * left, each step saying its state and opening the panel where it is done, with a card beside it once
   * the site passes four fifths of what GitHub Pages serves. What only a read of the site can tell says so
   * until it is read. What a press does is said beside the press, in its own panel, not here.
   */
  import Icon from '../../../components/Icon.svelte';
  import HubCard from './HubCard.svelte';
  import HubPanel from './HubPanel.svelte';
  import { siteRead } from '../../../lib/siteRead.svelte.js';
  import { formatBytes, hostOf, percentOf, shareOf } from '../../../lib/websiteHub.js';
  import {
    CHECKLIST_TITLE, FLOW_AFTER, FLOW_REFRESHES, HUB_LEADS, HUB_TABS, LIMITS_AMBER, OPTIONAL, SIZE_TIP_GO, SIZE_TIP_TITLE,
    WEBSITE_HELP as HELP, checklist, flowSteps, progressSaid, sizeTipSaid,
  } from '../../../lib/websiteSetup.js';

  let {
    active = false,
    prefs,
    github = null,
    ready = false,
    address = '',
    /** The counter that really counts, or ''. */
    counting = '',
    /** Where the site's logo comes from: `site`, `publishing` or ''. */
    logoFrom = '',
    /** What the site shows as while it has no title. */
    fallbackName = '',
    ongo = () => {},
  } = $props();

  const [title, sub] = HUB_LEADS.overview;
  const read = $derived(siteRead.data);
  const repository = $derived(ready ? `${github.account}/${github.repo}` : '');
  const flow = $derived(flowSteps({ repository, host: hostOf(address) }));
  const steps = $derived(checklist({
    ready, repository, branch: github?.branch ?? '', title: prefs.siteTitle.trim(), fallback: fallbackName, siteLogo: prefs.siteLogoSet,
    logoFrom, counting, stats: prefs.siteStats, read,
  }));
  const done = $derived(steps.filter((step) => step.state === 'done').length);
  const labelOf = (id) => HUB_TABS.find((tab) => tab.id === id)?.label ?? id;
  // a site past four fifths of what GitHub Pages serves gets a tip of its own
  const big = $derived.by(() => {
    const share = shareOf(read?.size.site ?? null);
    return share >= LIMITS_AMBER ? sizeTipSaid(formatBytes(read.size.site), percentOf(share)) : '';
  });
</script>

<HubPanel id="overview" {active} {title} {sub}>
  <ol class="flow" aria-label="From a note to a reader">
    {#each flow as [name, said], index (name)}
      <li class="step"><span class="k" aria-hidden="true">{index + 1}</span><h3>{name}</h3><p>{said}</p></li>
    {/each}
  </ol>
  <p class="after">{FLOW_AFTER}
    {#each FLOW_REFRESHES as what (what)}<span class="hub-pill">{what}</span>{/each}</p>

  <div class="hub-gap" class:hub-grid={big}>
    <HubCard title={CHECKLIST_TITLE} label={CHECKLIST_TITLE}>
      <p>{progressSaid(steps)}</p>
      <div class="progress" role="progressbar" aria-label="Steps done" aria-valuemin="0" aria-valuemax={steps.length} aria-valuenow={done}>
        <i style:width="{(done / steps.length) * 100}%"></i>
      </div>
      <ul class="check">
        {#each steps as step (step.id)}
          <li data-state={step.state}>
            <span class="tick {step.state}" aria-hidden="true">
              {#if step.state === 'done'}<Icon name="check" size={11} />{:else if step.state === 'unknown'}?{/if}
            </span>
            <span class="what">
              <span class="step-name">{step.label}{#if step.optional}<span class="optional">{` · ${OPTIONAL}`}</span>{/if}</span>
              <small>{step.said}</small>
            </span>
            <button type="button" class="hub-go" onclick={() => ongo(step.go)} title={HELP.hubGo}>{labelOf(step.go)}<Icon name="chevronRight" size={12} /></button>
          </li>
        {/each}
      </ul>
    </HubCard>

    {#if big}
      <HubCard title={SIZE_TIP_TITLE} label={SIZE_TIP_TITLE} tip>
        <p>{big}</p>
        <p><button type="button" class="hub-go" onclick={() => ongo('hosting')} title={HELP.hubGo}>{SIZE_TIP_GO}<Icon name="chevronRight" size={12} /></button></p>
      </HubCard>
    {/if}
  </div>
</HubPanel>

<style>
  .flow { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); overflow: hidden;
    border: 1px solid var(--border); border-radius: 10px; background: var(--bg-1); }
  .step { position: relative; min-width: 0; padding: 16px 16px 18px; }
  .step + .step { border-left: 1px solid var(--border); }
  /* the arrow from one step to the next, cut out of the line between them */
  .step + .step::before { content: ''; position: absolute; left: -7px; top: 30px; width: 12px; height: 12px; background: var(--bg-1);
    border-top: 1px solid var(--border-strong); border-right: 1px solid var(--border-strong); transform: rotate(45deg); }
  .k { display: grid; place-items: center; width: 26px; height: 26px; margin-bottom: 10px; border-radius: 50%; background: var(--accent-soft);
    color: var(--accent); font-size: var(--fs-sm); font-weight: 700; }
  .step h3 { margin: 0 0 4px; color: var(--text-1); font-size: var(--fs-md); font-weight: 600; letter-spacing: 0; text-transform: none; }
  .step p { margin: 0; color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; }
  .after { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 10px 2px 0; color: var(--text-2); font-size: var(--fs-sm); }
  .after .hub-pill:first-of-type { margin-left: 2px; }

  .progress { height: 4px; margin-top: 8px; overflow: hidden; border-radius: 2px; background: var(--bg-3); }
  .progress i { display: block; height: 100%; border-radius: 2px; background: var(--accent); transition: width 0.3s var(--ease); }
  .check { list-style: none; margin: 10px 0 0; padding: 0; }
  .check li { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 9px 0; border-top: 1px solid var(--border); }
  .check li:first-child { border-top: 0; }
  .tick { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; font-size: 10px; font-weight: 700; }
  .tick.done { background: var(--ok); color: var(--bg-1); }
  .tick.todo { border: 1.5px dashed var(--accent); }
  .tick.unknown { border: 1.5px dotted var(--text-3); color: var(--text-3); }
  .what { display: flex; flex-direction: column; min-width: 0; }
  .step-name { color: var(--text-1); font-size: var(--fs-sm); }
  .optional { color: var(--text-3); }
  .what small { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.45; overflow-wrap: anywhere; }
  li[data-state='done'] .step-name { color: var(--text-2); }

  @container hub (max-width: 640px) {
    .flow { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .step:nth-child(3) { border-left: 0; }
    .step:nth-child(n + 3) { border-top: 1px solid var(--border); }
    .step:nth-child(3)::before { display: none; }
  }
  @container hub (max-width: 380px) {
    .flow { grid-template-columns: minmax(0, 1fr); }
    .step + .step { border-left: 0; border-top: 1px solid var(--border); }
    .step + .step::before { display: none; }
  }
</style>
