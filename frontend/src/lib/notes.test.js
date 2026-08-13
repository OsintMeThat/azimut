import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from './api.js';
import { createNote, deleteNote, resetCaseNotes } from './notes.js';

vi.mock('./api.js', () => ({
  api: {
    post: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
    del: vi.fn(async () => ({})),
  },
}));

beforeEach(() => {
  api.post.mockClear();
  api.put.mockClear();
  api.del.mockClear();
});

describe('createNote', () => {
  it('posts a filed Markdown note with content and folder', async () => {
    await createNote('case-1', { title: 'Lead', folder: 'Research', content: 'body' });
    expect(api.post).toHaveBeenCalledWith('/api/cases/case-1/notes', {
      title: 'Lead', folder: 'Research', content: 'body', sources: [],
    });
  });

  it('trims the title and folder, and defaults content to empty', async () => {
    await createNote('case-1', { title: '  Lead  ', folder: '  Research  ' });
    expect(api.post).toHaveBeenCalledWith('/api/cases/case-1/notes', {
      title: 'Lead', folder: 'Research', content: '', sources: [],
    });
  });

  it('leaves the note unfiled when no folder is given', async () => {
    await createNote('case-1', { title: 'Lead' });
    expect(api.post).toHaveBeenCalledWith('/api/cases/case-1/notes', {
      title: 'Lead', folder: '', content: '', sources: [],
    });
  });

  it('files what a report was written from, dropping the paths it has none of', async () => {
    // a note typed by hand sends nothing; a report sends the proof and media it
    // embeds, so deleting one of them scars the note instead of leaving a dead image
    await createNote('case-1', {
      title: 'Report',
      content: 'body',
      sources: ['proofs/a.png', null, 'media/b.jpg', ''],
    });

    expect(api.post.mock.calls[0][1].sources).toEqual(['proofs/a.png', 'media/b.jpg']);
  });

  it('rejects a blank title without hitting the API', async () => {
    await expect(createNote('case-1', { title: '   ' })).rejects.toThrow('Title required');
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('case note actions', () => {
  it('resets the case-wide note through its notes endpoint', async () => {
    await resetCaseNotes('case-1');

    expect(api.put).toHaveBeenCalledWith('/api/cases/case-1/notes', { text: '' });
  });

  it('deletes a filed note through the entity delete endpoint', async () => {
    await deleteNote('case-1', 'note-1');

    expect(api.del).toHaveBeenCalledWith('/api/cases/case-1/entities/note-1');
  });
});
