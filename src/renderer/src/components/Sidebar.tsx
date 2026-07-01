import { useState } from 'react'
import { useStore } from '../store'
import { Modal } from './Dialog'
import { ContextMenu, type MenuItem } from './ContextMenu'
import type { BranchInfo, SubmoduleInfo } from '@shared/types'

function subStateLabel(state: SubmoduleInfo['state']): string {
  switch (state) {
    case 'uninitialized':
      return 'uninit'
    case 'modified':
      return 'modified'
    case 'conflict':
      return 'conflict'
    default:
      return ''
  }
}

function AddRemoteDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('origin')
  const [url, setUrl] = useState('')
  const addRemote = useStore((s) => s.addRemote)
  const busy = useStore((s) => s.busy)

  const submit = async (): Promise<void> => {
    if (!name.trim() || !url.trim()) return
    const ok = await addRemote(name.trim(), url.trim())
    if (ok) onClose()
  }

  return (
    <Modal
      title="Add Remote"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!name.trim() || !url.trim() || !!busy}
            onClick={submit}
          >
            Add Remote
          </button>
        </>
      }
    >
      <label>
        Name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        URL
        <input
          type="text"
          autoFocus
          value={url}
          placeholder="https://github.com/user/repo.git"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
      </label>
    </Modal>
  )
}

function RenameBranchDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const [newName, setNewName] = useState(name)
  const rename = useStore((s) => s.renameBranch)
  const busy = useStore((s) => s.busy)

  const submit = async (): Promise<void> => {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === name) {
      onClose()
      return
    }
    const ok = await rename(name, trimmed)
    if (ok) onClose()
  }

  return (
    <Modal
      title={`Rename "${name}"`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!newName.trim() || newName.trim() === name || !!busy}
            onClick={submit}
          >
            Rename
          </button>
        </>
      }
    >
      <label>
        New branch name
        <input
          type="text"
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
      </label>
    </Modal>
  )
}

