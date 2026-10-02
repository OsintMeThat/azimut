/**
 * A shortcut as this machine spells it.
 *
 * The app listens for Ctrl or ⌘ alike (`ctrlKey || metaKey`), but the labels said
 * Ctrl everywhere, and on the macOS binary that is the key that does something else.
 */
export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/** `shortcut('Undo (Ctrl+Z)')` reads `Undo (⌘Z)` on a Mac and is left alone elsewhere. */
export function shortcut(label, mac = IS_MAC) {
  if (!mac) return label;
  return label.replace(/\bCtrl\+/g, '⌘').replace(/\bShift\+/g, '⇧').replace(/\bCtrl\b/g, '⌘');
}
