import { useState } from 'react'
import { useStore } from '../store'
import { Modal } from './Dialog'

function NewBranchDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [checkout, setCheckout] = useState(true)
  const createBranch = useStore((s) => s.createBranch)
  const busy = useStore((s) => s.busy)

  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    const ok = await createBranch(name.trim(), checkout)
    if (ok) onClose()
  }

  return (
    <Modal
      title="New Branch"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!name.trim() || !!busy} onClick={submit}>
            Create Branch
          </button>
        </>
      }
    >
      <label>
        Branch name
        <input
          type="text"
          autoFocus
          value={name}
          placeholder="feature/my-change"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={checkout} onChange={(e) => setCheckout(e.target.checked)} />
        Check out new branch
      </label>
    </Modal>
  )
}

function StashDialog({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState('')
  const [untracked, setUntracked] = useState(true)
  const stashSave = useStore((s) => s.stashSave)
  const busy = useStore((s) => s.busy)

  const submit = async (): Promise<void> => {
    const ok = await stashSave(message.trim(), untracked)
    if (ok) onClose()
  }

  return (
    <Modal
      title="Stash Changes"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!!busy} onClick={submit}>
            Stash
          </button>
        </>
      }
    >
      <label>
        Message (optional)
        <input
          type="text"
          autoFocus
          value={message}
          placeholder="Work in progress"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={untracked} onChange={(e) => setUntracked(e.target.checked)} />
        Include untracked files
      </label>
    </Modal>
  )
}

function NewTagDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const createTag = useStore((s) => s.createTag)
  const busy = useStore((s) => s.busy)

  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    const ok = await createTag(name.trim(), message.trim())
    if (ok) onClose()
  }

  return (
    <Modal
      title="New Tag"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!name.trim() || !!busy} onClick={submit}>
            Create Tag
          </button>
        </>
      }
    >
      <label>
        Tag name
        <input
          type="text"
          autoFocus
          value={name}
          placeholder="v1.0.0"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
      </label>
      <label>
        Message (optional — creates an annotated tag)
        <input
          type="text"
          value={message}
          placeholder="Release 1.0.0"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
      </label>
    </Modal>
  )
}

function TBtn({
  icon,
  label,
  count,
  disabled,
  onClick,
  title
}: {
  icon: string
  label: string
  count?: number
  disabled?: boolean
  onClick: () => void
  title?: string
}) {
  return (
    <button className="tbtn" disabled={disabled} onClick={onClick} title={title}>
      {count ? <span className="count">{count}</span> : null}
      <span className="ico">{icon}</span>
      <span className="lbl">{label}</span>
    </button>
  )
}

export function Toolbar() {
  const repos = useStore((s) => s.repos)
  const active = useStore((s) => s.activeRepoPath)
  const selectRepo = useStore((s) => s.selectRepo)
  const addRepo = useStore((s) => s.addRepoViaDialog)
  const status = useStore((s) => s.status)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const push = useStore((s) => s.push)
  const pull = useStore((s) => s.pull)
  const fetchRemote = useStore((s) => s.fetch)
  const refresh = useStore((s) => s.refreshAll)
  const openInTerminal = useStore((s) => s.openInTerminal)
  const revealFolder = useStore((s) => s.revealInFileManager)
  const busy = useStore((s) => s.busy)

  const [branchOpen, setBranchOpen] = useState(false)
  const [tagOpen, setTagOpen] = useState(false)
  const [stashOpen, setStashOpen] = useState(false)

  const hasRepo = !!active
  const ahead = status?.ahead ?? 0
  const behind = status?.behind ?? 0
  const noUpstream = !!(hasRepo && status && status.branch && !status.upstream)
  const disabled = !hasRepo || !!busy

  return (
    <div className="toolbar">
      <select
        className="repo-select"
        value={active ?? ''}
        onChange={(e) => selectRepo(e.target.value)}
      >
        {!repos.length && <option value="">No repositories</option>}
        {repos.map((r) => (
          <option key={r.id} value={r.path}>
            {r.name}
          </option>
        ))}
      </select>
      <TBtn icon="＋" label="Add" onClick={addRepo} title="Add a local repository" />
      <TBtn
        icon="❯"
        label="Terminal"
        disabled={!hasRepo}
        onClick={() => openInTerminal()}
        title="Open this repository in a terminal"
      />
      <TBtn
        icon="🗁"
        label="Folder"
        disabled={!hasRepo}
        onClick={() => revealFolder()}
        title="Show this repository in the file manager"
      />

      <div className="tb-sep" />

      <TBtn
        icon="✓"
        label="Commit"
        disabled={!hasRepo}
        onClick={() => setView('working')}
        title="Show working copy / commit"
      />
      <TBtn
        icon="↓"
        label="Pull"
        count={behind}
        disabled={disabled}
        onClick={() => pull()}
        title="Pull from upstream"
      />
      <TBtn
        icon="↑"
        label="Push"
        count={ahead}
        disabled={disabled}
        onClick={() => push(noUpstream)}
        title={noUpstream ? 'Push and set upstream' : 'Push to upstream'}
      />
      <TBtn
        icon="⟳"
        label="Fetch"
        disabled={disabled}
        onClick={() => fetchRemote()}
        title="Fetch all remotes"
      />

      <div className="tb-sep" />

      <TBtn
        icon="⎇"
        label="Branch"
        disabled={disabled}
        onClick={() => setBranchOpen(true)}
        title="Create a branch"
      />
      <TBtn
        icon="🏷"
        label="Tag"
        disabled={disabled}
        onClick={() => setTagOpen(true)}
        title="Create a tag"
      />
      <TBtn
        icon="⚑"
        label="Stash"
        disabled={disabled}
        onClick={() => setStashOpen(true)}
        title="Stash changes"
      />

      <div className="tb-spacer" />

      <TBtn
        icon={view === 'working' ? '☰' : '◧'}
        label={view === 'working' ? 'History' : 'Working'}
        disabled={!hasRepo}
        onClick={() => setView(view === 'working' ? 'history' : 'working')}
        title="Toggle view"
      />
      <TBtn icon="⟲" label="Refresh" disabled={disabled} onClick={() => refresh()} title="Refresh" />

      {branchOpen && <NewBranchDialog onClose={() => setBranchOpen(false)} />}
      {tagOpen && <NewTagDialog onClose={() => setTagOpen(false)} />}
      {stashOpen && <StashDialog onClose={() => setStashOpen(false)} />}
    </div>
  )
}
