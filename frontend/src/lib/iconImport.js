/**
 * What an icon import sends: the files the analyst picked or dropped, a folder,
 * or a zipped icon pack, as pictures the server can decode.
 *
 * The browser does two things here the server will not. It opens a zip, so a
 * pack's folders become the library's groups. And it draws every SVG as a PNG:
 * the server stores no SVG, since one can carry a script, and Python has no
 * renderer for one that installs everywhere. An image drawn from an SVG runs
 * nothing, the browser's own rule for `<img>`.
 */

/** Sides of the PNG an SVG is drawn as: the server sizes it down to the library's weight. */
export const SVG_SIDE = 256;
/** What one file may weigh, as the server's limit (`iconlibrary.MAX_FILE_BYTES`). */
export const MAX_FILE_BYTES = 512 * 1024;
/** How many files one request carries (`api/icons.MAX_FILES_PER_REQUEST`). */
export const BATCH = 50;
/** A zip is read whole in memory, so it is bounded: its size, its members, what each inflates to. */
export const MAX_ZIP_BYTES = 64 * 1024 * 1024;
export const MAX_MEMBERS = 2000;

const PICTURE = /\.(png|jpe?g|webp|gif|bmp)$/i;
const SVG = /\.svg$/i;
const ZIP = /\.zip$/i;

/** The group a file of a folder or a pack lands in: the folder it sits in, if any. */
export function groupOf(path) {
  const parts = String(path ?? '').replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : '';
}

const leaf = (path) => String(path ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
/** Junk a zip made on a Mac or Windows carries beside the icons. */
const junk = (path) => /(^|\/)(__MACOSX|\.[^/]*)(\/|$)/.test(String(path).replace(/\\/g, '/')) || /thumbs\.db$/i.test(path);

/**
 * The members of a zip, `{ path, data }`, the pictures and SVGs only.
 * `inflate(bytes, limit)` undoes a deflated member, refusing one past `limit`.
 */
export async function readZip(buffer, { inflate = inflateRaw } = {}) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length > MAX_ZIP_BYTES) throw new Error('This zip is over 64 MB; split the pack in parts');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at--) {
    if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) throw new Error('This zip could not be read');
  const count = Math.min(view.getUint16(end + 10, true), MAX_MEMBERS);
  let at = view.getUint32(end + 16, true);
  const members = [];
  const skipped = [];
  const text = new TextDecoder();
  for (let index = 0; index < count && at + 46 <= bytes.length; index++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const path = text.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extra + comment;
    if (path.endsWith('/') || junk(path) || !(PICTURE.test(path) || SVG.test(path))) continue;
    const name = leaf(path);
    if (flags & 1) { skipped.push({ name, reason: 'it is encrypted' }); continue; }
    if (size > MAX_FILE_BYTES) { skipped.push({ name, reason: 'an icon file weighs at most 512 KB' }); continue; }
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) { skipped.push({ name, reason: 'it could not be read' }); continue; }
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + compressed);
    try {
      const data = method === 0 ? raw.slice() : method === 8 ? await inflate(raw, MAX_FILE_BYTES) : null;
      if (!data) { skipped.push({ name, reason: 'it is packed in a way the app cannot open' }); continue; }
      members.push({ path, data });
    } catch {
      skipped.push({ name, reason: 'it could not be read' });
    }
  }
  return { members, skipped };
}

/** A raw deflate stream undone by the browser itself, stopped past `limit` bytes. */
export async function inflateRaw(bytes, limit) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel(); throw new Error('too large'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

/**
 * An SVG drawn as a PNG `side` pixels on its longer edge, or null. An SVG that
 * states no size of its own is given one from its viewBox, or it would draw at
 * the browser's default and come out cropped or blank.
 */
export async function rasterSvg(text, { side = SVG_SIDE, draw = drawSvg } = {}) {
  const doc = new DOMParser().parseFromString(String(text), 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
  const box = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  let width = parseFloat(root.getAttribute('width') ?? '');
  let height = parseFloat(root.getAttribute('height') ?? '');
  if (box.length === 4 && box[2] > 0 && box[3] > 0) [width, height] = [box[2], box[3]];
  if (!(width > 0) || !(height > 0)) [width, height] = [side, side];
  if (box.length !== 4) root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const fit = side / Math.max(width, height);
  const out = { width: Math.max(1, Math.round(width * fit)), height: Math.max(1, Math.round(height * fit)) };
  root.setAttribute('width', String(out.width));
  root.setAttribute('height', String(out.height));
  return draw(new XMLSerializer().serializeToString(root), out);
}

async function drawSvg(markup, { width, height }) {
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const image = await new Promise((resolve) => {
      const picture = new Image();
      picture.onload = () => resolve(picture);
      picture.onerror = () => resolve(null);
      picture.src = url;
    });
    if (!image) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Picked files → `{ items: [{ name, blob, group }], skipped: [{ name, reason }] }`.
 * A file in a picked folder carries its path (`webkitRelativePath`), which names
 * its group as a folder in a zip does.
 */
export async function collectIcons(files, { svg = rasterSvg, zip = readZip } = {}) {
  const items = [];
  const skipped = [];
  const take = async (path, blob) => {
    const name = leaf(path);
    if (SVG.test(name)) {
      const png = await svg(await blob.text()).catch(() => null);
      if (png) items.push({ name, blob: png, group: groupOf(path) });
      else skipped.push({ name, reason: 'this SVG could not be drawn' });
    } else if (PICTURE.test(name)) {
      if (blob.size > MAX_FILE_BYTES) skipped.push({ name, reason: 'an icon file weighs at most 512 KB' });
      else items.push({ name, blob, group: groupOf(path) });
    } else {
      skipped.push({ name, reason: 'an icon is a PNG, JPEG, WebP, GIF or SVG file' });
    }
  };
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    if (junk(path)) continue;
    if (ZIP.test(file.name)) {
      try {
        const opened = await zip(await file.arrayBuffer());
        skipped.push(...opened.skipped);
        const pack = file.name.replace(ZIP, '');
        for (const member of opened.members) {
          // a pack with no folders files its icons under the pack's own name
          const inner = member.path.includes('/') ? member.path : `${pack}/${member.path}`;
          await take(inner, new Blob([member.data]));
        }
      } catch (error) {
        skipped.push({ name: file.name, reason: error.message });
      }
      continue;
    }
    await take(path, file);
  }
  return { items, skipped };
}

/**
 * Collect, then send in batches. `onprogress(sent, total)` follows the batches;
 * the answer adds them up: `{ added, already, skipped }`.
 */
export async function importIcons(files, { api, onprogress = null, collect = collectIcons } = {}) {
  const { items, skipped } = await collect(files);
  const answer = { added: [], already: 0, skipped: [...skipped] };
  for (let at = 0; at < items.length; at += BATCH) {
    const form = new FormData();
    for (const item of items.slice(at, at + BATCH)) {
      form.append('files', item.blob, item.name);
      form.append('groups', item.group);
    }
    const body = await api.post('/api/icons', form);
    answer.added.push(...(body.added ?? []));
    answer.already += body.already ?? 0;
    answer.skipped.push(...(body.skipped ?? []));
    onprogress?.(Math.min(items.length, at + BATCH), items.length);
  }
  return answer;
}
