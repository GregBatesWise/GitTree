import { useEffect, type MouseEvent as ReactMouseEvent } from 'react'
import { activeLineSelection, useStore } from '../store'
import type { DiffLine, DiffLineType } from '@shared/types'
import { buildHunkPatch } from '../lib/patch'

function marker(type: DiffLineType): string {
  if (type === 'add') return '+'
  if (type === 'del') return '-'
  return ''
}

/** Only added and removed lines can be picked; context lines carry no change. */
function isPickable(l: DiffLine): boolean {
  return l.type === 'add' || l.type === 'del'
}

export function DiffViewer() {
  const diff = useStore((s) => s.diff)
  const loading = useStore((s) => s.diffLoading)
  const sel = useStore((s) => s.selectedFile)
  const stageHunk = useStore((s) => s.stageHunk)
  const unstageHunk = useStore((s) => s.unstageHunk)
  const discardHunk = useStore((s) => s.discardHunk)
  const lineSel = useStore(activeLineSelection)
  const setLineSel = useStore((s) => s.setLineSelection)
  const applyLines = useStore((s) => s.applyLineSelection)
  const discardLines = useStore((s) => s.discardLineSelection)

  // Escape is the way out of a line selection, mirroring the file list.
  useEffect(() => {
    if (!lineSel) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setLineSel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lineSel, setLineSel])

  if (!sel) {
    return (
      <div className="diff">
        <div className="placeholder">Select a file to view changes</div>
      </div>
    )
  }

  // Per-hunk and per-line staging only apply to tracked working-copy changes.
  const hunkActions = sel.kind === 'working' && !sel.untracked
  const picked = (hunkIndex: number, lineIndex: number): boolean =>
    !!lineSel && lineSel.hunkIndex === hunkIndex && lineSel.lines.includes(lineIndex)

  const lineClick = (hunkIndex: number, lineIndex: number, e: ReactMouseEvent): void => {
    if (!hunkActions || !diff) return
    // A drag that selected text is a copy gesture, not a pick.
    if (!window.getSelection()?.isCollapsed) return
    const lines = diff.hunks[hunkIndex].lines
    if (!isPickable(lines[lineIndex])) {
      setLineSel(null)
      return
    }
    const base = { path: sel.path, staged: sel.staged, hunkIndex }
    const sameHunk = lineSel && lineSel.hunkIndex === hunkIndex
    if (e.shiftKey && sameHunk) {
      const [lo, hi] =
        lineSel.anchor < lineIndex ? [lineSel.anchor, lineIndex] : [lineIndex, lineSel.anchor]
      const range: number[] = []
      for (let i = lo; i <= hi; i++) if (isPickable(lines[i])) range.push(i)
      setLineSel({ ...base, lines: range, anchor: lineSel.anchor })
      return
    }
    if ((e.ctrlKey || e.metaKey) && sameHunk) {
      const next = lineSel.lines.includes(lineIndex)
        ? lineSel.lines.filter((i) => i !== lineIndex)
        : [...lineSel.lines, lineIndex].sort((a, b) => a - b)
      setLineSel(next.length ? { ...base, lines: next, anchor: lineIndex } : null)
      return
    }
    // Clicking the only picked line again is the quickest way to clear it.
    const only = sameHunk && lineSel.lines.length === 1 && lineSel.lines[0] === lineIndex
    setLineSel(only ? null : { ...base, lines: [lineIndex], anchor: lineIndex })
  }

  const count = lineSel?.lines.length ?? 0
  const lineLabel = `${count} Line${count === 1 ? '' : 's'}`

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
          <div className="diff-body">
            {diff.hunks.map((h, hi) => (
              <div key={hi} className="diff-hunk">
                <div className="diff-line diff-hunk-head">
                  <span className="gutter" />
                  <span className="gutter" />
                  <span className="content">{h.header}</span>
                  {hunkActions && (
                    <span className="hunk-actions">
                      {lineSel?.hunkIndex === hi ? (
                        <>
                          <button
                            className="mini-btn"
                            title={
                              sel.staged
                                ? 'Unstage only the selected lines (Space)'
                                : 'Stage only the selected lines (Space)'
                            }
                            onClick={() => applyLines()}
                          >
                            {sel.staged ? 'Unstage' : 'Stage'} {lineLabel}
                          </button>
                          {!sel.staged && (
                            <button
                              className="mini-btn danger"
                              title="Discard only the selected lines"
                              onClick={() => {
                                if (confirm(`Discard ${count} selected line(s)? This cannot be undone.`))
                                  discardLines()
                              }}
                            >
                              Discard {lineLabel}
                            </button>
                          )}
                        </>
                      ) : sel.staged ? (
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
                            : '') +
                      (hunkActions && isPickable(l) ? ' pickable' : '') +
                      (picked(hi, li) ? ' picked' : '')
                    }
                    onClick={(e) => lineClick(hi, li, e)}
                    title={
                      hunkActions && isPickable(l)
                        ? 'Click to select this line — shift-click for a range, Ctrl+click to add'
                        : undefined
                    }
                  >
                    <span className="gutter">{l.oldNumber ?? ''}</span>
                    <span className="gutter">{l.newNumber ?? ''}</span>
                    <span className="content">{l.text}</span>
                    <span className="sign">{marker(l.type)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
