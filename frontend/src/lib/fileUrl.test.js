import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { encodeRelPath, fileRelPath, fileUrl } from './fileUrl.js';

describe('fileUrl', () => {
  it('encodes the hash a downloaded video is really named with', () => {
    // The bug this exists for: raw, the `#` opens a fragment, the request
    // reaches the server as `media/` and the video plays nowhere while its
    // hash-named thumbnail still shows.
    const url = fileUrl('case-1', 'media/#3deenero2025.mp4');
    expect(url).toBe('/files/case-1/media/%233deenero2025.mp4');
    expect(new URL(url, 'http://localhost').hash).toBe('');
  });

  it('encodes every other character that would end or reroute the path', () => {
    expect(encodeRelPath('media/what?.png')).toBe('media/what%3F.png');
    expect(encodeRelPath('media/100%.jpg')).toBe('media/100%25.jpg');
    expect(encodeRelPath('media/a+b.png')).toBe('media/a%2Bb.png');
    expect(encodeRelPath('media/two words.png')).toBe('media/two%20words.png');
  });

  it('keeps the separators, so a nested path stays a path', () => {
    expect(fileUrl('c', 'proofs/A trip.assets/shot.png')).toBe(
      '/files/c/proofs/A%20trip.assets/shot.png',
    );
  });

  it('leaves an ordinary name alone', () => {
    expect(fileUrl('c', 'media/.thumbs/ae3606-g1.jpg')).toBe('/files/c/media/.thumbs/ae3606-g1.jpg');
  });

  it('reads a path back out of its own URL', () => {
    const path = 'media/#3deenero2025.mp4';
    expect(fileRelPath(fileUrl('c', path), 'c')).toBe(path);
  });

  it('reads back a path from a URL written before the encoding', () => {
    expect(fileRelPath('/files/c/media/#3deenero2025.mp4', 'c')).toBe('media/#3deenero2025.mp4');
  });

  it('survives a stray percent rather than throwing on an old note', () => {
    expect(fileRelPath('/files/c/media/100%.jpg', 'c')).toBe('media/100%.jpg');
  });

  it('ignores URLs that point somewhere else', () => {
    expect(fileRelPath('https://example.com/a.png', 'c')).toBeNull();
    expect(fileRelPath('/files/other/media/a.png', 'c')).toBeNull();
    expect(fileRelPath('/files/c/media/a.png', null)).toBeNull();
  });
});

describe('the case-file route has one builder', () => {
  it('is reached through this module everywhere, never interpolated by hand', () => {
    // The bug was one unencoded template literal among forty identical ones, in
    // whichever tool happened to render that file. A tool added later would
    // reintroduce it silently, so the gate is on the pattern, not on the tools.
    const root = fileURLToPath(new URL('..', import.meta.url));
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== 'node_modules') walk(path);
        } else if (/\.(svelte|js)$/.test(name) && !name.endsWith('.test.js') && name !== 'fileUrl.js') {
          if (/`\/files\//.test(readFileSync(path, 'utf8'))) offenders.push(path.slice(root.length));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
