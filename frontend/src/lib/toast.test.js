import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast, uiState } from './state.svelte.js';

afterEach(() => {
  vi.useRealTimers();
  uiState.toasts = [];
});

describe('toast actions', () => {
  it('keeps an optional action with the toast for the action button to consume', () => {
    const action = { label: 'OPEN', onClick: vi.fn() };

    toast('Report saved as a note', 'ok', 6000, action);

    expect(uiState.toasts).toHaveLength(1);
    expect(uiState.toasts[0].action).toBe(action);
  });

  it('keeps the existing auto-dismiss behavior', () => {
    vi.useFakeTimers();
    toast('Report saved as a note', 'ok', 6000);

    vi.advanceTimersByTime(5999);
    expect(uiState.toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(uiState.toasts).toHaveLength(0);
  });
});
