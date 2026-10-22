// Pure geodesic geometry for the Satellite measure tools (distance / area /
// angle). Points are { lat, lon } in degrees. Kept free of the map so it can be
// unit-tested; the component only handles drawing and interaction.

const R = 6378137; // Earth radius (m), WGS84 equatorial — matches Web Mercator
const rad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance between two points, in metres (haversine). */
export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * The point reached from `from` on a bearing (degrees from north) after
 * travelling `metres` along a great circle. Draws the sun and moon azimuth rays
 * on the map, and is the primitive a bearing measure needs.
 */
export function destination(from, bearing, metres) {
  const angular = metres / R;
  const lat1 = rad(from.lat);
  const lon1 = rad(from.lon);
  const theta = rad(bearing);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(theta)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: (lat2 * 180) / Math.PI, lon: (((lon2 * 180) / Math.PI + 540) % 360) - 180 };
}

/** Total length of a polyline through the points, in metres. */
export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1], points[i]);
  return total;
}

/** Area of the polygon (spherical excess approximation), in square metres. */
export function polygonArea(points) {
  const n = points.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    sum += rad(q.lon - p.lon) * (2 + Math.sin(rad(p.lat)) + Math.sin(rad(q.lat)));
  }
  return Math.abs((sum * R * R) / 2);
}

/**
 * Is `point` inside the ring through `points`?
 *
 * Ray casting in degrees, which is what the analyst sees: the shape is judged as it
 * is drawn on the map rather than on a sphere, and at the size of a traced footprint
 * the two answers are the same. A point on the edge counts either way.
 */
export function containsPoint(points, point) {
  if (!points || points.length < 3 || !point) return false;
  let inside = false;
  for (let i = 0; i < points.length; i++) {
    const { lat: y1, lon: x1 } = points[i];
    const { lat: y2, lon: x2 } = points[(i + 1) % points.length];
    if (y1 > point.lat !== y2 > point.lat) {
      const crossing = ((x2 - x1) * (point.lat - y1)) / (y2 - y1 || 1e-12) + x1;
      if (point.lon < crossing) inside = !inside;
    }
  }
  return inside;
}

/** The convex hull of flat `[x, y]` points, counter-clockwise (monotone chain). */
function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const chain = [];
    for (const point of list) {
      while (chain.length >= 2 && cross(chain.at(-2), chain.at(-1), point) <= 0) chain.pop();
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/**
 * The long and short sides of the smallest rectangle around the points, in
 * metres, turned to fit them rather than squared to north: a hull lying on the
 * diagonal is as long as it is, not as long as the box around it.
 *
 * Worked flat about the points' middle, which at the size of a ship or a
 * detection gives the answer the sphere does.
 */
export function orientedExtent(points) {
  if (!points?.length) return null;
  const lat0 = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const lon0 = points[0].lon;
  const k = Math.cos(rad(lat0));
  const flat = points.map((point) => [
    rad(((point.lon - lon0 + 540) % 360) - 180) * k * R,
    rad(point.lat - lat0) * R,
  ]);
  const hull = convexHull(flat);
  if (hull.length < 3) {
    const [a, b = a] = hull;
    return { length: Math.hypot(b[0] - a[0], b[1] - a[1]), width: 0 };
  }
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i];
    const [bx, by] = hull[(i + 1) % hull.length];
    const edge = Math.hypot(bx - ax, by - ay);
    if (!edge) continue;
    const ux = (bx - ax) / edge;
    const uy = (by - ay) / edge;
    let [minU, maxU, minV, maxV] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const [x, y] of hull) {
      const u = x * ux + y * uy;
      const v = y * ux - x * uy;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const sides = [maxU - minU, maxV - minV];
    if (!best || sides[0] * sides[1] < best[0] * best[1]) best = sides;
  }
  return { length: Math.max(...best), width: Math.min(...best) };
}

