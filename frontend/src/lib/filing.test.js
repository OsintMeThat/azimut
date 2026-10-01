import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from './api.js';
import { assignFolder, assignFolderBatch, renameEntity } from './filing.js';

vi.mock('./api.js', () => ({ api: { patch: vi.fn(async () => ({})) } }));

beforeEach(() => api.patch.mockClear());

const media = { id: 'm1', type: 'media', attrs: { path: 'media/a.jpg' } };
const capture = { id: 'c1', type: 'capture', attrs: { path: 'media/cap.png' } };
const note = { id: 'n1', type: 'note', attrs: {} };

describe('assignFolder', () => {
  it('files media through the media sidecar endpoint (path + folder)', async () => {
    await assignFolder('case-1', media, 'Sources/Telegram');
    expect(api.patch).toHaveBeenCalledWith('/api/cases/case-1/media', {
      path: 'media/a.jpg',
      folder: 'Sources/Telegram',
    });
  });

  it('files captures through the media endpoint too (they live in media/)', async () => {
    await assignFolder('case-1', capture, 'Places');
    expect(api.patch).toHaveBeenCalledWith('/api/cases/case-1/media', {
      path: 'media/cap.png',
      folder: 'Places',
    });
  });

  it('files other entities on the entity itself (attrs.folder)', async () => {
    await assignFolder('case-1', note, 'Timeline');
    expect(api.patch).toHaveBeenCalledWith('/api/cases/case-1/entities/n1', {
      attrs: { folder: 'Timeline' },
    });
  });

  it('unfiles with an empty string when folder is falsy', async () => {
    await assignFolder('case-1', media, '');
    expect(api.patch).toHaveBeenCalledWith('/api/cases/case-1/media', {
      path: 'media/a.jpg',
      folder: '',
    });
  });
});

describe('assignFolderBatch', () => {
  it('files every entity into the target folder', async () => {
    await assignFolderBatch('case-1', [media, note], 'Box');
    expect(api.patch).toHaveBeenCalledTimes(2);
    expect(api.patch).toHaveBeenNthCalledWith(1, '/api/cases/case-1/media', {
      path: 'media/a.jpg',
      folder: 'Box',
    });
    expect(api.patch).toHaveBeenNthCalledWith(2, '/api/cases/case-1/entities/n1', {
      attrs: { folder: 'Box' },
    });
  });
});

describe('renameEntity', () => {
  it('renames a media through its own route, which renames the file', async () => {
    await renameEntity('case-1', media, '  Gate at dawn ');
    expect(api.patch).toHaveBeenCalledWith('/api/cases/case-1/media', { path: 'media/a.jpg', title: 'Gate at dawn' });
  });

  it('renames a capture through the satellite route, as Details does', async () => {
    await renameEntity('case-1', capture, 'North pier');
    expect(api.patch).toHaveBeenCalledWith('/api/cases/case-1/satellite', { path: 'media/cap.png', title: 'North pier' });
  });

  it('renames anything else by its label, which moves a note or a proof file server-side', async () => {
    await renameEntity('case-1', note, 'Summary');
    expect(api.patch).toHaveBeenCalledWith('/api/cases/case-1/entities/n1', { label: 'Summary' });
  });

  it('does nothing for an empty name', async () => {
    await renameEntity('case-1', note, '   ');
    expect(api.patch).not.toHaveBeenCalled();
  });
});
