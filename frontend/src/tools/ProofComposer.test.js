import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

vi.mock('konva', () => ({ default: {} }));

import ProofComposer, { bindPanelPointerLifecycle } from './ProofComposer.svelte';

describe('Proof Composer empty state', () => {
  it('hides proof-specific chrome until a proof is started', () => {
    const { body } = render(ProofComposer);

    expect(body).toContain('Compose a proof');
    expect(body).toContain('Freehand (d)');
    expect(body).not.toContain('title-input');
    expect(body).not.toContain('<aside');
    expect(body).not.toContain('House style');
    expect(body).not.toContain('Coordinates');
    expect(body).not.toContain('Annotations');
  });
});

describe('Proof Composer panel pointer lifecycle', () => {
  function fakeGroup() {
    const handlers = new Map();
    return {
      handlers,
      group: { on: vi.fn((events, handler) => handlers.set(events, handler)) },
    };
  }

  it('does not select and rebuild the panel during pointerdown', () => {
    const { group, handlers } = fakeGroup();
    const onPress = vi.fn();
    const onSelect = vi.fn();

    bindPanelPointerLifecycle(group, { onPress, onSelect, onDragEnd: null });
    handlers.get('pointerdown')();

    expect(onPress).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();

    handlers.get('click tap')();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('selects a dragged panel only after the drag has ended', () => {
    const { group, handlers } = fakeGroup();
    const calls = [];

    bindPanelPointerLifecycle(group, {
      onPress: vi.fn(),
      onSelect: () => calls.push('select'),
      onDragEnd: () => calls.push('commit'),
    });
    handlers.get('dragend')();

    expect(calls).toEqual(['select', 'commit']);
  });
});
