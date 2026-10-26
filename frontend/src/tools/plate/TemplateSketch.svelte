<script>
  /**
   * A template drawn small as the page it lays out: the paper, each map on its own
   * ground, the titles as lines of ink in their colours, the badges and figures in
   * the accent, the keys and lists as rows, the pictures as empty frames. The list of
   * plates and the new plate's gallery show the ready plates and the analyst's own
   * templates this way.
   */
  import { pageSize } from '../../lib/plate/page.js';
  import { mutedOf } from '../../lib/plate/design.js';
  import { AMBER } from '../../lib/brandMark.js';
  import GroundSwatch from './GroundSwatch.svelte';

  let { data, width = 160 } = $props();

  const size = $derived(pageSize(data?.page));
  const theme = $derived({ paper: '#ffffff', ink: '#15181e', accent: '#c8102e', ...(data?.theme ?? {}) });
  const muted = $derived(mutedOf(theme));
  const elements = $derived(data?.elements ?? []);
  /** A text's lines of ink: how many fit its box, the last one shorter. */
  const lines = (element) => {
    const [, , w, h] = element.box;
    const step = Math.max(2.2, (element.size ?? 10) * 0.42);
    const count = Math.max(1, Math.min(4, Math.floor(h / step)));
    return Array.from({ length: count }, (_, index) => ({ y: index * step, w: index === count - 1 && count > 1 ? w * 0.6 : w * 0.92 }));
  };
  /** The Azimut logo alone, as wide as its box lets it: where it starts and how high it stands. */
  const logo = (element) => {
    const [x, , w, h] = element.box;
    const high = Math.min(h, w / 2.81);
    const left = element.align === 'left' ? x : element.align === 'center' ? x + (w - high * 2.81) / 2 : x + w - high * 2.81;
    return { left, high };
  };
  const inkOf = (element) => element.colour || (element.role === 'kicker' || element.role === 'figure' ? theme.accent
    : ['dek', 'caption', 'source'].includes(element.role) ? muted : theme.ink);
</script>

