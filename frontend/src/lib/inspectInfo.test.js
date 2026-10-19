import { describe, expect, it } from 'vitest';
import { bitRate, encoderOf, fileSize, infoSections, metadataRows, plainDate } from './inspectInfo.js';

const rows = (sections, title) => Object.fromEntries((sections.find((s) => s.title === title)?.rows ?? []).map((r) => [r.k, r]));

const VIDEO_ITEM = {
  kind: 'video', size: 5_400_000, sha256: 'ab'.repeat(32), added_at: '2026-10-01T08:00:00Z',
  source: { type: 'download', webpage_url: 'https://example.org/post/1', uploader: 'someone', upload_date: '20240612' },
  taken_at: '2024-06-12T18:14:55Z', gps: { lat: 48.85, lon: 2.35 },
  video_metadata: { 'format.tags.encoder': 'Lavf60', 'streams.0.codec_name': 'h264' },
};
const VIDEO_PROBE = {
  kind: 'video', width: 1920, height: 1080, duration: 83.04, fps: 29.97, codec: 'h264', bit_rate: 4_200_000,
  audio: true, audio_codec: 'aac', vfr: true, encoder: 'Lavf60.3.100', rotation: 90,
};

describe('the Info tab', () => {
  it('reads a video from its probe and its sidecar', () => {
    const sections = infoSections({ item: VIDEO_ITEM, probe: VIDEO_PROBE, fileKind: 'video' });
    expect(sections.map((s) => s.title)).toEqual(['Video', 'Taken', 'File']);
    const video = rows(sections, 'Video');
    expect(video.Resolution.v).toBe('1920 × 1080');
    expect(video.Duration.v).toBe('1:23.040');
    expect(video['Frame rate'].v).toBe('29.97 fps (variable)');
    expect(video['Bit rate'].v).toBe('4.2 Mb/s');
    expect(video.Sound.v).toBe('aac');
    expect(video.Turned.v).toBe('90° in the file');
    expect(video.Software.v).toBe('Lavf60.3.100');
    const file = rows(sections, 'File');
    expect(file['SHA-256'].kind).toBe('hash');
    expect(file.Source).toMatchObject({ v: 'https://example.org/post/1', kind: 'link' });
    expect(file.Published.v).toBe('2024-06-12');
    expect(file.Added.v).toBe('2026-10-01');
    expect(rows(sections, 'Taken').GPS.kind).toBe('gps');
  });

  it('leaves out what the file does not say, rather than printing dashes', () => {
    const sections = infoSections({ item: { kind: 'video', size: 10 }, probe: { kind: 'video', audio: false }, fileKind: 'video' });
    expect(sections.map((s) => s.title)).toEqual(['Video', 'File']);
    expect(rows(sections, 'Video').Sound.v).toBe('none');
    expect(rows(sections, 'File')).not.toHaveProperty('SHA-256');
  });

  it('describes the frame picked from the file before the file itself', () => {
    const frame = { time: 12.4, w: 1920, h: 1080, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } };
    const sections = infoSections({ item: VIDEO_ITEM, probe: { ...VIDEO_PROBE, fps: 25 }, frame, fileKind: 'video' });
    expect(sections[0].title).toBe('This frame');
    const here = rows(sections, 'This frame');
    expect(here['Cut at'].v).toBe('0:12.400');
    expect(here.Frame.v).toBe('311');
    expect(here.Size.v).toBe('960 × 540 (cropped)');
  });

  it('says nothing of a frame that is the image itself', () => {
    const sections = infoSections({ item: { kind: 'image' }, probe: { width: 80, height: 60 }, frame: { time: null, w: 80, h: 60, crop: null }, fileKind: 'image' });
    expect(sections.map((s) => s.title)).toEqual(['Picture']);
  });

  it('reads an image, its software from EXIF', () => {
    const item = { kind: 'image', size: 2048, exif: { Software: 'Snapseed 2.0', Make: 'X' } };
    const sections = infoSections({ item, probe: { kind: 'image', width: 80, height: 60, format: 'JPEG' }, fileKind: 'image' });
    const picture = rows(sections, 'Picture');
    expect(picture.Codec.v).toBe('JPEG');
    expect(picture.Software.v).toBe('Snapseed 2.0');
    expect(picture).not.toHaveProperty('Frame rate');
    expect(metadataRows(item)).toEqual([['Software', 'Snapseed 2.0'], ['Make', 'X']]);
    expect(metadataRows(VIDEO_ITEM)).toHaveLength(2);
  });

  it('formats sizes, rates and dates the way the rest of the app reads them', () => {
    expect(fileSize(512)).toBe('512 B');
    expect(fileSize(2048)).toBe('2 KB');
    expect(fileSize(5_400_000)).toBe('5.1 MB');
    expect(fileSize(undefined)).toBe('');
    expect(bitRate(96_000)).toBe('96 kb/s');
    expect(bitRate(0)).toBe('');
    expect(plainDate('20240612')).toBe('2024-06-12');
    expect(plainDate('2024-06-12')).toBe('2024-06-12');
    expect(encoderOf({ exif: {} }, {})).toBe('');
  });
});
