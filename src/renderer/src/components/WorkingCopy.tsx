import { useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useStore } from '../store'
import { DiffViewer } from './DiffViewer'
import type { FileChange } from '@shared/types'

type Side = 'staged' | 'unstaged'

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

function FileRow({
  file,
  side,
  active,
  multi,
  onClick,
  onStage,
  onUnstage,
  onDiscard
}: {
  file: FileChange
  side: Side
  active: boolean
  multi: boolean
  onClick: (e: ReactMouseEvent) => void
  onStage: () => void
  onUnstage: () => void
  onDiscard: () => void
}) {
  return (
    <div
      className={'file-row' + (active ? ' selected' : '') + (multi ? ' multi' : '')}
      onClick={onClick}
      title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
    >
      <span className={'st ' + file.status}>{statusLetter(file.status)}</span>
      <span className="path">{file.path}</span>
      <span className="row-actions" onClick={(e) => e.stopPropagation()}>
        {side === 'unstaged' ? (
          <>
            <button className="mini-btn" onClick={onStage}>
              Stage
            </button>
            <button className="mini-btn danger" title="Discard changes" onClick={onDiscard}>
              ✕
            </button>
          </>
        ) : (
          <button className="mini-btn" onClick={onUnstage}>
            Unstage
          </button>
        )}
      </span>
    </div>
  )
}

function CommitBox() {
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [pushOnCommit, setPushOnCommit] = useState(false)
  const status = useStore((s) => s.status)
  const remotes = useStore((s) => s.remotes)
  const commit = useStore((s) => s.commit)
  const busy = useStore((s) => s.busy)

  const stagedCount = status?.staged.length ?? 0
  const canPush = remotes.length > 0
  const willPush = pushOnCommit && canPush
  const canCommit = message.trim().length > 0 && (stagedCount > 0 || amend) && !busy

  const onCommit = async (): Promise<void> => {
    const ok = await commit(message.trim(), amend, willPush)
    if (ok) {
      setMessage('')
      setAmend(false)
    }
  }

  return (
    <div className="commit-box">
      <textarea
        placeholder="Commit message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canCommit) onCommit()
        }}
      />
      <div className="commit-actions">
        <div className="commit-opts">
          <label className="amend">
            <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
            Amend last commit
          </label>
          <label
            className="amend"
            title={canPush ? 'Push to the upstream remote after committing' : 'No remote configured'}
          >
            <input
              type="checkbox"
              checked={willPush}
              disabled={!canPush}
              onChange={(e) => setPushOnCommit(e.target.checked)}
            />
            Push after commit
          </label>
        </div>
        <button className="btn btn-primary" disabled={!canCommit} onClick={onCommit}>
          {willPush ? 'Commit & Push' : 'Commit'}
          {stagedCount ? ` (${stagedCount})` : ''}
        </button>
      </div>
    </div>
  )
}