export function Sidebar({ width }: { width?: number }) {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const status = useStore((s) => s.status)
  const branches = useStore((s) => s.branches)
  const stashes = useStore((s) => s.stashes)
  const remotes = useStore((s) => s.remotes)
  const tags = useStore((s) => s.tags)
  const submodules = useStore((s) => s.submodules)
  const active = useStore((s) => s.activeRepoPath)
  const checkout = useStore((s) => s.checkoutBranch)
  const merge = useStore((s) => s.mergeBranch)
  const deleteBranch = useStore((s) => s.deleteBranch)
  const stashApply = useStore((s) => s.stashApply)
  const stashDrop = useStore((s) => s.stashDrop)
  const deleteTag = useStore((s) => s.deleteTag)
  const pushTag = useStore((s) => s.pushTag)
  const updateSubmodules = useStore((s) => s.updateSubmodules)
  const updateSubmodule = useStore((s) => s.updateSubmodule)

  const [remoteDlg, setRemoteDlg] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    remotes: true,
    tags: true,
    submodules: true,
    stashes: true
  })
  const toggle = (k: string): void => setCollapsed((c) => ({ ...c, [k]: !c[k] }))
  const [branchMenu, setBranchMenu] = useState<{
    x: number
    y: number
    branch: BranchInfo
  } | null>(null)
  const [renameTarget, setRenameTarget] = useState<string | null>(null)

  if (!active) return <div className="sidebar" style={{ width }} />

  const locals = branches.filter((b) => !b.isRemote)
  const remoteBranches = branches.filter((b) => b.isRemote)
  const changes = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0)

  const buildBranchMenu = (b: BranchInfo): MenuItem[] => {
    const items: MenuItem[] = []
    if (!b.current) items.push({ label: 'Checkout', onClick: () => checkout(b.name) })
    items.push({ label: 'Rename\u2026', onClick: () => setRenameTarget(b.name) })
    if (!b.current) {
      items.push({ label: 'Merge into Current Branch', onClick: () => merge(b.name) })
      items.push({ separator: true })
      items.push({
        label: 'Delete Branch',
        danger: true,
        onClick: () => {
          if (confirm(`Delete branch "${b.name}"?`)) deleteBranch(b.name, false)
        }
      })
    }
    return items
  }

  return (
    <div className="sidebar" style={{ width }}>
      <div className="side-section">
        <div className="side-head">Workspace</div>
        <div
          className={'side-item' + (view === 'working' ? ' active' : '')}
          onClick={() => setView('working')}
        >
          <span className="ico">◧</span>
          <span className="label">File Status</span>
          {changes > 0 && <span className="track">{changes}</span>}
        </div>
        <div
          className={'side-item' + (view === 'history' ? ' active' : '')}
          onClick={() => setView('history')}
        >
          <span className="ico">☰</span>
          <span className="label">History</span>
        </div>
      </div>

      <div className="side-section">
        <div className="side-head">
          <span className="side-title" onClick={() => toggle('branches')}>
            <span className="chevron">{collapsed.branches ? '▸' : '▾'}</span>
            Branches
          </span>
        </div>
        {!collapsed.branches && (
          <>
            {locals.map((b) => (
              <div
                key={b.name}
                className={'side-item' + (b.current ? ' current' : '')}
                title={b.current ? b.name + ' (current)' : 'Double-click to check out ' + b.name}
                onDoubleClick={() => {
                  if (!b.current) checkout(b.name)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setBranchMenu({ x: e.clientX, y: e.clientY, branch: b })
                }}
              >
                <span className="ico">{b.current ? '●' : '○'}</span>
                <span className="label">{b.name}</span>
                {b.ahead || b.behind ? (
                  <span className="track">
                    {b.ahead ? `↑${b.ahead}` : ''}
                    {b.behind ? `↓${b.behind}` : ''}
                  </span>
                ) : null}
                {!b.current && (
                  <span className="hover-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="mini-btn" onClick={() => merge(b.name)}>
                      Merge
                    </button>
                    <button
                      className="mini-btn danger"
                      title="Delete branch"
                      onClick={() => {
                        if (confirm(`Delete branch "${b.name}"?`)) deleteBranch(b.name, false)
                      }}
                    >
                      ✕
                    </button>
                  </span>
                )}
              </div>
            ))}
            {!locals.length && <div className="side-empty">No local branches</div>}
          </>
        )}
      </div>

      <div className="side-section">
        <div className="side-head">
          <span className="side-title" onClick={() => toggle('remotes')}>
            <span className="chevron">{collapsed.remotes ? '▸' : '▾'}</span>
            Remotes
          </span>
          <button title="Add remote" onClick={() => setRemoteDlg(true)}>
            ＋
          </button>
        </div>
        {!collapsed.remotes && (
          <>
            {remotes.length === 0 && <div className="side-empty">No remotes configured</div>}
            {remoteBranches.map((b) => (
              <div
                key={b.name}
                className="side-item"
                title={'Check out ' + b.name}
                onClick={() => checkout(b.name.replace(/^[^/]+\//, ''))}
              >
                <span className="ico">⤓</span>
                <span className="label">{b.name}</span>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="side-section">
        <div className="side-head">
          <span className="side-title" onClick={() => toggle('tags')}>
            <span className="chevron">{collapsed.tags ? '▸' : '▾'}</span>
            Tags
          </span>
        </div>
        {!collapsed.tags && (
          <>
            {tags.map((t) => (
              <div
                key={t.name}
                className="side-item"
                title={
                  (t.annotated ? 'Annotated tag' : 'Lightweight tag') +
                  ` \u2014 ${t.hash.slice(0, 8)}` +
                  (t.subject ? `\n${t.subject}` : '')
                }
                onClick={() => checkout(t.name)}
              >
                <span className="ico">🏷</span>
                <span className="label">{t.name}</span>
                <span className="hover-actions" onClick={(e) => e.stopPropagation()}>
                  {remotes.length > 0 && (
                    <button className="mini-btn" title="Push tag to remote" onClick={() => pushTag(t.name)}>
                      Push
                    </button>
                  )}
                  <button
                    className="mini-btn danger"
                    title="Delete tag"
                    onClick={() => {
                      if (confirm(`Delete tag "${t.name}"?`)) deleteTag(t.name)
                    }}
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}
            {!tags.length && <div className="side-empty">No tags</div>}
          </>
        )}
      </div>

      <div className="side-section">
        <div className="side-head">
          <span className="side-title" onClick={() => toggle('submodules')}>
            <span className="chevron">{collapsed.submodules ? '▸' : '▾'}</span>
            Submodules
          </span>
          {submodules.length > 0 && (
            <button title="Initialize / update all submodules" onClick={() => updateSubmodules()}>
              ⟳
            </button>
          )}
        </div>
        {!collapsed.submodules && (
          <>
            {submodules.map((s) => (
              <div
                key={s.path}
                className="side-item"
                title={s.path + ' \u2014 ' + s.hash.slice(0, 8) + (s.describe ? ` (${s.describe})` : '')}
              >
                <span className="ico">❏</span>
                <span className="label">{s.name}</span>
                {s.state !== 'initialized' && <span className="track">{subStateLabel(s.state)}</span>}
                <span className="hover-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="mini-btn"
                    title="Initialize / update this submodule"
                    onClick={() => updateSubmodule(s.path)}
                  >
                    Update
                  </button>
                </span>
              </div>
            ))}
            {!submodules.length && <div className="side-empty">No submodules</div>}
          </>
        )}
      </div>

      <div className="side-section">
        <div className="side-head">
          <span className="side-title" onClick={() => toggle('stashes')}>
            <span className="chevron">{collapsed.stashes ? '▸' : '▾'}</span>
            Stashes
          </span>
        </div>
        {!collapsed.stashes && (
          <>
            {stashes.map((s) => (
              <div key={s.ref} className="side-item" title={s.message}>
                <span className="ico">⚑</span>
                <span className="label">{s.message}</span>
                <span className="hover-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="mini-btn" title="Apply and drop" onClick={() => stashApply(s.ref, true)}>
                    Pop
                  </button>
                  <button className="mini-btn" title="Apply, keep stash" onClick={() => stashApply(s.ref, false)}>
                    Apply
                  </button>
                  <button
                    className="mini-btn danger"
                    title="Drop stash"
                    onClick={() => {
                      if (confirm(`Drop ${s.ref}?`)) stashDrop(s.ref)
                    }}
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}
            {!stashes.length && <div className="side-empty">No stashes</div>}
          </>
        )}
      </div>

      {remoteDlg && <AddRemoteDialog onClose={() => setRemoteDlg(false)} />}
      {branchMenu && (
        <ContextMenu
          x={branchMenu.x}
          y={branchMenu.y}
          items={buildBranchMenu(branchMenu.branch)}
          onClose={() => setBranchMenu(null)}
        />
      )}
      {renameTarget && (
        <RenameBranchDialog name={renameTarget} onClose={() => setRenameTarget(null)} />
      )}
    </div>
  )
}
