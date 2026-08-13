import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { activeLineSelection, useStore } from '../store'
import { DiffViewer } from './DiffViewer'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { useResizable } from '../lib/useResizable'
import { claimsKey, nextRowIndex } from '../lib/keys'
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
  onContextMenu,
  onStage,
  onUnstage,
  onDiscard,
  onResolve
}: {
  file: FileChange
  side: Side
  active: boolean
  multi: boolean
  onClick: (e: ReactMouseEvent) => void
  onContextMenu: (e: ReactMouseEvent) => void
  onStage: () => void
  onUnstage: () => void
  onDiscard: () => void
  onResolve: () => void
}) {
  return (
    <div
      className={'file-row' + (active ? ' selected' : '') + (multi ? ' multi' : '')}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
    >
      <span className={'st ' + file.status}>{statusLetter(file.status)}</span>
      <span className="path">{file.path}</span>
      <span className="row-actions" onClick={(e) => e.stopPropagation()}>
        {side === 'unstaged' ? (
          <>
            {file.status === 'conflicted' && (
              <button
                className="mini-btn"
                title="Resolve the conflict in VS Code's merge editor"
                onClick={onResolve}
              >
                Resolve
              </button>
            )}
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
  const [amend, setAmend] = useState(false)
  const [pushOnCommit, setPushOnCommit] = useState(false)
  // The draft lives in the store so it survives this component being unmounted
  // by a repo switch, a view switch, or a stash preview.
  const message = useStore((s) => (s.activeRepoPath ? (s.commitDrafts[s.activeRepoPath] ?? '') : ''))
  const setMessage = useStore((s) => s.setCommitDraft)
  const status = useStore((s) => s.status)
  const remotes = useStore((s) => s.remotes)
  const groups = useStore((s) => s.groups)
  const repos = useStore((s) => s.repos)
  const active = useStore((s) => s.activeRepoPath)
  const commit = useStore((s) => s.commit)
  const busy = useStore((s) => s.busy)

  // The active repo's group can define a feature id that is appended to every commit.
  const featureSuffix = useMemo(() => {
    const repo = repos.find((r) => r.path === active)
    if (!repo) return ''
    const id = groups.find((g) => g.repoIds.includes(repo.id))?.featureId?.trim()
    if (!id) return ''
    return id.startsWith('#') ? id : `#${id}`
  }, [groups, repos, active])

  const stagedCount = status?.staged.length ?? 0
  const canPush = remotes.length > 0
  const willPush = pushOnCommit && canPush
  const canCommit = message.trim().length > 0 && (stagedCount > 0 || amend) && !busy

  const onCommit = async (): Promise<void> => {
    const base = message.trim()
    const finalMessage =
      featureSuffix && !base.includes(featureSuffix) ? `${base} ${featureSuffix}` : base
    const ok = await commit(finalMessage, amend, willPush)
    // The store clears the draft itself on success; only the local flags reset here.
    if (ok) setAmend(false)
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
      {featureSuffix && (
        <div className="commit-suffix-hint" title="Automatically appended to your commit message">
          Appends <code>{featureSuffix}</code>
        </div>
      )}
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
  const resolveInMergeTool = useStore((s) => s.resolveInMergeTool)
  const openFile = useStore((s) => s.openFile)
  const active = useStore((s) => s.activeRepoPath)
  const { size: leftWidth, onResizeStart } = useResizable('wcLeftWidth', 460, 280, 1000)

  const unstaged = status?.unstaged ?? []
  const staged = status?.staged ?? []
  const unstagedPaths = unstaged.map((f) => f.path)
  const stagedPaths = staged.map((f) => f.path)

  const [selection, setSelection] = useState<{
    side: Side
    paths: string[]
    anchor: string
  } | null>(null)

  const [menu, setMenu] = useState<{
    x: number
    y: number
    path: string
    deleted: boolean
  } | null>(null)

  // Space stages the selected unstaged file(s) (or unstages the selected staged
  // file). Staging a single file auto-advances to the next one in the store.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== ' ' && e.code !== 'Space') return
      if (claimsKey(e.target) || claimsKey(document.activeElement)) return
      // An open dialog owns the keyboard; staging behind it would be invisible.
      if (document.querySelector('.modal')) return
      // We own Space in the working view — stop it scrolling the file list.
      e.preventDefault()
      // Ignore auto-repeat and overlapping runs so concurrent `git add`
      // invocations can't collide on the index lock.
      if (e.repeat || useStore.getState().busy) return
      // Lines picked in the diff pane win over the file list: Space stages
      // exactly what is highlighted there rather than the whole file.
      if (activeLineSelection(useStore.getState())) {
        useStore.getState().applyLineSelection()
        return
      }
      // Read the lists fresh rather than closing over them: a refresh landing
      // between renders would otherwise leave the captured paths stale.
      const st = useStore.getState().status
      const unstagedNow = st?.unstaged.map((f) => f.path) ?? []
      const stagedNow = st?.staged.map((f) => f.path) ?? []
      if (selection && selection.side === 'unstaged') {
        const t = selection.paths.filter((p) => unstagedNow.includes(p))
        if (t.length) {
          stage(t)
          setSelection(null)
        }
        return
      }
      if (selection && selection.side === 'staged') {
        const t = selection.paths.filter((p) => stagedNow.includes(p))
        if (t.length) {
          unstage(t)
          setSelection(null)
        }
        return
      }
      if (sel?.kind === 'working') {
        if (sel.staged) unstage([sel.path])
        else stage([sel.path])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, sel, stage, unstage])

  // Up/Down walk the staged and unstaged panes as one continuous sequence, so
  // Down off the last staged file lands on the first unstaged one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      if (claimsKey(e.target) || claimsKey(document.activeElement)) return
      if (document.querySelector('.modal')) return
      const st = useStore.getState().status
      const rows: { side: Side; file: FileChange }[] = [
        ...(st?.staged ?? []).map((file) => ({ side: 'staged' as Side, file })),
        ...(st?.unstaged ?? []).map((file) => ({ side: 'unstaged' as Side, file }))
      ]
      if (!rows.length) return
      // Ours now — otherwise the list also scrolls natively, fighting scrollIntoView.
      e.preventDefault()
      const down = e.key === 'ArrowDown'
      const cur = useStore.getState().selectedFile
      const at =
        cur?.kind === 'working'
          ? rows.findIndex((r) => r.file.path === cur.path && r.file.staged === cur.staged)
          : -1
      const row = rows[nextRowIndex(rows.length, at, down)]
      // Collapse any multi-selection down to the row we moved onto, so Space
      // and shift-click keep operating on what is actually highlighted.
      setSelection({ side: row.side, paths: [row.file.path], anchor: row.file.path })
      select(row.file)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [select])

  // Keep the keyboard-selected row visible; a no-op when it already is.
  useEffect(() => {
    document.querySelector('.file-row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

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

  const openMenu = (e: ReactMouseEvent, file: FileChange): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, path: file.path, deleted: file.status === 'deleted' })
  }

  const fileMenu = (path: string, deleted: boolean): MenuItem[] => [
    {
      label: 'Open',
      disabled: deleted,
      onClick: () => openFile(path)
    }
  ]

  return (
    <div className="working">
      <div className="wc-left" style={{ width: leftWidth, flexShrink: 0 }}>
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
                onContextMenu={(e) => openMenu(e, f)}
                onStage={() => doStage(f.path)}
                onUnstage={() => doUnstage(f.path)}
                onDiscard={() => doDiscard(f.path)}
                onResolve={() => resolveInMergeTool(f.path)}
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
                onContextMenu={(e) => openMenu(e, f)}
                onStage={() => doStage(f.path)}
                onUnstage={() => doUnstage(f.path)}
                onDiscard={() => doDiscard(f.path)}
                onResolve={() => resolveInMergeTool(f.path)}
              />
            ))}
            {!unstaged.length && <div className="side-empty">No unstaged changes</div>}
          </div>
        </div>

        {/* Keyed on the repo so "Amend"/"Push after commit" reset when it changes —
            carrying an amend flag across repos would be dangerous. The message
            itself is keyed by repo in the store, so it survives the remount. */}
        <CommitBox key={active ?? 'none'} />
      </div>

      <div
        className="resizer"
        onMouseDown={onResizeStart}
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
      />
      <DiffViewer />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={fileMenu(menu.path, menu.deleted)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
