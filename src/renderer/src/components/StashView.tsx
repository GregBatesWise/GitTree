import { useStore } from '../store'
import { DiffViewer } from './DiffViewer'
import { useResizable } from '../lib/useResizable'
import type { FileChange } from '@shared/types'

function statusLetter(status: FileChange['status']): string {
  switch (status) {
    case 'modified':
      return 'M'
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'copied':
      return 'C'
    case 'untracked':
      return '?'
    case 'conflicted':
      return '!'
    default:
      return '•'
  }
}

export function StashView() {
  const stash = useStore((s) => s.selectedStash)
  const detail = useStore((s) => s.stashDetail)
  const selectedFile = useStore((s) => s.selectedFile)
  const selectStashFile = useStore((s) => s.selectStashFile)
  const stashApply = useStore((s) => s.stashApply)
  const stashDrop = useStore((s) => s.stashDrop)
  const clearStash = useStore((s) => s.clearStash)
  const { size: filesWidth, onResizeStart } = useResizable('stashFilesWidth', 380, 240, 900)

  if (!stash) return null

  return (
    <div className="working">
      <div className="wc-left" style={{ width: filesWidth, flexShrink: 0 }}>
        <div className="wc-pane">
          <div className="wc-pane-head">
            <span className="stash-title" title={stash.message}>
              ⚑ {stash.message}
            </span>
            <div className="group-btns">
              <button
                className="mini-btn"
                title="Apply these changes and keep the stash"
                onClick={() => stashApply(stash.ref, false)}
              >
                Apply
              </button>
              <button
                className="mini-btn"
                title="Apply these changes and drop the stash"
                onClick={() => stashApply(stash.ref, true)}
              >
                Pop
              </button>
              <button
                className="mini-btn danger"
                title="Drop this stash"
                onClick={() => {
                  if (confirm(`Drop ${stash.ref}?`)) stashDrop(stash.ref)
                }}
              >
                Drop
              </button>
              <button className="mini-btn" title="Close preview" onClick={() => clearStash()}>
                ✕
              </button>
            </div>
          </div>
          <div className="file-list">
            {detail?.files.map((f) => {
              const active = selectedFile?.kind === 'stash' && selectedFile.path === f.path
              return (
                <div
                  key={f.path}
                  className={'file-row' + (active ? ' selected' : '')}
                  onClick={() => selectStashFile(f.path)}
                  title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
                >
                  <span className={'st ' + f.status}>{statusLetter(f.status)}</span>
                  <span className="path">{f.path}</span>
                </div>
              )
            })}
            {detail && !detail.files.length && (
              <div className="side-empty">No changes in this stash</div>
            )}
            {!detail && <div className="side-empty">Loading…</div>}
          </div>
        </div>
      </div>
      <div
        className="resizer"
        onMouseDown={onResizeStart}
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
      />
      <DiffViewer />
    </div>
  )
}
