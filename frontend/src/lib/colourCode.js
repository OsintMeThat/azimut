/**
 * A colour typed or pasted as text, read the ways it is usually copied: `#d55e00`,
 * `d55e00`, `#d50`, `rgb(213, 94, 0)` or `213, 94, 0`. An alpha is dropped, as
 * the map draws its colours whole. Answers `#rrggbb` in lower case, or null.
 */
export function parseColour(text) {
  const raw = String(text ?? '').trim().replace(/^['"]|['"]$/g, '').trim();
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(raw);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1].slice(0, 6);
    return `#${digits.toLowerCase()}`;
  }
  const rgb = /^(?:rgba?\(\s*)?(\d{1,3})\s*[\s,;]\s*(\d{1,3})\s*[\s,;]\s*(\d{1,3})(?:\s*[\s,/]\s*[\d.]+%?)?\s*\)?$/i.exec(raw);
  if (!rgb || /^rgba?\(/i.test(raw) !== raw.endsWith(')')) return null;
  const parts = rgb.slice(1, 4).map(Number);
  if (parts.some((part) => part > 255)) return null;
  return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}
