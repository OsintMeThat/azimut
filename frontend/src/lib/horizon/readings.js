/**
 * What the Horizon tab says about a direction or a point, in words.
 *
 * Kept apart from the components so each sentence is written, and tested,
 * once: the pointer's reading on the view, a summit's, and the marked point's.
 */
import { formatDistance, formatHeight } from '../measure.js';

const DEGREE = (value, decimals) => `${Math.abs(value).toFixed(decimals)}°`;

/** "2.5° up", "0.4° down", "level". */
export function upOrDown(elevation) {
  const rounded = Number(elevation.toFixed(1));
  if (rounded === 0) return 'level';
  return `${DEGREE(rounded, 1)} ${rounded > 0 ? 'up' : 'down'}`;
}

/**
 * The reading under the pointer: "107° · 2.5° up · 9.0 km away", or "… · sky".
 * A decimal on the direction once the lens is under 10° wide.
 */
export function pointerReading({ azimuth, elevation, distance }, { fov = 60, units = 'metric' } = {}) {
  const direction = `${azimuth.toFixed(fov > 10 ? 0 : 1)}°`;
  const where = distance == null ? 'sky' : `${formatDistance(distance, units)} away`;
  return `${direction} · ${upOrDown(elevation)} · ${where}`;
}

/** A summit read on hover: "Eiger · 3 967 m · 13.2 km away". */
export function summitReading(label, units = 'metric') {
  const parts = [label.name];
  if (Number.isFinite(label.peak.ele)) parts.push(formatHeight(label.peak.ele, units));
  if (Number.isFinite(label.peak.distance)) parts.push(`${formatDistance(label.peak.distance, units)} away`);
  return parts.join(' · ');
}

/**
 * The marked point as the inspector says it, a line each: whether it is in
 * sight, how far and which way, then by how much it clears the ground in
 * front or is hidden by it.
 */
export function targetReading(target, units = 'metric') {
  const margin = target.margin_deg;
  return {
    verdict: target.visible ? 'In sight' : 'Hidden by the ground',
    where: `${formatDistance(target.distance, units)} away · bearing ${Number(target.azimuth.toFixed(1))}°`,
    margin: Number.isFinite(margin)
      ? `${Math.abs(margin).toFixed(1)}° ${margin >= 0 ? 'above' : 'under'} the ground in front`
      : '',
  };
}
