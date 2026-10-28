/**
 * The demo case's files: photos in the public domain, credited in photos/CREDITS.md.
 *
 * Real pictures of a real port, so a proof the guide shows matches the imagery it is
 * argued against. The accounts and posts they are said to come from are made up; what
 * each photo shows, where and when, is its own. The one video is a photo ffmpeg pans
 * across, the way the drawn scenes it replaces were.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), 'photos');

/** The case as filed: what each file is called, the post it came from, and the photo it is made from. */
export const PHOTOS = [
  { file: 'bridge_channel.jpg', source: 'https://example.org/posts/0412' },
  { file: 'channel_departure.mp4', source: 'https://example.org/videos/2271', photo: 'channel_departure.jpg', video: true },
  { file: 'container_yard.jpg', source: 'https://example.org/posts/0397' },
  { file: 'half_dome_1901.jpg', source: '' },
  { file: 'wando_terminal.jpg', source: 'https://example.org/posts/0388' },
  { file: 'miami_port_aerial.jpg', source: 'https://example.org/posts/0420' },
].map((one) => ({ ...one, path: join(HERE, one.photo ?? one.file) }));
