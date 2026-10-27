import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode
} from 'react'
import { useStore } from '../store'
import { Modal } from './Dialog'
import type { RepoBookmark } from '@shared/types'

function RemoveRepoDialog({ repo, onClose }: { repo: RepoBookmark; onClose: () => void }) {
  const removeRepo = useStore((s) => s.removeRepo)

  const submit = async (): Promise<void> => {
    await removeRepo(repo.id)
    onClose()
  }

  return (
    <Modal
      title="Remove Repository"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={submit}>
            Remove
          </button>
        </>
      }
    >
      <div className="dialog-subject" title={repo.path}>
        <span className="ico">🗀</span>
        <span className="dialog-subject-name">{repo.name}</span>
      </div>
      <p className="modal-note">
        Only removes it from this list — the folder and its Git history stay exactly where they
        are, and you can add it again at any time.
      </p>
    </Modal>
  )
}

function RepoRow({
  repo,
  current,
  dragging,
  onSelect,
  onRemove,
  onDragStart,
  onDragEnd,
  onDrop
}: {
  repo: RepoBookmark
  current: boolean
  dragging: boolean
  onSelect: () => void
  onRemove: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDrop: (e: ReactDragEvent) => void
}) {
  return (
    <div
      className={'repo-row' + (current ? ' current' : '') + (dragging ? ' dragging' : '')}
      title={repo.path}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onClick={onSelect}
    >
      <span className="repo-grip" title="Drag to reorder">
        ⋮⋮
      </span>
      <span className="repo-name">{repo.name}</span>
      <button
        className="mini-btn danger repo-remove"
        title={`Remove ${repo.name} from the list`}
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
      >
        ✕
      </button>
    </div>
  )
}

/**
 * The toolbar repository list. A custom panel rather than a <select> because a
 * native dropdown cannot host per-row actions, cannot be reordered, and — the
 * original complaint — is closed by the OS the moment the window loses focus.
 * This one only closes on an explicit action: picking a repo, clicking away
 * inside the app, or Escape.
 */
export function RepoPicker() {
  const repos = useStore((s) => s.repos)
  const groups = useStore((s) => s.groups)
  const activeGroupId = useStore((s) => s.activeGroupId)
  const active = useStore((s) => s.activeRepoPath)
  const selectRepo = useStore((s) => s.selectRepo)
  const reorderRepos = useStore((s) => s.reorderRepos)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [removing, setRemoving] = useState<RepoBookmark | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const activeRepo = repos.find((r) => r.path === active)
  // With a group selected in the toolbar filter the menu lists only its
  // members; with All repos it is one flat, ungrouped list.
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null
  const inGroup = activeGroup ? repos.filter((r) => activeGroup.repoIds.includes(r.id)) : repos
  const q = query.trim().toLowerCase()
  const visible = q
    ? inGroup.filter((r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q))
    : inGroup

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const pick = (repo: RepoBookmark): void => {
    setOpen(false)
    if (repo.path !== active) selectRepo(repo.path)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      // A click inside the panel (or on the button that opened it) is not "away".
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  /** Moves the dragged repo to `target`'s position in the stored bookmark order. */
  const dropOn = (e: ReactDragEvent, targetId: string): void => {
    // Without this, dropping something we did not start (a file from Explorer,
    // say) is handled by Chromium and navigates the window away from the app.
    e.preventDefault()
    setDragId(null)
    if (!dragId || dragId === targetId) return
    // Rows are rendered per group, so moving a repo past a group boundary would
    // change the stored order without moving the row. Reassigning groups is the
    // Groups dialog's job; here a cross-group drop is simply not a reorder. A
    // repo may be in several groups, so "same bucket" means sharing any group,
    // and two ungrouped repos count as the same bucket.
    const dragGroups = groups.filter((g) => g.repoIds.includes(dragId))
    const targetGroups = groups.filter((g) => g.repoIds.includes(targetId))
    const bothUngrouped = !dragGroups.length && !targetGroups.length
    if (!bothUngrouped && !dragGroups.some((g) => targetGroups.includes(g))) return
    const ids = repos.map((r) => r.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ...ids.splice(from, 1))
    reorderRepos(ids)
  }

  const row = (repo: RepoBookmark): ReactNode => (
    <RepoRow
      key={repo.id}
      repo={repo}
      current={repo.path === active}
      dragging={dragId === repo.id}
      onSelect={() => pick(repo)}
      onRemove={() => setRemoving(repo)}
      onDragStart={() => setDragId(repo.id)}
      onDragEnd={() => setDragId(null)}
      onDrop={(e) => dropOn(e, repo.id)}
    />
  )

  return (
    <div className="repo-picker" ref={wrapRef}>
      <button
        className="repo-select"
        title={active ?? 'No repositories'}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="repo-select-name">{activeRepo?.name ?? 'No repositories'}</span>
        <span className="repo-select-caret">▾</span>
      </button>

      {open && (
        <div className="repo-menu">
          {inGroup.length > 1 && (
            <div className="repo-search-wrap">
              <input
                className="repo-search"
                placeholder="Search repositories…"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && visible.length) pick(visible[0])
                }}
              />
            </div>
          )}
          {!repos.length && <div className="side-empty">No repositories yet</div>}
          {!!activeGroup && !inGroup.length && (
            <div className="side-empty">No repositories in this group</div>
          )}
          {!!q && !visible.length && <div className="side-empty">No matching repositories</div>}
          {visible.map(row)}
          {repos.length > 1 && !q && <div className="repo-menu-hint">Drag a row to reorder</div>}
        </div>
      )}

      {removing && <RemoveRepoDialog repo={removing} onClose={() => setRemoving(null)} />}
    </div>
  )
}
