import { useStore } from '../store'
import type { DiffLineType } from '@shared/types'

function sign(type: DiffLineType): string {
  if (type === 'add') return '+'
  if (type === 'del') return '-'
  if (type === 'meta') return ''
  return ' '
}

export function DiffViewer() {
  const diff = useStore((s) => s.diff)
  const loading = useStore((s) => s.diffLoading)
  const sel = useStore((s) => s.selectedFile)

  if (!sel) {
    return (
      <div className="diff">
        <div className="placeholder">Select a file to view changes</div>
      </div>
    )
  }

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
            <div key={hi}>
              <div className="diff-line diff-hunk-head">
                <span className="gutter" />
                <span className="gutter" />
                <span className="content">{h.header}</span>
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
                  <span className="content">
                    {sign(l.type)}
                    {l.text}
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