export function WorkingCopy() {
  const status = useStore((s) => s.status)
  const sel = useStore((s) => s.selectedFile)
  const select = useStore((s) => s.selectWorkingFile)
  const stage = useStore((s) => s.stageFiles)
  const unstage = useStore((s) => s.unstageFiles)
  const discard = useStore((s) => s.discardFiles)
  const stageAll = useStore((s) => s.stageAll)
  const unstageAll = useStore((s) => s.unstageAll)

  const unstaged = status?.unstaged ?? []
  const staged = status?.staged ?? []
  const unstagedPaths = unstaged.map((f) => f.path)
  const stagedPaths = staged.map((f) => f.path)

  const [selection, setSelection] = useState<{
    side: Side
    paths: string[]
    anchor: string
  } | null>(null)

  const isMulti = (side: Side, path: string): boolean =>
    !!selection && selection.side === side && selection.paths.includes(path)

  const selCount = (side: Side): number =>
    selection && selection.side === side ? selection.paths.length : 0

  const rowClick = (side: Side, file: FileChange, e: ReactMouseEvent): void => {
    const list = side === 'staged' ? stagedPaths : unstagedPaths
    const path = file.path
    if (e.shiftKey && selection && selection.side === side) {
      const a = list.indexOf(selection.anchor)
      const b = list.indexOf(path)
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setSelection({ side, paths: list.slice(lo, hi + 1), anchor: selection.anchor })
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (selection && selection.side === side) {
        const has = selection.paths.includes(path)
        const paths = has
          ? selection.paths.filter((p) => p !== path)
          : [...selection.paths, path]
        setSelection(paths.length ? { side, paths, anchor: path } : null)
      } else {
        setSelection({ side, paths: [path], anchor: path })
      }
    } else {
      setSelection({ side, paths: [path], anchor: path })
    }
    select(file)
  }

  // Files to act on: the whole selection if the clicked row is part of it,
  // otherwise just the clicked row. Stale paths are filtered out.
  const targets = (side: Side, path: string): string[] => {
    const list = side === 'staged' ? stagedPaths : unstagedPaths
    if (selection && selection.side === side && selection.paths.includes(path)) {
      return selection.paths.filter((p) => list.includes(p))
    }
    return [path]
  }

  const doStage = (path: string): void => {
    stage(targets('unstaged', path))
    setSelection(null)
  }
  const doUnstage = (path: string): void => {
    unstage(targets('staged', path))
    setSelection(null)
  }
  const doDiscard = (path: string): void => {
    const t = targets('unstaged', path)
    const label = t.length > 1 ? `${t.length} files` : `"${t[0]}"`
    if (confirm(`Discard changes to ${label}? This cannot be undone.`)) {
      discard(t)
      setSelection(null)
    }
  }

  const stageSelected = (): void => {
    if (!selection || selection.side !== 'unstaged') return
    stage(selection.paths.filter((p) => unstagedPaths.includes(p)))
    setSelection(null)
  }
  const unstageSelected = (): void => {
    if (!selection || selection.side !== 'staged') return
    unstage(selection.paths.filter((p) => stagedPaths.includes(p)))
    setSelection(null)
  }
  const discardSelected = (): void => {
    if (!selection || selection.side !== 'unstaged') return
    const t = selection.paths.filter((p) => unstagedPaths.includes(p))
    if (confirm(`Discard changes to ${t.length} files? This cannot be undone.`)) {
      discard(t)
      setSelection(null)
    }
  }

  return (
    <div className="working">
      <div className="wc-left">
        <div className="wc-pane">
          <div className="wc-pane-head">
            <span>Staged ({staged.length})</span>
            <div className="group-btns">
              {selCount('staged') > 1 && (
                <button className="mini-btn" onClick={unstageSelected}>
                  Unstage ({selCount('staged')})
                </button>
              )}
              <button className="mini-btn" disabled={!staged.length} onClick={() => unstageAll()}>
                Unstage all
              </button>
            </div>
          </div>
          <div className="file-list">
            {staged.map((f) => (
              <FileRow
                key={'s' + f.path}
                file={f}
                side="staged"
                active={sel?.kind === 'working' && sel.path === f.path && sel.staged === f.staged}
                multi={isMulti('staged', f.path)}
                onClick={(e) => rowClick('staged', f, e)}
                onStage={() => doStage(f.path)}
                onUnstage={() => doUnstage(f.path)}
                onDiscard={() => doDiscard(f.path)}
              />
            ))}
            {!staged.length && <div className="side-empty">No staged changes</div>}
          </div>
        </div>

        <div className="wc-pane">
          <div className="wc-pane-head">
            <span>Unstaged ({unstaged.length})</span>
            <div className="group-btns">
              {selCount('unstaged') > 1 && (
                <>
                  <button className="mini-btn" onClick={stageSelected}>
                    Stage ({selCount('unstaged')})
                  </button>
                  <button className="mini-btn danger" onClick={discardSelected}>
                    Discard ({selCount('unstaged')})
                  </button>
                </>
              )}
              <button className="mini-btn" disabled={!unstaged.length} onClick={() => stageAll()}>
                Stage all
              </button>
            </div>
          </div>
          <div className="file-list">
            {unstaged.map((f) => (
              <FileRow
                key={'u' + f.path}
                file={f}
                side="unstaged"
                active={sel?.kind === 'working' && sel.path === f.path && sel.staged === f.staged}
                multi={isMulti('unstaged', f.path)}
                onClick={(e) => rowClick('unstaged', f, e)}
                onStage={() => doStage(f.path)}
                onUnstage={() => doUnstage(f.path)}
                onDiscard={() => doDiscard(f.path)}
              />
            ))}
            {!unstaged.length && <div className="side-empty">No unstaged changes</div>}
          </div>
        </div>

        <CommitBox />
      </div>

      <DiffViewer />
    </div>
  )
}
