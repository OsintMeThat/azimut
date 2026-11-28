/**
 * A What's new page that plays (whatsNew.json, a page's `reel`): a few beats, one fading
 * into the next in a loop (components/NewsReel.svelte). A beat is one of:
 *
 * - a picture of the guide (`shot`), framed on a point and brought slowly nearer
 *   (`from` → `to`, each `[x, y, zoom]`, x and y read across the picture from 0 to 1), a
 *   control of it lit by its anchor (`ring`, named by `label`, `above` it or under it,
 *   lit `light` seconds in); with `film`, the film the guide plays in its place;
 * - a film made for What's new (`film` naming `src/assets/news/<name>.webm`, its first
 *   frame `<name>.webp` beside it);
 * - pages dealt out (`deck`, pictures of `src/assets/news`), the middle one lifted, then
 *   `pills` naming what they come out as;
 * - a page of a site scrolled (`page`), `scroll` widths down, then the pointer pressing
 *   at `click`, both read in widths of the page.
 *
 * Any beat may sit in a browser (`browser`, the address shown; `file` when that is a file
 * opened from the computer), carry a `chip` saying what it shows, hold `seconds` (a film
 * holds as long as it runs, `rate` times faster) and fit its picture whole (`fit:
 * "contain"`) rather than fill the room. A reader who asked for less motion sees each
 * beat's first framing, still.
 */
import { shotOf } from './guide.js';

const PICTURES = import.meta.glob('../assets/news/*.webp', { eager: true, query: '?url', import: 'default' });
const FILMS = import.meta.glob('../assets/news/*.webm', { eager: true, query: '?url', import: 'default' });

/** A picture made for What's new, or null when it was never made (`npm run guide:news`). */
export const newsPicture = (name) => /** @type {string | null} */ (PICTURES[`../assets/news/${name}.webp`] ?? null);
/** A film made for What's new, or null. */
export const newsFilm = (name) => /** @type {string | null} */ (FILMS[`../assets/news/${name}.webm`] ?? null);

/** How long a still beat holds when it says nothing. */
export const HOLD_MS = 3000;
/** How long one beat takes to fade into the next. */
export const FADE_MS = 380;
/** How long a dealt page waits for the one before it, and when the deck spreads. */
export const DEAL_MS = 110;
export const SPREAD_MS = 1500;

const WHOLE = [0.5, 0.5, 1];

/**
 * A beat as the player draws it, or null when a picture or a film it names was never
 * made: `kind` (picture, deck, site), its picture `src` and `film`, its size when it is a
 * guide picture, its framings, its ring.
 */
export function beatOf(raw) {
  const common = {
    chip: raw.chip ?? '',
    browser: raw.browser ?? '',
    file: Boolean(raw.file),
    hold: raw.seconds ? raw.seconds * 1000 : null,
    rate: raw.rate ?? 1,
    contain: raw.fit === 'contain',
  };
  if (raw.deck) {
    const pages = raw.deck.map(newsPicture);
    if (!pages.length || pages.some((src) => !src)) return null;
    return { ...common, kind: 'deck', pages, pills: raw.pills ?? [] };
  }
  if (raw.page) {
    const src = newsPicture(raw.page);
    if (!src) return null;
    return { ...common, kind: 'site', src, scroll: raw.scroll ?? 0, click: raw.click ?? null };
  }
  if (raw.shot) {
    const shot = shotOf(raw.shot);
    if (!shot || (raw.film && !shot.film)) return null;
    const anchor = raw.ring ? shot.anchors?.[raw.ring] : null;
    if (raw.ring && !anchor) return null;
    const from = raw.from ?? WHOLE;
    return {
      ...common,
      kind: 'picture',
      src: shot.src,
      film: raw.film ? shot.film : null,
      width: shot.width,
      height: shot.height,
      from,
      to: raw.to ?? from,
      ring: anchor ? { ...anchor, label: raw.label ?? '', above: Boolean(raw.above), light: (raw.light ?? 0.4) * 1000 } : null,
    };
  }
  if (raw.film) {
    const film = newsFilm(raw.film);
    const src = newsPicture(raw.film);
    if (!film || !src) return null;
    return { ...common, kind: 'picture', src, film, width: 0, height: 0, from: WHOLE, to: WHOLE, ring: null };
  }
  return null;
}

/** Every beat of a reel, or null when one of them cannot be drawn: a reel plays whole or not at all. */
export function beatsOf(reel) {
  const beats = (reel ?? []).map(beatOf);
  return beats.length && beats.every(Boolean) ? beats : null;
}

/**
 * Where a picture `width` × `height` stands in a room `roomW` × `roomH`: filling it,
 * cut where it overflows, or whole inside it (`contain`), centred either way.
 */
export function fitBox(width, height, roomW, roomH, contain = false) {
  const wide = width / height > roomW / roomH;
  const w = wide === contain ? roomW : (roomH * width) / height;
  const h = wide === contain ? (roomW * height) / width : roomH;
  return { w, h, left: (roomW - w) / 2, top: (roomH - h) / 2 };
}

/**
 * The move that brings the point `[x, y]` of a picture placed at `box` to the room's
 * centre at nearness `zoom`, as `translate(x, y) scale(zoom)` from the picture's corner.
 * A picture that fills the room never shows the room's edge; one shown whole grows from
 * its own centre.
 */
export function aim(box, [x, y, zoom], roomW, roomH, contain = false) {
  if (contain) return { x: ((1 - zoom) * box.w) / 2, y: ((1 - zoom) * box.h) / 2, zoom };
  const tx = roomW / 2 - box.left - zoom * x * box.w;
  const ty = roomH / 2 - box.top - zoom * y * box.h;
  return {
    x: Math.min(-box.left, Math.max(roomW - box.left - zoom * box.w, tx)),
    y: Math.min(-box.top, Math.max(roomH - box.top - zoom * box.h, ty)),
    zoom,
  };
}

/** A move as CSS. */
export const moveCss = ({ x, y, zoom }) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${zoom})`;