<svg class="sketch" viewBox="0 0 {size.width} {size.height}" {width} height={(width * size.height) / size.width} aria-hidden="true">
  <rect width={size.width} height={size.height} fill={theme.paper} />
  {#each elements as element (element.id)}
    {@const [x, y, w, h] = element.box}
    {#if element.kind === 'inset' && element.globe}
      <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 2} fill="#9fbcd0" stroke={theme.ink} stroke-width="0.5" />
      <path d="M{x + w * 0.3} {y + h * 0.35} q{w * 0.15} {-h * 0.12} {w * 0.3} 0 q{w * 0.05} {h * 0.2} {-w * 0.12} {h * 0.3} q{-w * 0.2} {h * 0.05} {-w * 0.18} {-h * 0.3} Z" fill="#eeeae0" />
      <circle cx={x + w / 2} cy={y + h * 0.45} r={Math.min(w, h) * 0.06} fill={theme.accent} />
    {:else if element.kind === 'map' || element.kind === 'inset'}
      <GroundSwatch id={element.basemap ?? 'plain'} {x} {y} width={w} height={h} />
      {#if element.border !== false}<rect {x} {y} width={w} height={h} fill="none" stroke={theme.ink} stroke-width="0.5" opacity="0.6" />{/if}
    {:else if element.kind === 'text'}
      {@const thick = Math.max(1, (element.size ?? 10) * (element.weight === 700 ? 0.3 : 0.2))}
      {#if element.fill}<rect {x} {y} width={w} height={h} fill={element.fill} rx="0.6" />{/if}
      {#each lines(element) as line, index (index)}
        <rect x={element.align === 'center' ? x + (w - line.w * (element.fill ? 0.7 : 1)) / 2 : x + (element.fill ? 2 : 0)}
          y={y + line.y + (element.fill ? (h - thick) / 2 - line.y : 0)} width={line.w * (element.fill ? 0.7 : 1)} height={thick} rx={thick / 2} fill={inkOf(element)} />
      {/each}
    {:else if element.kind === 'image'}
      <rect {x} {y} width={w} height={h} fill={muted} opacity="0.18" />
      <path d="M{x + w * 0.2} {y + h * 0.75} L{x + w * 0.42} {y + h * 0.45} L{x + w * 0.56} {y + h * 0.62} L{x + w * 0.68} {y + h * 0.5} L{x + w * 0.82} {y + h * 0.75} Z" fill={muted} opacity="0.5" />
      <rect {x} {y} width={w} height={h} fill="none" stroke={theme.ink} stroke-width="0.5" opacity="0.5" />
    {:else if element.kind === 'legend' || element.kind === 'key' || element.kind === 'table'}
      {#if element.fill && element.fill !== theme.paper}<rect {x} {y} width={w} height={h} fill={element.fill} />{/if}
      <rect x={x + 1} y={y + 1} width={Math.min(w * 0.5, 30)} height="1.6" rx="0.8" fill={theme.ink} />
      {#each Array.from({ length: Math.max(1, Math.min(6, Math.floor((h - 5) / 5))) }) as _, index (index)}
        {#if element.kind === 'legend'}<rect x={x + 1} y={y + 5 + index * 5} width="3.2" height="3.2" fill={index % 2 ? muted : theme.accent} />{/if}
        <rect x={x + (element.kind === 'legend' ? 6 : 1)} y={y + 5.8 + index * 5} width={Math.min(w - 8, 26 - (index % 3) * 5)} height="1.4" rx="0.7" fill={muted} />
      {/each}
    {:else if element.kind === 'shape' && element.shape !== 'line'}
      <rect {x} {y} width={w} height={h} fill={element.fill ?? 'none'} opacity={element.opacity ?? 1} stroke={element.border === false ? 'none' : theme.ink} stroke-width="0.4" />
    {:else if element.kind === 'shape'}
      <rect {x} y={y + h / 2 - 0.3} width={w} height="0.6" fill={element.colour ?? theme.ink} />
    {:else if element.kind === 'scale'}
      <rect {x} y={y + h / 2} width={w * 0.8} height="1" fill={theme.ink} />
    {:else if element.kind === 'north'}
      <path d="M{x + w / 2} {y} L{x + w} {y + h} L{x + w / 2} {y + h * 0.75} L{x} {y + h} Z" fill={theme.ink} />
    {:else if element.kind === 'credits'}
      <rect x={x + w * 0.4} y={y + h / 2 - 0.4} width={w * 0.6} height="0.8" fill={muted} opacity="0.7" />
    {:else if element.kind === 'qr'}
      <rect {x} {y} width={w} height={h} fill="none" stroke={theme.ink} stroke-width="0.6" />
      <rect x={x + w * 0.2} y={y + h * 0.2} width={w * 0.25} height={h * 0.25} fill={theme.ink} />
      <rect x={x + w * 0.55} y={y + h * 0.55} width={w * 0.25} height={h * 0.25} fill={theme.ink} />
    {:else if element.kind === 'brand' && !element.text}
      {@const { left, high } = logo(element)}
      <path class="logo-mark" d="M{left} {y + h / 2 + high / 2} L{left + high * 0.26} {y + h / 2 - high / 2} L{left + high * 0.52} {y + h / 2 + high / 2} Z" fill={AMBER} />
      <rect x={left + high * 0.7} y={y + h / 2 - high * 0.2} width={high * 2.1} height={high * 0.4} rx={high * 0.2} fill={element.colour || muted} />
    {:else if element.kind === 'signature' || element.kind === 'brand'}
      <rect x={x + w * 0.4} y={y + h * 0.3} width={w * 0.6} height="1.4" rx="0.7" fill={muted} />
    {/if}
  {/each}
</svg>

<style>
  .sketch { display: block; max-width: 100%; height: auto; }
</style>
