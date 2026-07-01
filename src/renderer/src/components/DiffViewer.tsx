import { useStore } from '../store'
import type { DiffLineType } from '@shared/types'
import { buildHunkPatch } from '../lib/patch'

function marker(type: DiffLineType): string {
  if (type === 'add') return '+'
  if (type === 'del') return '-'
  return ''
}

export function DiffViewer() {
  const diff = useStore((s) => s.diff)
  const loading = useStore((s) => s.diffLoading)
  const sel = useStore((s) => s.selectedFile)
  const stageHunk = useStore((s) => s.stageHunk)
  const unstageHunk = useStore((s) => s.unstageHunk)
  const discardHunk = useStore((s) => s.discardHunk)

  if (!sel) {
    return (
      <div className="diff">
        <div className="placeholder">Select a file to view changes</div>
      </div>
    )
  }

  // Per-hunk staging only applies to tracked working-copy changes.
  const hunkActions = sel.kind === 'working' && !sel.untracked

  return (
    <div className="diff">
      <div className="diff-header" title={diff?.path ?? sel.path}>
        {diff?.path ?? sel.path}
      </div>
      <div className="diff-scroll">
        {loading ? (
          <div className="placeholder">Loading diff…</div>
        ) : !diff || diff.hunks.length === 0 ? (
          <div className="placeholder">
            {diff?.binary ? 'Binary file — no text diff' : 'No changes to display'}
          </div>
        ) : (
          diff.hunks.map((h, hi) => (
            <div key={hi} className="diff-hunk">
              <div className="diff-line diff-hunk-head">
                <span className="gutter" />
                <span className="gutter" />
                <span className="content">{h.header}</span>
                {hunkActions && (
                  <span className="hunk-actions">
                    {sel.staged ? (
                      <button
                        className="mini-btn"
                        title="Unstage this hunk"
                        onClick={() => unstageHunk(buildHunkPatch(diff.path, h))}
                      >
                        Unstage Hunk
                      </button>
                    ) : (
                      <>
                        <button
                          className="mini-btn"
                          title="Stage this hunk"
                          onClick={() => stageHunk(buildHunkPatch(diff.path, h))}
                        >
                          Stage Hunk
                        </button>
                        <button
                          className="mini-btn danger"
                          title="Discard this hunk"
                          onClick={() => {
                            if (confirm('Discard this hunk? This cannot be undone.'))
                              discardHunk(buildHunkPatch(diff.path, h))
                          }}
                        >
                          Discard Hunk
                        </button>
                      </>
                    )}
                  </span>
                )}
              </div>
              {h.lines.map((l, li) => (
                <div
                  key={li}
                  className={
                    'diff-line' +
                    (l.type === 'add'
                      ? ' add'
                      : l.type === 'del'
                        ? ' del'
                        : l.type === 'meta'
                          ? ' meta'
                          : '')
                  }
                >
                  <span className="gutter">{l.oldNumber ?? ''}</span>
                  <span className="gutter">{l.newNumber ?? ''}</span>
                  <span className="content">{l.text}</span>
                  <span className="sign">{marker(l.type)}</span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
