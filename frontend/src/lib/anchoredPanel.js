/** Keep a picker in the viewport, above its field when there is more room there.
 * The popover top layer escapes scrolling and transformed tool containers. */
export function anchoredPanel(node, { anchor, width = 560 }) {
  function position() {
    const target = anchor();
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const margin = 12;
    const gap = 6;
    const availableBelow = window.innerHeight - rect.bottom - margin - gap;
    const availableAbove = rect.top - margin - gap;
    const above = availableBelow < 320 && availableAbove > availableBelow;
    const available = Math.max(80, above ? availableAbove : availableBelow);
    const size = Math.min(width, window.innerWidth - margin * 2);
    node.style.width = `${size}px`;
    node.style.maxHeight = `${available}px`;
    node.style.left = `${Math.max(margin, Math.min(rect.right - size, window.innerWidth - size - margin))}px`;
    node.style.top = `${above ? Math.max(margin, rect.top - gap - node.offsetHeight) : Math.max(margin, rect.bottom + gap)}px`;
  }
  node.showPopover?.();
  position();
  const observer = new ResizeObserver(position);
  observer.observe(node);
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  return { destroy() {
    observer.disconnect();
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    node.hidePopover?.();
  } };
}
