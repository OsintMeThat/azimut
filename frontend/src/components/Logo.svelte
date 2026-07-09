<script>
  export let size = 32;
  export let variant = 'default'; // 'default' | 'mono' | 'inverted'

  // Instrument bezel: 60 radial ticks, emphasised at the cardinals (N/E/S/W).
  const R_IN = 34,
    R_OUT = 38,
    R_CARD_IN = 31,
    R_CARD_OUT = 41;
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const cardinal = i % 15 === 0;
    const r1 = cardinal ? R_CARD_IN : R_IN;
    const r2 = cardinal ? R_CARD_OUT : R_OUT;
    return {
      x1: 50 + Math.cos(a) * r1,
      y1: 50 + Math.sin(a) * r1,
      x2: 50 + Math.cos(a) * r2,
      y2: 50 + Math.sin(a) * r2,
      cardinal,
    };
  });
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 100 100"
  aria-label="Ozimut logo"
  class={variant}
>
  <!-- Outer ring (world / scope) -->
  <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2.4" opacity="0.4" />
  <!-- Bezel ring (analysis / investigation) -->
  <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.5" />

  <!-- Graduation ticks -->
  {#each ticks as t}
    <line
      x1={t.x1}
      y1={t.y1}
      x2={t.x2}
      y2={t.y2}
      stroke="currentColor"
      stroke-width={t.cardinal ? 1.6 : 1}
      stroke-linecap="round"
      opacity={t.cardinal ? 0.85 : 0.5}
    />
  {/each}

  <!-- Compass rose (focus / truth) — slender north arm -->
  <path
    d="M50 7 L56 44 L84 50 L58 58 L50 84 L42 58 L16 50 L44 44 Z"
    fill="var(--text-1)"
  />
  <!-- North point (accent / azimuth) -->
  <path d="M50 7 L56 45 L50 48 L44 45 Z" fill="var(--accent)" />

  <!-- Center focus -->
  <circle cx="50" cy="50" r="8" fill="var(--accent)" />
  <circle cx="50" cy="50" r="4" fill="var(--bg-0)" />
</svg>

<style>
  svg {
    display: inline-block;
    color: var(--text-2);
  }
  svg.mono {
    color: currentColor;
  }
  svg.inverted {
    color: #fff;
    filter: drop-shadow(0 0 8px rgba(0, 0, 0, 0.3));
  }
</style>
