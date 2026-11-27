<script module>
  /** A step's icon: its own, else its tool's. */
  const TOOL_ICONS = {
    media: 'download',
    files: 'folder',
    reverse: 'zoneSearch',
    inspect: 'inspect',
    collage: 'grid',
    satellite: 'satellite',
    compare: 'compare',
    detect: 'changes',
    horizon: 'horizon',
    coordinates: 'sun',
    proof: 'proof',
    post: 'post',
    plate: 'plate',
    notebook: 'note',
  };
  export const stepIcon = (step) => (step.ask ? 'help' : (step.icon ?? TOOL_ICONS[step.tool] ?? 'flag'));

  /** The rows of a trail, in px from its top: on the way, above it and below it. */
  const ROWS = { flat: { 0: 46 }, forked: { [-1]: 36, 0: 82, 1: 134 } };
  /** Room kept at either end, so the first and last names stay whole. */
  const EDGE = 64;

  /**
   * The line between two waypoints: straight along the way, an easy bend onto a detour
   * and back.
   */
  export function trailPath(a, b) {
    if (a.y === b.y) return `M${a.x},${a.y} L${b.x},${b.y}`;
    const middle = (a.x + b.x) / 2;
    return `M${a.x},${a.y} C${middle},${a.y} ${middle},${b.y} ${b.x},${b.y}`;
  }
</script>

<script>
  /**
   * A journey drawn as a trail (`lib/guide.js`): a waypoint per step with its tool's icon,
   * the detours that may be skipped dotted off the way, a question as a signpost, and the
   * result flagged at the end. A journey that stays in one tool numbers its waypoints.
   *
   * The trail is drawn in amber behind the reader as far as they went (`walked`), the
   * step being read filled in. On the practice case, `here` is where the case stands
   * (`lib/journeyHere.js`): what it did is ticked, a pin says You are here, and the way
   * on is marked. A press on a waypoint opens its step.
   */
  import Icon from './Icon.svelte';
  import { journeyEdges, journeyNodes } from '../lib/guide.js';

  let { journey, picked, here = null, walked = [], result = 'Result', onpick } = $props();
  /** The steps the reader went through before this one, drawn in amber behind them. */
  const been = $derived(new Set(walked));

  const nodes = $derived(journeyNodes(journey));
  const forked = $derived(nodes.some((node) => node.at[1] !== 0));
  const rows = $derived(forked ? ROWS.forked : ROWS.flat);
  const height = $derived(forked ? 170 : 92);
  const columns = $derived(Math.max(...nodes.map((node) => node.at[0])) + (journey.result ? 1 : 0));
  const oneTool = $derived(new Set(nodes.map((node) => node.tool)).size === 1);
  const starts = $derived(nodes.filter((node) => node.at[0] === 0).length);

  let width = $state(0);
  const stride = $derived(columns ? (width - EDGE * 2) / columns : 0);
  const spot = (at) => ({ x: EDGE + at[0] * stride, y: rows[at[1]] });
  // a name never runs into the next waypoint's on a long journey
  const nameRoom = $derived(Math.max(56, Math.min(104, stride - 6)));

  // a one-tool journey numbers the steps of its way; a question or a detour has none
  const numbered = $derived(nodes.filter((node) => !node.ask && node.at[1] === 0).map((node) => node.id));
  const points = $derived([
    ...nodes.map((node) => ({ ...node, number: numbered.indexOf(node.id) + 1, ...spot(node.at) })),
    ...(journey.result ? [{ id: 'result', result: true, label: result, at: [columns, 0], ...spot([columns, 0]) }] : []),
  ]);
  const byId = $derived(Object.fromEntries(points.map((point) => [point.id, point])));
  /**
   * Every step with no way on ends on the result, as each branch of a last fork does. A
   * branch that ends while the way goes on past it ends on a flag of its own instead: a
   * line from it to the result would cross the steps after it.
   */
  const ending = $derived.by(() => {
    const edges = journeyEdges(journey);
    const last = Math.max(...nodes.map((node) => node.at[0]));
    const ends = journey.result ? nodes.filter((node) => !edges.some((edge) => edge.from === node.id)) : [];
    return {
      edges,
      far: ends.filter((node) => node.at[0] === last),
      early: ends.filter((node) => node.at[0] < last).map((node) => ({ node, ...spot([node.at[0] + 0.45, node.at[1]]) })),
    };
  });
  const ways = $derived(
    [...ending.edges, ...ending.far.map((node) => ({ from: node.id, to: 'result' }))]
      .map((edge) => ({ ...edge, a: byId[edge.from], b: byId[edge.to] }))
      .filter((edge) => edge.a && edge.b)
  );

  const done = (id) => Boolean(here?.done.includes(id));
  function wayState(way) {
    if (here?.here === way.from && here.next.includes(way.to)) return 'ahead';
    if (done(way.from) && (done(way.to) || here?.here === way.to)) return 'done';
    if (been.has(way.from) && (been.has(way.to) || picked === way.to)) return 'done';
    // a detour, or one of several starts the reader may not take, is a side path
    return way.a.optional || way.b.optional || (starts > 1 && way.a.at[0] === 0) ? 'side' : 'way';
  }
  function pointState(point) {
    if (here?.here === point.id) return 'here';
    if (done(point.id)) return 'done';
    if (been.has(point.id)) return 'walked';
    return here?.next.includes(point.id) ? 'next' : '';
  }
  const pin = $derived(here?.here ? byId[here.here] : null);
