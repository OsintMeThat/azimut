/**
 * Keep selection out of pointerdown. Selecting rebuilds the Konva document,
 * so doing it before pointerup destroys the gesture target and can strand
 * Firefox's drag state. A click/tap or dragend is already a settled gesture.
 */
export function bindPanelPointerLifecycle(group, { onPress, onSelect, onDragEnd }) {
  const isPanelTarget = (event) =>
    event?.target === group || event?.target?.name?.() === 'panel-hit';
  group.on('pointerdown', (event) => {
    if (isPanelTarget(event)) onPress(event);
  });
  group.on('click tap', (event) => {
    if (isPanelTarget(event)) onSelect(event);
  });
  if (onDragEnd) {
    group.on('dragend', (event) => {
      // Konva drag events bubble. A shape dragged inside this panel must keep
      // the shape selected and must never commit the parent panel's position.
      if (event?.target !== group) return;
      onSelect(event);
      onDragEnd(event);
    });
  }
}

/**
 * Coalesce document rebuilds and keep them out of an active pointer gesture.
 * Replacing Konva nodes between pointerdown and pointerup can leave Firefox
 * dispatching the rest of the gesture to a node that no longer exists.
 */
export function createCanvasRenderGate(schedule, cancel, { rebuild, refreshUi }) {
  let pointerActive = false;
  let rebuildPending = false;
  let uiPending = false;
  let frame = null;

  function arm() {
    if (pointerActive || (!rebuildPending && !uiPending) || frame !== null) return;
    frame = schedule(() => {
      frame = null;
      if (pointerActive || (!rebuildPending && !uiPending)) return;
      const needsRebuild = rebuildPending;
      const needsUi = uiPending;
      rebuildPending = false;
      uiPending = false;
      if (needsRebuild) rebuild();
      else if (needsUi) refreshUi();
    });
  }

  return {
    beginPointer() {
      pointerActive = true;
    },
    endPointer() {
      pointerActive = false;
      arm();
    },
    requestRebuild() {
      rebuildPending = true;
      arm();
    },
    requestUi() {
      uiPending = true;
      arm();
    },
    destroy() {
      if (frame !== null) cancel(frame);
      frame = null;
      rebuildPending = false;
      uiPending = false;
      pointerActive = false;
    },
  };
}

/**
 * Drop a draft that is still in hand.
 *
 * A tool can change under an unreleased pointer — Escape, a letter shortcut —
 * and the release then belongs to whichever tool is current, which may well
 * return before reaching the code that settles the draft. What is left is a
 * Konva node still tracking the pointer that nothing can commit or destroy.
 * Callers assign the result back: it is always null.
 */
export function discardDraft(draft) {
  draft?.node?.destroy?.();
  return null;
}
