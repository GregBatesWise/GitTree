import type { DiffHunk, DiffLine } from '@shared/types'

/**
 * Which way the resulting patch will be handed to `git apply`. 'forward' is
 * staging (apply the change); 'reverse' is unstaging or discarding, where the
 * patch is applied with `--reverse`. The distinction matters for partial
 * selections because it decides which side of the diff the patch has to match.
 */
export type PatchDirection = 'forward' | 'reverse'

function lineToPatch(l: DiffLine): string {
  switch (l.type) {
    case 'add':
      return '+' + l.text
    case 'del':
      return '-' + l.text
    case 'meta':
      return '\\ ' + l.text
    default:
      return ' ' + l.text
  }
}

/**
 * Builds a single-hunk unified diff for `git apply`. Reconstructs the minimal
 * file header from the path (sufficient for tracked, modified files) followed
 * by the hunk header and its lines. `git apply --recount` fixes the counts.
 */
export function buildHunkPatch(path: string, hunk: DiffHunk): string {
  const head = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`
  const body = [hunk.header, ...hunk.lines.map(lineToPatch)].join('\n')
  return head + body + '\n'
}

/**
 * Builds a patch containing only the selected lines of a hunk, with everything
 * else rewritten so the patch still matches the file it is applied to. `selected`
 * holds indices into `hunk.lines`; only add/del lines can meaningfully be in it.
 *
 * A partial patch must describe the *whole* hunk region, so unpicked lines have
 * to be reinterpreted rather than simply omitted:
 *
 * - forward (staging): an unpicked '+' never reaches the index, so it is dropped;
 *   an unpicked '-' must stay in the index, so it becomes context.
 * - reverse (unstaging / discarding): the patch is matched against the *new*
 *   side, where an unpicked '+' is already present and becomes context, while an
 *   unpicked '-' is absent and is dropped.
 *
 * `git apply --recount` fixes up the hunk header's line counts afterwards.
 */
export function buildLinePatch(
  path: string,
  hunk: DiffHunk,
  selected: ReadonlySet<number>,
  direction: PatchDirection
): string {
  const out: string[] = []
  let keptPrevious = false
  hunk.lines.forEach((l, i) => {
    // '\ No newline at end of file' annotates the line directly above it, so it
    // only makes sense to carry over when that line survived into the patch.
    if (l.type === 'meta') {
      if (keptPrevious) out.push(lineToPatch(l))
      return
    }
    if (l.type === 'context' || selected.has(i)) {
      out.push(lineToPatch(l))
      keptPrevious = true
      return
    }
    const keepAsContext = direction === 'forward' ? l.type === 'del' : l.type === 'add'
    if (keepAsContext) out.push(' ' + l.text)
    keptPrevious = keepAsContext
  })
  const head = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`
  return head + [hunk.header, ...out].join('\n') + '\n'
}
