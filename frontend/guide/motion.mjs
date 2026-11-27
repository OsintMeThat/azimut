/**
 * Where a guide film moves, so the journey's bubble can stand where it does not
 * (components/JourneyStage.svelte, `bubbleSpot`).
 *
 * The film is read back small and grey, and each cell of a coarse grid says how much of
 * it ever differs from the first frame: the pointer's way, the shapes drawn, the panel
 * that slides in. A row of the answer is a string of digits, one per cell, 0 for still
 * and 9 for a cell that changes all over, so the picture's JSON stays readable.
 *
 *     node guide/motion.mjs           # write it beside every film already made
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const COLS = 12;
const ROWS = 8;
/** How wide the film is read: enough for a pointer, little enough to read in a blink. */
const READ_WIDTH = 240;
/** A grey step past compression's own shimmer. */
const CHANGED = 25;

function sizeOf(film) {
  const probe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', film],
    { encoding: 'utf8' }
  );
  if (probe.status !== 0) throw new Error(`ffprobe could not read ${film}`);
  const [width, height] = probe.stdout.trim().split(',').map(Number);
  return { width, height };
}

/** The grid of `film`, ROWS strings of COLS digits. */
export function motionOf(film) {
  const { width, height } = sizeOf(film);
  const w = READ_WIDTH;
  const h = Math.max(ROWS, Math.round((READ_WIDTH * height) / width / 2) * 2);
  const read = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-i', film, '-vf', `scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-'],
    { maxBuffer: 1 << 30 }
  );
  if (read.status !== 0) throw new Error(`ffmpeg could not read ${film}`);
  const pixels = read.stdout;
  const frame = w * h;
  const moved = new Uint8Array(frame);
  for (let at = frame; at + frame <= pixels.length; at += frame) {
    for (let i = 0; i < frame; i += 1) if (Math.abs(pixels[at + i] - pixels[i]) > CHANGED) moved[i] = 1;
  }
  const rows = [];
  for (let row = 0; row < ROWS; row += 1) {
    let line = '';
    const [top, bottom] = [Math.floor((row * h) / ROWS), Math.floor(((row + 1) * h) / ROWS)];
    for (let col = 0; col < COLS; col += 1) {
      const [left, right] = [Math.floor((col * w) / COLS), Math.floor(((col + 1) * w) / COLS)];
      let count = 0;
      for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) count += moved[y * w + x];
      const share = count / ((bottom - top) * (right - left));
      // any motion at all reads at least 1: a pointer is small and is what the eye follows
      line += share === 0 ? '0' : String(Math.min(9, Math.max(1, Math.round(share * 9))));
    }
    rows.push(line);
  }
  return rows;
}

/** Write `moves` into the JSON beside each film in `dir`. */
function backfill(dir) {
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.webm'))) {
    const json = join(dir, file.replace(/\.webm$/, '.json'));
    const map = JSON.parse(readFileSync(json, 'utf8'));
    map.moves = motionOf(join(dir, file));
    writeFileSync(json, `${JSON.stringify(map, null, 2)}\n`);
    process.stdout.write(`${file}\n${map.moves.join('\n')}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  backfill(join(dirname(fileURLToPath(import.meta.url)), '../src/assets/guide'));
}
