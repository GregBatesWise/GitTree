import { useState } from 'react'
import { useStore } from '../store'
import { DiffViewer } from './DiffViewer'
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

function FileRow({ file, side }: { file: FileChange; side: 'staged' | 'unstaged' }) {
  const select = useStore((s) => s.selectWorkingFile)
  const sel = useStore((s) => s.selectedFile)
  const stage = useStore((s) => s.stageFiles)
  const unstage = useStore((s) => s.unstageFiles)
  const discard = useStore((s) => s.discardFiles)

  const active =
    sel?.kind === 'working' && sel.path === file.path && sel.staged === file.staged

  return (
    <div
      className={'file-row' + (active ? ' selected' : '')}
      onClick={() => select(file)}
      title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
    >
      <span className={'st ' + file.status}>{statusLetter(file.status)}</span>
      <span className="path">{file.path}</span>
      <span className="row-actions" onClick={(e) => e.stopPropagation()}>
        {side === 'unstaged' ? (
          <>
            <button className="mini-btn" onClick={() => stage([file.path])}>
              Stage
            </button>
            <button
              className="mini-btn danger"
              title="Discard changes"
              onClick={() => {
                if (confirm(`Discard changes to "${file.path}"? This cannot be undone.`)) {
                  discard([file.path])
                }
              }}
            >
              ✕
            </button>
          </>
        ) : (
          <button className="mini-btn" onClick={() => unstage([file.path])}>
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
  const stageAll = useStore((s) => s.stageAll)
  const unstageAll = useStore((s) => s.unstageAll)

  const unstaged = status?.unstaged ?? []
  const staged = status?.staged ?? []

  return (
    <div className="working">
      <div className="wc-left">
        <div className="wc-pane">
          <div className="wc-pane-head">
            <span>Staged ({staged.length})</span>
            <div className="group-btns">
              <button className="mini-btn" disabled={!staged.length} onClick={() => unstageAll()}>
                Unstage all
              </button>
            </div>
          </div>
          <div className="file-list">
            {staged.map((f) => (
              <FileRow key={'s' + f.path} file={f} side="staged" />
            ))}
            {!staged.length && <div className="side-empty">No staged changes</div>}
          </div>
        </div>

        <div className="wc-pane">
          <div className="wc-pane-head">
            <span>Unstaged ({unstaged.length})</span>
            <div className="group-btns">
              <button className="mini-btn" disabled={!unstaged.length} onClick={() => stageAll()}>
                Stage all
              </button>
            </div>
          </div>
          <div className="file-list">
            {unstaged.map((f) => (
              <FileRow key={'u' + f.path} file={f} side="unstaged" />
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