/** Interior angle at `vertex` between the rays to `a` and `b`, in degrees. */
export function angleAt(a, vertex, b) {
  const cosLat = Math.cos(rad(vertex.lat));
  const ax = rad(a.lon - vertex.lon) * cosLat;
  const ay = rad(a.lat - vertex.lat);
  const bx = rad(b.lon - vertex.lon) * cosLat;
  const by = rad(b.lat - vertex.lat);
  const magA = Math.hypot(ax, ay);
  const magB = Math.hypot(bx, by);
  if (!magA || !magB) return 0;
  const cos = Math.min(1, Math.max(-1, (ax * bx + ay * by) / (magA * magB)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Perimeter of the ring through the points, back to the first, in metres. */
export function perimeter(points) {
  return points.length < 3 ? pathLength(points) : pathLength([...points, points[0]]);
}

/** A point's place on the flat map, Web Mercator in metres: where the line is drawn. */
function mercator({ lat, lon }) {
  const clamped = Math.max(-85.05, Math.min(85.05, lat));
  return [rad(lon) * R, Math.log(Math.tan(Math.PI / 4 + rad(clamped) / 2)) * R];
}

function unmercator([x, y]) {
  return { lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI), lon: (x / R) * (180 / Math.PI) };
}

/**
 * Where two drawn segments cross, or null. Worked on the flat map, because a
 * segment is drawn straight there: the crossing is where the two lines on screen
 * meet, which is what an analyst triangulating two bearings reads off.
 */
export function crossing(a1, a2, b1, b2) {
  const [p, q, r, s] = [a1, a2, b1, b2].map(mercator);
  const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
  if (!d) return null;
  const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
  const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return unmercator([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
}

/** Halfway along a segment as it is drawn on the flat map: where its length is written. */
export function midway(a, b) {
  const [p, q] = [a, b].map(mercator);
  return unmercator([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
}

/** The middle of a ring as drawn on the flat map: where its area is written. */
export function centroid(points) {
  const flat = points.map(mercator);
  let twice = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < flat.length; i++) {
    const [x1, y1] = flat[i];
    const [x2, y2] = flat[(i + 1) % flat.length];
    const cross = x1 * y2 - x2 * y1;
    twice += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(twice) < 1e-9) {
    const n = flat.length || 1;
    return unmercator([flat.reduce((t, f) => t + f[0], 0) / n, flat.reduce((t, f) => t + f[1], 0) / n]);
  }
  return unmercator([cx / (3 * twice), cy / (3 * twice)]);
}

/** Steps along an arc, enough that a cone's edge reads as round at any width. */
const ARC_STEPS = 48;

/**
 * A view cone lying on the ground: from `apex`, `aperture` degrees wide about
 * `bearing`, out to `metres`. Closed back at the apex.
 */
export function cone(apex, bearing, aperture, metres) {
  const width = Math.max(0, Math.min(360, aperture));
  const steps = Math.max(2, Math.ceil((ARC_STEPS * width) / 360) + 1);
  const arc = [];
  for (let i = 0; i <= steps; i++) arc.push(destination(apex, bearing - width / 2 + (width * i) / steps, metres));
  return width >= 360 ? arc : [apex, ...arc];
}

// Measurements are computed and stored in metres; `units` only picks how they
// read (Settings → General, or the measure tool's own choice). International
// feet/miles/acres, and the nautical mile for work at sea.
const FT_PER_M = 3.28084;
const FT_PER_MI = 5280;
const SQFT_PER_ACRE = 43560;
const SQMI_PER_SQM = 3.861021585e-7;
const M_PER_NM = 1852;

export function formatDistance(m, units = 'metric') {
  if (units === 'nautical') {
    const nm = m / M_PER_NM;
    return `${nm.toFixed(nm < 100 ? 2 : 1)} NM`;
  }
  if (units === 'imperial') {
    const ft = m * FT_PER_M;
    if (ft < FT_PER_MI) return `${ft < 10 ? ft.toFixed(1) : Math.round(ft)} ft`;
    const mi = ft / FT_PER_MI;
    return `${mi.toFixed(mi < 10 ? 2 : 1)} mi`;
  }
  if (m < 1000) return `${m < 10 ? m.toFixed(1) : Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

/** A height above the sea: whole metres or feet, never kilometres. At sea, metres. */
export function formatHeight(m, units = 'metric') {
  if (!Number.isFinite(m)) return '';
  return units === 'imperial' ? `${Math.round(m * FT_PER_M)} ft` : `${Math.round(m)} m`;
}

export function formatArea(m2, units = 'metric') {
  if (units === 'nautical' && m2 >= M_PER_NM * M_PER_NM * 0.01) {
    return `${(m2 / (M_PER_NM * M_PER_NM)).toFixed(2)} NM²`;
  }
  if (units === 'imperial') {
    const sqft = m2 * FT_PER_M * FT_PER_M;
    if (sqft < SQFT_PER_ACRE) return `${Math.round(sqft)} ft²`;
    const sqmi = m2 * SQMI_PER_SQM;
    if (sqmi < 1) return `${(sqft / SQFT_PER_ACRE).toFixed(2)} acres`;
    return `${sqmi.toFixed(2)} mi²`;
  }
  if (m2 < 10000) return `${Math.round(m2)} m²`;
  if (m2 < 1e6) return `${(m2 / 10000).toFixed(2)} ha`;
  return `${(m2 / 1e6).toFixed(2)} km²`;
}

/** A compass bearing as it is read aloud: three digits, `047°`, or `047.3°` with a decimal. */
export function formatBearing(deg, decimals = 0) {
  const step = 10 ** decimals;
  const turn = (((Math.round(deg * step) / step) % 360) + 360) % 360;
  const [whole, part] = turn.toFixed(decimals).split('.');
  return `${whole.padStart(3, '0')}${part ? `.${part}` : ''}°`;
}
