import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

vi.mock('konva', () => ({ default: {} }));

import ProofComposer, {
  bindPanelPointerLifecycle,
  createCanvasRenderGate,
} from './ProofComposer.svelte';

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
    const group = { on: vi.fn((events, handler) => handlers.set(events, handler)) };
    return { handlers, group };
  }

  const panelHit = () => ({ target: { name: () => 'panel-hit' } });

  it('does not select and rebuild the panel during pointerdown', () => {
    const { group, handlers } = fakeGroup();
    const onPress = vi.fn();
    const onSelect = vi.fn();

    bindPanelPointerLifecycle(group, { onPress, onSelect, onDragEnd: null });
    handlers.get('pointerdown')(panelHit());

    expect(onPress).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();

    handlers.get('click tap')(panelHit());
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
    handlers.get('dragend')({ target: group });

    expect(calls).toEqual(['select', 'commit']);
  });

  it('ignores click and drag events bubbled from an annotation', () => {
    const { group, handlers } = fakeGroup();
    const onPress = vi.fn();
    const onSelect = vi.fn();
    const onDragEnd = vi.fn();
    const annotation = { name: () => '' };

    bindPanelPointerLifecycle(group, { onPress, onSelect, onDragEnd });
    handlers.get('pointerdown')({ target: annotation });
    handlers.get('click tap')({ target: annotation });
    handlers.get('dragend')({ target: annotation });

    expect(onPress).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDragEnd).not.toHaveBeenCalled();
  });
});

describe('Proof Composer canvas render gate', () => {
  function setup() {
    const callbacks = new Map();
    let nextId = 1;
    const schedule = vi.fn((callback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    });
    const cancel = vi.fn((id) => callbacks.delete(id));
    const rebuild = vi.fn();
    const refreshUi = vi.fn();
    const gate = createCanvasRenderGate(schedule, cancel, { rebuild, refreshUi });
    const runFrame = () => {
      const [id, callback] = callbacks.entries().next().value ?? [];
      if (!callback) return;
      callbacks.delete(id);
      callback();
    };
    return { gate, schedule, cancel, rebuild, refreshUi, callbacks, runFrame };
  }

  it('defers a reactive rebuild until the pointer gesture has ended', () => {
    const { gate, schedule, rebuild, runFrame } = setup();

    gate.beginPointer();
    gate.requestRebuild();

    expect(schedule).not.toHaveBeenCalled();
    expect(rebuild).not.toHaveBeenCalled();

    gate.endPointer();
    expect(schedule).toHaveBeenCalledOnce();
    runFrame();
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it('coalesces repeated state changes into one rebuild', () => {
    const { gate, schedule, rebuild, runFrame } = setup();

    gate.requestRebuild();
    gate.requestRebuild();
    gate.requestRebuild();

    expect(schedule).toHaveBeenCalledOnce();
    runFrame();
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it('does not rebuild when a new pointer starts before the frame runs', () => {
    const { gate, rebuild, runFrame } = setup();

    gate.requestRebuild();
    gate.beginPointer();
    runFrame();
    expect(rebuild).not.toHaveBeenCalled();

    gate.endPointer();
    runFrame();
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it('refreshes selection UI without rebuilding the document', () => {
    const { gate, rebuild, refreshUi, runFrame } = setup();

    gate.requestUi();
    runFrame();

    expect(refreshUi).toHaveBeenCalledOnce();
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('lets a document rebuild absorb a queued selection refresh', () => {
    const { gate, rebuild, refreshUi, runFrame } = setup();

    gate.requestUi();
    gate.requestRebuild();
    runFrame();

    expect(rebuild).toHaveBeenCalledOnce();
    expect(refreshUi).not.toHaveBeenCalled();
  });

  it('cancels a queued rebuild when the canvas is destroyed', () => {
    const { gate, cancel, rebuild, runFrame } = setup();

    gate.requestRebuild();
    gate.destroy();

    expect(cancel).toHaveBeenCalledOnce();
    runFrame();
    expect(rebuild).not.toHaveBeenCalled();
  });
});
