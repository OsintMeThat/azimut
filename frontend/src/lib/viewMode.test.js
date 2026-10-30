// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadViewMode, saveViewMode } from './viewMode.js';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('the remembered view mode', () => {
  it('starts on the tool’s own default', () => {
    expect(loadViewMode('media', 'large')).toBe('large');
    expect(loadViewMode('files', 'small')).toBe('small');
  });

  it('comes back as it was left, apart for each tool', () => {
    saveViewMode('media', 'list');
    saveViewMode('files', 'large');
    expect(loadViewMode('media', 'large')).toBe('list');
    expect(loadViewMode('files', 'small')).toBe('large');
  });

  it('ignores a stored value it does not know', () => {
    localStorage.setItem('azimut:view:media', 'huge');
    expect(loadViewMode('media', 'large')).toBe('large');
  });

  it('still answers when the browser keeps nothing', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    });
    expect(() => saveViewMode('files', 'list')).not.toThrow();
    expect(loadViewMode('files', 'small')).toBe('small');
  });
});
