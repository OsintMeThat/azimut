<script>
  // The same instant seen from above: north up, azimuth around, altitude as the
  // distance from the rim to the centre, so the centre is the zenith. It reads
  // like the map does, which is the point — these two rays are what the Satellite
  // tab draws from the marker.
  //
  // The moon is drawn at its real phase, rotated to its real bright-limb angle,
  // because that pair is what an analyst compares against a photograph.
  import { litPath, glyphRotation } from '../../lib/moonphase.js';

  const SIZE = 168;
  const C = SIZE / 2;
  const R = 64;

  let { sun = null, moon = null } = $props();

  // Zenith at the centre; a body below the horizon has no place inside the disc,
  // so its ray is dashed to the rim and carries no marker.
  const radius = (altitude) => ((90 - Math.max(0, altitude)) / 90) * R;
  const point = (azimuth, altitude) => {
    const a = ((azimuth - 90) * Math.PI) / 180;
    const r = radius(altitude);
    return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
  };
  const rim = (azimuth) => point(azimuth, 0);

  const MOON_RADIUS = 7;
</script>

<svg viewBox="0 0 {SIZE} {SIZE}" role="img" aria-label="Compass with the sun and moon directions">
  <circle cx={C} cy={C} r={R} fill="none" stroke="var(--border-strong)" />
  <circle cx={C} cy={C} r={R / 2} fill="none" stroke="var(--border)" />
  {#each [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330] as bearing (bearing)}
    {@const outer = rim(bearing)}
    <line
      x1={C + (outer.x - C) * 0.94}
      y1={C + (outer.y - C) * 0.94}
      x2={outer.x}
      y2={outer.y}
      stroke="var(--border)"
    />
  {/each}
  {#each [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as [label, bearing] (label)}
    {@const at = rim(bearing)}
    <text
      class="cardinal"
      x={C + (at.x - C) * 1.16}
      y={C + (at.y - C) * 1.16 + 3.5}
      text-anchor="middle">{label}</text
    >
  {/each}

  {#if sun}
    {@const tip = point(sun.azimuth, sun.altitude)}
    <line
      x1={C}
      y1={C}
      x2={tip.x}
      y2={tip.y}
      stroke="var(--sky-sun)"
      stroke-width="2"
      stroke-dasharray={sun.altitude < 0 ? '3 3' : null}
      opacity={sun.altitude < 0 ? 0.55 : 1}
    />
    {#if sun.altitude >= 0}
      <circle cx={tip.x} cy={tip.y} r="6" fill="var(--sky-sun)" stroke="var(--bg-1)" stroke-width="2" />
    {/if}
  {/if}

  {#if moon}
    {@const tip = point(moon.azimuth, moon.altitude)}
    <line
      x1={C}
      y1={C}
      x2={tip.x}
      y2={tip.y}
      stroke="var(--sky-moon)"
      stroke-width="2"
      stroke-dasharray={moon.altitude < 0 ? '3 3' : null}
      opacity={moon.altitude < 0 ? 0.55 : 1}
    />
    {#if moon.altitude >= 0}
      <!-- the real bright-limb angle, not the table convention: this is a view of
           the sky, so the lit side has to point where it actually points -->
      <circle cx={tip.x} cy={tip.y} r={MOON_RADIUS + 1} fill="var(--bg-1)" />
      <g
        transform="translate({tip.x} {tip.y}) rotate({glyphRotation(
          moon.waxing,
          moon.limb_from_vertical,
        )})"
      >
        <circle r={MOON_RADIUS} fill="var(--sky-moon)" opacity="0.18" />
        <path d={litPath(MOON_RADIUS, moon.illuminated, moon.phase_angle)} fill="var(--sky-moon)" />
      </g>
      <circle
        cx={tip.x}
        cy={tip.y}
        r={MOON_RADIUS}
        fill="none"
        stroke="var(--sky-moon)"
        stroke-opacity="0.5"
      />
    {/if}
  {/if}
</svg>

<style>
  svg {
    display: block;
    width: 168px;
    height: 168px;
    flex-shrink: 0;
  }
  .cardinal {
    fill: var(--text-3);
    font-size: 10px;
  }
</style>
