import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'

/**
 * The toolbar group filter, sitting left of the repository picker. "All repos"
 * clears the filter; picking a group narrows the repo dropdown to that group's
 * members and switches the working copy into the group when the current
 * repository is not a member. Like RepoPicker this is a custom panel rather
 * than a <select>, so the OS cannot close it when the window loses focus.
 */
export function GroupPicker() {
  const groups = useStore((s) => s.groups)
  const activeGroupId = useStore((s) => s.activeGroupId)
  const setActiveGroup = useStore((s) => s.setActiveGroup)

  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null

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

  const pick = (id: string | null): void => {
    setOpen(false)
    if (id !== activeGroupId) void setActiveGroup(id)
  }

  return (
    <div className="repo-picker group-picker" ref={wrapRef}>
      <button
        className="repo-select"
        title={
          activeGroup ? `Showing repositories in "${activeGroup.name}"` : 'Showing all repositories'
        }
        onClick={() => setOpen((o) => !o)}
      >
        <span className="repo-select-name">{activeGroup?.name ?? 'All repos'}</span>
        <span className="repo-select-caret">▾</span>
      </button>

      {open && (
        <div className="repo-menu">
          <div className={'repo-row' + (activeGroup ? '' : ' current')} onClick={() => pick(null)}>
            <span className="repo-name">All repos</span>
          </div>
          {groups.map((g) => (
            <div
              key={g.id}
              className={'repo-row' + (activeGroup?.id === g.id ? ' current' : '')}
              onClick={() => pick(g.id)}
            >
              <span className="repo-name">{g.name}</span>
              <span className="row-count">{g.repoIds.length}</span>
            </div>
          ))}
          {!groups.length && <div className="side-empty">No groups yet</div>}
        </div>
      )}
    </div>
  )
}
