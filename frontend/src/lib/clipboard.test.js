import { afterEach, describe, expect, it, vi } from 'vitest';
import { uiState } from './state.svelte.js';
import { copyText, REFUSED } from './clipboard.js';

afterEach(() => {
  uiState.toasts = [];
  vi.unstubAllGlobals();
});

const clipboard = (writeText) => vi.stubGlobal('navigator', { clipboard: { writeText } });

describe('copyText', () => {
  it('copies and says so', async () => {
    const writeText = vi.fn().mockResolvedValue();
    clipboard(writeText);
    expect(await copyText('47.1, 2.3')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('47.1, 2.3');
    expect(uiState.toasts.map((t) => [t.message, t.kind])).toEqual([['Copied', 'ok']]);
  });

  it('says the browser refused, and reports it rather than throwing', async () => {
    clipboard(vi.fn().mockRejectedValue(new DOMException('Document is not focused', 'NotAllowedError')));
    expect(await copyText('x')).toBe(false);
    expect(uiState.toasts.map((t) => [t.message, t.kind])).toEqual([[REFUSED, 'warn']]);
  });

  it('stays quiet on success when asked, never on a refusal', async () => {
    clipboard(vi.fn().mockResolvedValue());
    await copyText('x', { quiet: true });
    expect(uiState.toasts).toEqual([]);
  });
});
