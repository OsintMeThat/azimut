// Pure geodesic geometry for the Satellite measure tools (distance / area /
// angle). Points are { lat, lon } in degrees. Kept free of Leaflet so it can be
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

export function formatDistance(m) {
  if (m < 1000) return `${m < 10 ? m.toFixed(1) : Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

export function formatArea(m2) {
  if (m2 < 10000) return `${Math.round(m2)} m²`;
  if (m2 < 1e6) return `${(m2 / 10000).toFixed(2)} ha`;
  return `${(m2 / 1e6).toFixed(2)} km²`;
}

// Two straight rays meeting at a vertex form a pair of supplementary angles
// (they sum to 180°). Report both the acute and the obtuse one so the reader
// doesn't have to work out the complement themselves (Satellite item 7).
export function formatAngle(deg) {
  const other = 180 - deg;
  const acute = Math.min(deg, other);
  const obtuse = Math.max(deg, other);
  return `${acute.toFixed(1)}° · ${obtuse.toFixed(1)}°`;
}
