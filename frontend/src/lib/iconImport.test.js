// @vitest-environment happy-dom
/**
 * What an icon import sends. The rules worth pinning are the ones an analyst
 * would see go wrong: a pack's folders becoming its groups, the junk a zip made
 * on a Mac carries left out, a file past the size the server takes said rather
 * than sent, and an SVG drawn into a picture before it leaves the browser.
 */
import { describe, expect, it, vi } from 'vitest';
import { BATCH, MAX_FILE_BYTES, collectIcons, groupOf, importIcons, inflateRaw, rasterSvg, readZip } from './iconImport.js';

const bytes = (text) => new TextEncoder().encode(text);

async function deflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A zip of `entries` (`[path, data, { method, size, flags }]`), the way any archiver writes one. */
async function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [path, data, { method = 0, size = data.length, flags = 0 } = {}] of entries) {
    const name = bytes(path);
    const stored = method === 8 ? await deflate(data) : data;
    const local = new Uint8Array(30 + name.length + stored.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(6, flags, true); view.setUint16(8, method, true);
    view.setUint32(18, stored.length, true); view.setUint32(22, size, true); view.setUint16(26, name.length, true);
    local.set(name, 30); local.set(stored, 30 + name.length);
    const entry = new Uint8Array(46 + name.length);
    const record = new DataView(entry.buffer);
    record.setUint32(0, 0x02014b50, true); record.setUint16(8, flags, true); record.setUint16(10, method, true);
    record.setUint32(20, stored.length, true); record.setUint32(24, size, true); record.setUint16(28, name.length, true);
    record.setUint32(42, offset, true); entry.set(name, 46);
    locals.push(local); central.push(entry);
    offset += local.length;
  }
  const directory = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const tail = new DataView(end.buffer);
  tail.setUint32(0, 0x06054b50, true); tail.setUint16(8, entries.length, true); tail.setUint16(10, entries.length, true);
  tail.setUint32(12, directory, true); tail.setUint32(16, offset, true);
  return new Blob([...locals, ...central, end]).arrayBuffer();
}

describe('reading an icon pack', () => {
  it('names the group a file lands in after the folder it sits in', () => {
    expect(groupOf('pack/Vehicles/tank.png')).toBe('Vehicles');
    expect(groupOf('Vehicles\\tank.png')).toBe('Vehicles');
    expect(groupOf('tank.png')).toBe('');
  });

  it('reads stored and deflated pictures, and leaves out folders, junk and what is not a picture', async () => {
    const buffer = await zip([
      ['Vehicles/', new Uint8Array()],
      ['Vehicles/tank.png', bytes('PNGDATA')],
      ['Vehicles/truck.svg', bytes('<svg/>'), { method: 8 }],
      ['__MACOSX/Vehicles/._tank.png', bytes('junk')],
      ['.DS_Store', bytes('junk')],
      ['readme.txt', bytes('hello')],
    ]);
    const { members, skipped } = await readZip(buffer);
    expect(members.map((member) => member.path)).toEqual(['Vehicles/tank.png', 'Vehicles/truck.svg']);
    expect(new TextDecoder().decode(members[1].data)).toBe('<svg/>');
    expect(skipped).toEqual([]);
  });

  it('says why a member is left out rather than sending it', async () => {
    const buffer = await zip([
      ['big.png', bytes('x'), { size: MAX_FILE_BYTES + 1 }],
      ['locked.png', bytes('x'), { flags: 1 }],
    ]);
    const { members, skipped } = await readZip(buffer);
    expect(members).toEqual([]);
    expect(skipped).toEqual([{ name: 'big.png', reason: 'an icon file weighs at most 512 KB' },
      { name: 'locked.png', reason: 'it is encrypted' }]);
  });

  it('refuses a file that is not a zip', async () => {
    await expect(readZip(bytes('not a zip at all, not even close to one').buffer)).rejects.toThrow('could not be read');
  });

  it('stops inflating a member past the size it may reach', async () => {
    const packed = await deflate(new Uint8Array(4096));
    await expect(inflateRaw(packed, 100)).rejects.toThrow('too large');
    expect((await inflateRaw(packed, 4096)).length).toBe(4096);
  });
});

