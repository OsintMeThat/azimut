/**
 * How far a colour stands out from what it sits on, as WCAG measures it, for the tests
 * that hold the app's quiet controls to 3:1 (WCAG 2.2, 1.4.11 Non-text Contrast): each
 * colour's relative luminance, and their ratio, from 1 (none) to 21. A colour with an
 * alpha, or drawn at an opacity, is laid over what it sits on first.
 */

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` or `rgba()` as `{ r, g, b, a }` (0-255, alpha 0-1), else null. */
export function parseColour(text) {
  const value = String(text ?? '').trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1];
    const channel = (at) => Number.parseInt(digits.slice(at, at + 2), 16);
    return { r: channel(0), g: channel(2), b: channel(4), a: digits.length === 8 ? channel(6) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value);
  if (!rgb) return null;
  const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? Number.parseFloat(rgb[4]) / 100 : Number.parseFloat(rgb[4]);
  return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: alpha };
}

/** `top` laid over `under` (opaque), at `top`'s alpha times `opacity`. */
export function over(top, under, opacity = 1) {
  const a = Math.max(0, Math.min(1, top.a * opacity));
  const mix = (key) => top[key] * a + under[key] * (1 - a);
  return { r: mix('r'), g: mix('g'), b: mix('b'), a: 1 };
}

/** WCAG's relative luminance of an opaque colour. */
export function luminance({ r, g, b }) {
  const linear = (channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The contrast ratio of `fore` (laid over `back` at `opacity`) against `back`, an opaque colour. */
export function contrast(fore, back, opacity = 1) {
  const drawn = luminance(over(fore, back, opacity));
  const ground = luminance(back);
  return (Math.max(drawn, ground) + 0.05) / (Math.min(drawn, ground) + 0.05);
}
