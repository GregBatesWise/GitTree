import type { DiffHunk, DiffLine } from '@shared/types'

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