describe('drawing an SVG', () => {
  it('gives an SVG with only a viewBox the size it is drawn at, its shape kept', async () => {
    const draw = vi.fn(async () => 'png');
    expect(await rasterSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12"><path d="M0 0h24v12z"/></svg>', { draw })).toBe('png');
    const [markup, size] = draw.mock.calls[0];
    expect(size).toEqual({ width: 256, height: 128 });
    expect(markup).toContain('width="256"');
    expect(markup).toContain('height="128"');
  });

  it('gives one with only a size a viewBox, so it is scaled rather than cropped', async () => {
    const draw = vi.fn(async () => 'png');
    await rasterSvg('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32"/></svg>', { draw });
    expect(draw.mock.calls[0][0]).toContain('viewBox="0 0 32 32"');
  });

  it('draws nothing from a file that is not an SVG', async () => {
    const draw = vi.fn();
    expect(await rasterSvg('<html><body>no</body></html>', { draw })).toBeNull();
    expect(draw).not.toHaveBeenCalled();
  });
});

describe('collecting and sending', () => {
  const file = (name, size = 10, path = '') => {
    const made = new File([new Uint8Array(size)], name);
    if (path) Object.defineProperty(made, 'webkitRelativePath', { value: path });
    return made;
  };

  it('takes pictures as they are, draws SVGs, and files a folder by its subfolders', async () => {
    const svg = vi.fn(async () => new Blob(['png']));
    const { items, skipped } = await collectIcons([
      file('tank.png'), file('flag.svg'), file('notes.txt'), file('huge.png', MAX_FILE_BYTES + 1),
      file('car.webp', 10, 'Icons/Vehicles/car.webp'),
    ], { svg });
    expect(items.map((item) => [item.name, item.group])).toEqual([['tank.png', ''], ['flag.svg', ''], ['car.webp', 'Vehicles']]);
    expect(svg).toHaveBeenCalledTimes(1);
    expect(skipped.map((item) => item.name)).toEqual(['notes.txt', 'huge.png']);
  });

  it('files a pack with no folders under the pack name', async () => {
    const zipped = vi.fn(async () => ({ members: [{ path: 'one.png', data: new Uint8Array(4) },
      { path: 'Inner/two.png', data: new Uint8Array(4) }], skipped: [{ name: 'x.png', reason: 'it is encrypted' }] }));
    const { items, skipped } = await collectIcons([file('Armour pack.zip')], { zip: zipped });
    expect(items.map((item) => [item.name, item.group])).toEqual([['one.png', 'Armour pack'], ['two.png', 'Inner']]);
    expect(skipped).toEqual([{ name: 'x.png', reason: 'it is encrypted' }]);
  });

  it('sends the icons in batches the server takes, and adds up what each answered', async () => {
    const items = Array.from({ length: BATCH + 3 }, (_, index) => ({ name: `i${index}.png`, blob: new Blob(['x']), group: 'G' }));
    const api = { post: vi.fn(async (_path, form) => ({ added: form.getAll('files').map((entry) => ({ name: entry.name })), already: 1,
      skipped: [] })) };
    const progress = vi.fn();
    const answer = await importIcons([], { api, onprogress: progress,
      collect: async () => ({ items, skipped: [{ name: 'bad.txt', reason: 'no' }] }) });
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.post.mock.calls[0][1].getAll('groups')).toHaveLength(BATCH);
    expect(answer.added).toHaveLength(BATCH + 3);
    expect(answer.already).toBe(2);
    expect(answer.skipped).toEqual([{ name: 'bad.txt', reason: 'no' }]);
    expect(progress).toHaveBeenLastCalledWith(BATCH + 3, BATCH + 3);
  });
});