</script>

<div class="trail" style:height="{height}px" bind:clientWidth={width}>
  {#if width}
    <svg {width} {height} viewBox="0 0 {width} {height}" aria-hidden="true">
      {#each ways as way (`${way.from}>${way.to}`)}
        <path class="way {wayState(way)}" d={trailPath(way.a, way.b)} />
      {/each}
      {#each ending.early as end (end.node.id)}
        <path class="way {been.has(end.node.id) ? 'done' : 'way'}" d={trailPath(byId[end.node.id], end)} />
      {/each}
    </svg>
    {#each ending.early as end (end.node.id)}
      <span class="end-cap" class:reached={been.has(end.node.id) || picked === end.node.id} style:left="{end.x}px" style:top="{end.y}px" aria-hidden="true">
        <Icon name="flag" size={11} />
      </span>
    {/each}
    {#each points as point (point.id)}
      {@const state = pointState(point)}
      <button
        type="button"
        class="point {state}"
        class:ask={point.ask}
        class:optional={point.optional}
        class:result={point.result}
        class:viewed={picked === point.id}
        class:current={picked === point.id && !here}
        class:above={point.at[1] < 0}
        style:left="{point.x}px"
        style:top="{point.y}px"
        style:width="{nameRoom}px"
        aria-current={picked === point.id ? 'step' : undefined}
        title={point.optional ? `${point.label}, optional` : point.label}
        onclick={() => onpick(point.id)}
      >
        <span class="disc">
          {#if point.result}
            <Icon name="flag" size={15} />
          {:else if oneTool && point.number}
            <span class="number">{point.number}</span>
          {:else}
            <Icon name={stepIcon(point)} size={point.ask ? 13 : 15} />
          {/if}
          {#if state === 'done'}<span class="tick"><Icon name="check" size={9} /></span>{/if}
        </span>
        <span class="step-name">{point.label}</span>
      </button>
    {/each}
    {#if pin}
      <div class="pin" style:left="{pin.x}px" style:top="{pin.y}px" aria-hidden="true">
        <span class="tag">You are here</span>
        <svg class="drop" width="20" height="25" viewBox="0 0 24 30">
          <path d="M12 29s-10-9.2-10-17a10 10 0 1120 0c0 7.8-10 17-10 17z" />
          <circle cx="12" cy="12" r="3.6" />
        </svg>
      </div>
    {/if}
  {/if}
</div>

<style>
  .trail {
    position: relative;
    width: 100%;
    flex-shrink: 0;
  }
  svg {
    position: absolute;
    inset: 0;
    overflow: visible;
  }
  .way {
    fill: none;
    stroke-linecap: round;
  }
  .way.way {
    stroke: rgba(255, 255, 255, 0.2);
    stroke-width: 3;
  }
  .way.side {
    stroke: rgba(255, 255, 255, 0.16);
    stroke-width: 2.5;
    stroke-dasharray: 1 6;
  }
  .way.done {
    stroke: var(--accent);
    stroke-width: 3.5;
    filter: drop-shadow(0 0 4px color-mix(in srgb, var(--accent) 45%, transparent));
  }
  .way.ahead {
    stroke: var(--accent);
    stroke-width: 2.5;
    stroke-dasharray: 6 6;
    opacity: 0.85;
    animation: march 1s linear infinite;
  }
  @keyframes march {
    to {
      stroke-dashoffset: -12;
    }
  }
  /* where a branch that ends early ends, the way going on past it */
  .end-cap {
    position: absolute;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    translate: -50% -50%;
    border-radius: 50%;
    background: var(--bg-2);
    border: 1.5px solid rgba(255, 255, 255, 0.25);
    color: var(--text-3);
    pointer-events: none;
  }
  .end-cap.reached {
    border-color: var(--accent);
    color: var(--accent);
  }
  .point {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    width: 104px;
    transform: translate(-50%, -16px);
    color: var(--text-3);
    font-size: 11.5px;
    font-weight: 500;
    line-height: 1.2;
  }
  .point.above {
    flex-direction: column-reverse;
    transform: translate(-50%, calc(-100% + 16px));
  }
  .disc {
    position: relative;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--bg-2);
    border: 1.5px solid rgba(255, 255, 255, 0.25);
    color: var(--text-2);
    transition:
      background var(--motion-hover) var(--ease),
      border-color var(--motion-hover) var(--ease),
      transform var(--motion-hover) var(--ease);
  }
  .point:hover .disc {
    background: var(--bg-3);
    border-color: rgba(255, 255, 255, 0.5);
    transform: scale(1.06);
  }
  .point.ask .disc {
    width: 24px;
    height: 24px;
    margin: 4px 0;
    border-radius: 6px;
    rotate: 45deg;
    background: var(--bg-1);
  }
  .point.ask .disc > :global(svg) {
    rotate: -45deg;
  }
  .point.optional .disc {
    border-style: dashed;
  }
  .number {
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .step-name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tick {
    position: absolute;
    top: -3px;
    right: -3px;
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-text);
  }
  .point.ask .tick {
    rotate: -45deg;
  }
  .point.done .disc {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
  }
  .point.done {
    color: var(--text-2);
  }
  .point.walked .disc {
    border-color: var(--accent);
    color: var(--accent);
  }
  .point.walked {
    color: var(--text-2);
  }
  .point.viewed.current .disc {
    background: var(--accent);
    border: 2px solid var(--accent-hover);
    color: var(--accent-text);
    box-shadow: 0 0 0 4px var(--accent-soft);
  }
  .point.viewed.current {
    color: var(--accent);
    font-weight: 700;
  }
  .point.next .disc {
    border-color: var(--accent);
  }
  .point.viewed .disc {
    border: 2.5px solid var(--text-1);
    background: var(--bg-3);
    color: var(--text-1);
  }
  .point.viewed {
    color: var(--text-1);
    font-weight: 650;
  }
  .point.here .disc {
    background: var(--accent);
    border-color: var(--accent-hover);
    color: var(--accent-text);
  }
  .point.here {
    color: var(--accent);
    font-weight: 700;
  }
  /* the pin points down at the waypoint, its words above it */
  .pin {
    position: absolute;
    width: 0;
    height: 0;
    pointer-events: none;
    animation: bob 1.6s ease-in-out infinite;
  }
  .drop {
    position: absolute;
    left: -10px;
    top: -42px;
  }
  .pin path {
    fill: var(--accent);
    filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.5));
  }
  .pin circle {
    fill: var(--accent-text);
  }
  .tag {
    position: absolute;
    left: 0;
    top: -61px;
    translate: -50% 0;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  @keyframes bob {
    50% {
      translate: 0 -3px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .way.ahead,
    .pin {
      animation: none;
    }
  }
</style>
