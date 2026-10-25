/**
 * A locator drawn as a small globe: the world seen from above the main map's middle,
 * the country it stands in picked out in the accent, a dot where the map looks. The
 * classic locator of a published map, drawn on the page itself from Natural Earth's
 * countries at 1:110 million and its disputed areas at 1:50 million (`world.json`,
 * public domain, bundled), so it needs no live map, no tile and no network, and is not
 * one of the plate's eight maps.
 *
 * Natural Earth draws a country as it is held, so an area held by one country and
 * claimed by another (Crimea, the Donbas, Abkhazia…) sits inside the one holding it.
 * The globe draws those areas apart, dotted round, so none takes the colour of the
 * country holding it, and a map looking at one picks out the area itself, not a country.
 *
 * Pure but for the drawing, so the projection and the country under a point are read
 * off a test.
 */

const RAD = Math.PI / 180;

/**
 * The orthographic projection centred on `lat0`, `lon0`, on a disc of radius 1:
 * `(lon, lat)` → `[x, y, seen]`, `seen` false for a point behind the globe, which is
 * then put on the rim, where the disc's edge hides the cut.
 */
export function orthographic(lat0, lon0) {
  const [sin0, cos0] = [Math.sin(lat0 * RAD), Math.cos(lat0 * RAD)];
  return (lon, lat) => {
    const [phi, lambda] = [lat * RAD, (lon - lon0) * RAD];
    const cosc = sin0 * Math.sin(phi) + cos0 * Math.cos(phi) * Math.cos(lambda);
    const x = Math.cos(phi) * Math.sin(lambda);
    const y = cos0 * Math.sin(phi) - sin0 * Math.cos(phi) * Math.cos(lambda);
    if (cosc >= 0) return [x, -y, true];
    const length = Math.hypot(x, y) || 1;
    return [x / length, -y / length, false];
  };
}

const decoded = new WeakMap();
/** The rings of a country, `scale` times as large in its numbers as in degrees, as `[[lon, lat], …]`: read once a country. */
export function ringsOf(country, scale) {
  const known = decoded.get(country);
  if (known) return known;
  const rings = country.r.map((flat) => {
    const ring = [];
    for (let index = 0; index < flat.length; index += 2) ring.push([flat[index] / scale, flat[index + 1] / scale]);
    return ring;
  });
  decoded.set(country, rings);
  return rings;
}

function inside([x, y], ring) {
  let hit = false;
  for (let index = 0, last = ring.length - 1; index < ring.length; last = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[last];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const holds = (area, world, lon, lat) => ringsOf(area, world.scale).some((ring) => inside([lon, lat], ring));

/** The area of `world` the point stands in: a disputed area first, else a country, else null at sea. */
export function areaAt(world, lon, lat) {
  if (!world) return null;
  return (world.disputed ?? []).find((area) => holds(area, world, lon, lat))
    ?? world.countries.find((country) => holds(country, world, lon, lat)) ?? null;
}

/**
 * The globe in `box` (canvas pixels): the sea, the land, the country holding
 * `centre` picked out, the borders faint, a ring and a dot at the centre, a rim.
 * `colours` are the sea, the land, the borders, the accent and the ink.
 */
export function drawGlobe(ctx, box, { centre, world = null, colours, line = 1 }) {
  const radius = Math.min(box.w, box.h) / 2 - line;
  const [cx, cy] = [box.x + box.w / 2, box.y + box.h / 2];
  const lat0 = Math.max(-80, Math.min(80, centre.lat));
  const project = orthographic(lat0, centre.lon);
  const at = (lon, lat) => {
    const [x, y] = project(lon, lat);
    return [cx + x * radius, cy + y * radius];
  };
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = colours.sea; ctx.fill();
  ctx.clip();
  if (world) {
    const home = areaAt(world, centre.lon, centre.lat);
    /** Trace an area's rings; whether any of it faces the eye. */
    const trace = (area) => {
      ctx.beginPath();
      let seen = false;
      for (const ring of ringsOf(area, world.scale)) {
        let first = true;
        for (const [lon, lat] of ring) {
          const [x, y] = at(lon, lat);
          seen = seen || project(lon, lat)[2];
          if (first) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          first = false;
        }
        ctx.closePath();
      }
      return seen;
    };
    ctx.strokeStyle = colours.border; ctx.lineWidth = Math.max(0.5, line * 0.4);
    for (const country of world.countries) {
      if (!trace(country)) continue;
      ctx.fillStyle = country === home ? colours.accent : colours.land;
      ctx.fill();
      ctx.globalAlpha = 0.6; ctx.stroke(); ctx.globalAlpha = 1;
    }
    // the disputed areas over the countries holding them, in the land's colour, dotted round
    ctx.setLineDash([Math.max(1, line), Math.max(1, line)]);
    for (const area of world.disputed ?? []) {
      if (!trace(area)) continue;
      ctx.fillStyle = area === home ? colours.accent : colours.land;
      ctx.fill();
      ctx.globalAlpha = 0.8; ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.setLineDash([]);
  }
  // a soft shading toward the rim, so the disc reads as a globe
  const shade = ctx.createRadialGradient(cx - radius * 0.35, cy - radius * 0.35, radius * 0.1, cx, cy, radius);
  shade.addColorStop(0, 'rgba(255,255,255,0.12)');
  shade.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = shade; ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = colours.ink; ctx.lineWidth = line; ctx.stroke();
  // where the map looks: a ring and a dot in the accent, each on a white halo, read even
  // when the area picked out is too small to see at this scale
  const [dx, dy] = at(centre.lon, centre.lat);
  const ring = Math.max(4, radius * 0.17);
  const dot = Math.max(1.6, radius * 0.045);
  ctx.lineWidth = Math.max(1.5, line * 1.6);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath(); ctx.arc(dx, dy, ring, 0, Math.PI * 2); ctx.lineWidth += 2; ctx.stroke();
  ctx.lineWidth -= 2;
  ctx.strokeStyle = colours.accent;
  ctx.beginPath(); ctx.arc(dx, dy, ring, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(dx, dy, dot + Math.max(1, line), 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.beginPath(); ctx.arc(dx, dy, dot, 0, Math.PI * 2);
  ctx.fillStyle = colours.accent; ctx.fill();
  ctx.restore();
}
