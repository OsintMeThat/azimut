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

describe('toast kinds and how long they stay', () => {
  it('takes error as danger, the kind the toast styles as a failure', () => {
    toast('This sheet could not be saved.', 'error');
    expect(uiState.toasts[0].kind).toBe('danger');
  });

  it('keeps a failure, or a toast with an action, up long enough to read and press', () => {
    vi.useFakeTimers();
    toast('Not saved', 'danger');
    toast('Removed', 'ok', undefined, { label: 'Undo', onClick: vi.fn() });
    toast('Copied', 'ok');
    vi.advanceTimersByTime(3800);
    expect(uiState.toasts.map((t) => t.message)).toEqual(['Not saved', 'Removed']);
    vi.advanceTimersByTime(4200);
    expect(uiState.toasts).toHaveLength(0);
  });
});
