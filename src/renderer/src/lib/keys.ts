const TEXT_ENTRY_TAGS = new Set(['input', 'textarea', 'select', 'button'])

/**
 * True when a bare keystroke (Space, arrows) belongs to the given element rather
 * than to a working-copy list shortcut — a textarea owns Space and Up/Down for
 * typing and caret movement, a <select> owns the arrows, and so on.
 *
 * Call it with both the event target and document.activeElement: a click on a
 * non-focusable file row — or dismissing a native confirm() — leaves focus on
 * <body> while the user still believes they are typing in the commit box, at
 * which point Space would silently stage files instead of typing a space.
 */
export function claimsKey(node: EventTarget | null): boolean {
  if (!(node instanceof Element)) return false
  if (TEXT_ENTRY_TAGS.has(node.tagName.toLowerCase())) return true
  if (node instanceof HTMLElement && node.isContentEditable) return true
  return !!node.closest('.commit-box, .modal, button, [contenteditable="true"]')
}

/**
 * Index to move to when walking a list with Up/Down. `at` is -1 when nothing is
 * selected, in which case Down enters at the top and Up at the bottom. Clamps at
 * both ends rather than wrapping, so holding a key cannot cycle forever.
 * Returns -1 for an empty list.
 */
export function nextRowIndex(count: number, at: number, down: boolean): number {
  if (count <= 0) return -1
  if (at < 0 || at >= count) return down ? 0 : count - 1
  return Math.min(count - 1, Math.max(0, at + (down ? 1 : -1)))
}
