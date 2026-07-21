import { describe, expect, it } from 'vitest';
import { insertNotebookText, notebookImageMarkdown, notebookMediaMarkdown } from './notebookContent.js';

describe('Notebook content helpers', () => {
  it('inserts a reference at the current selection', () => {
    expect(insertNotebookText('Before after', 'middle ', 7, 7)).toEqual({
      text: 'Before middle after', cursor: 14,
    });
  });

  it('writes a case-local Markdown image reference', () => {
    expect(notebookImageMarkdown('case-1', { filename: 'frame.png', path: 'media/frame.png' }, { id: 'e_frame', label: 'frame.png' }))
      .toBe('[[media:e_frame|frame.png]]');
  });

  it('records a video as a case media reference', () => {
    expect(notebookMediaMarkdown('case-1', { id: 'e_clip', label: 'clip.mp4', attrs: { path: 'media/clip.mp4', kind: 'video' } }))
      .toBe('[[media:e_clip|clip.mp4]]');
  });
});
