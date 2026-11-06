import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { uiState } from '../lib/state.svelte.js';
import Toasts from './Toasts.svelte';

afterEach(() => {
  uiState.toasts = [];
});

describe('Toasts', () => {
  it('renders an action as an explicit clickable button', () => {
    uiState.toasts = [{
      id: 1,
      message: 'Report saved as a note',
      kind: 'ok',
      action: { label: 'OPEN', onClick: vi.fn() },
    }];

    const { body } = render(Toasts);

    expect(body).toContain('Report saved as a note');
    expect(body).toContain('>OPEN</button>');
    expect(body).toContain('toast-action');
  });
});

describe('Toasts with a choice', () => {
  it('renders each action of a list as its own button', () => {
    uiState.toasts = [{
      id: 1,
      message: 'Frame captured at 0:02 · Add a scene',
      kind: 'info',
      action: [{ label: 'Whole video', onClick: vi.fn() }, { label: 'This moment', onClick: vi.fn() }],
    }];
    const { body } = render(Toasts);
    expect(body).toContain('>Whole video</button>');
    expect(body).toContain('>This moment</button>');
    expect(body.match(/toast-action/g)).toHaveLength(2);
  });
});

describe('Toasts and a screen reader', () => {
  it('announces toasts politely and a failure at once', () => {
    uiState.toasts = [
      { id: 1, message: 'Copied', kind: 'ok' },
      { id: 2, message: 'Not saved', kind: 'danger' },
    ];
    const { body } = render(Toasts);
    expect(body).toContain('role="status"');
    expect(body).toContain('aria-live="polite"');
    expect(body.match(/role="alert"/g)).toHaveLength(1);
  });
});
