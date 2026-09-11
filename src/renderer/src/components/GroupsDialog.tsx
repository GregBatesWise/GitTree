import { useState } from 'react'
import { useStore } from '../store'
import { Modal } from './Dialog'
import { GroupBranchDialog } from './GroupBranchDialog'
import type { RepoGroup } from '@shared/types'

function GroupRow({
  group,
  onRename,
  onDelete,
  onSetFeatureId,
  onStartBranch,
  onCopyRepos
}: {
  group: RepoGroup
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onSetFeatureId: (id: string, featureId: string) => void
  onStartBranch: (group: RepoGroup) => void
  onCopyRepos: (group: RepoGroup) => void
}) {
  const [name, setName] = useState(group.name)
  const [featureId, setFeatureId] = useState(group.featureId ?? '')

  const commit = (): void => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== group.name) onRename(group.id, trimmed)
    else setName(group.name)
  }

  const commitFeatureId = (): void => {
    const trimmed = featureId.trim()
    if (trimmed !== (group.featureId ?? '')) onSetFeatureId(group.id, trimmed)
  }

  return (
    <div className="group-item">
      <input
        className="group-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      <input
        className="group-feature"
        type="text"
        value={featureId}
        placeholder="Feature id"
        title="Appended to every commit made in this group, e.g. 190190 → #190190"
        onChange={(e) => setFeatureId(e.target.value)}
        onBlur={commitFeatureId}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      <span className="group-count">
        {group.repoIds.length} repo{group.repoIds.length === 1 ? '' : 's'}
      </span>
      <button
        className="btn btn-sm"
        disabled={!group.repoIds.length}
        title="Check out the base branch, pull, then create this group's branch in every repository"
        onClick={() => onStartBranch(group)}
      >
        Start branch
      </button>
      <button
        className="btn btn-sm"
        disabled={!group.repoIds.length}
        title="Copy this group's repository names to the clipboard, comma-separated"
        onClick={() => onCopyRepos(group)}
      >
        Copy repos
      </button>
      <button
        className="btn btn-danger btn-sm"
        onClick={() => {
          if (confirm(`Delete group "${group.name}"? Repositories are kept, only the group is removed.`))
            onDelete(group.id)
        }}
      >
        Delete
      </button>
    </div>
  )
}

export function GroupsDialog({ onClose }: { onClose: () => void }) {
  const repos = useStore((s) => s.repos)
  const groups = useStore((s) => s.groups)
  const activeGroupId = useStore((s) => s.activeGroupId)
  const createGroup = useStore((s) => s.createGroup)
  const renameGroup = useStore((s) => s.renameGroup)
  const deleteGroup = useStore((s) => s.deleteGroup)
  const setGroupMembership = useStore((s) => s.setGroupMembership)
  const setGroupFeatureId = useStore((s) => s.setGroupFeatureId)
  const copyText = useStore((s) => s.copyText)
  const [newName, setNewName] = useState('')
  const [branchGroup, setBranchGroup] = useState<RepoGroup | null>(null)
  // Which group's membership the checkboxes below edit; defaults to the first.
  const [assignGroupId, setAssignGroupId] = useState('')

  // The toolbar's active group gets priority: it is preselected and listed
  // first in the dropdown, with the rest following their order in the list
  // above.
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null
  const assignTarget = groups.find((g) => g.id === assignGroupId) ?? activeGroup ?? groups[0] ?? null
  const assignOptions = activeGroup
    ? [activeGroup, ...groups.filter((g) => g.id !== activeGroup.id)]
    : groups

  const addGroup = async (): Promise<void> => {
    const n = newName.trim()
    if (!n) return
    await createGroup(n)
    setNewName('')
  }

  const copyGroupRepos = (group: RepoGroup): void => {
    const names = group.repoIds
      .map((id) => repos.find((r) => r.id === id)?.name)
      .filter((n): n is string => !!n)
    if (names.length) void copyText(names.join(', '))
  }

  // Shown instead of the manager rather than stacked on top of it, so Escape
  // steps back one dialog at a time.
  if (branchGroup) {
    return <GroupBranchDialog group={branchGroup} onClose={() => setBranchGroup(null)} />
  }

  return (
    <Modal
      title="Repository Groups"
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="group-manager">
        <div className="group-add">
          <input
            type="text"
            autoFocus
            placeholder="New group name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addGroup()
            }}
          />
          <button className="btn btn-primary" disabled={!newName.trim()} onClick={addGroup}>
            Add Group
          </button>
        </div>

        {groups.length > 0 && (
          <div className="group-list">
            {groups.map((g) => (
              <GroupRow
                key={g.id}
                group={g}
                onRename={renameGroup}
                onDelete={deleteGroup}
                onSetFeatureId={setGroupFeatureId}
                onStartBranch={setBranchGroup}
                onCopyRepos={copyGroupRepos}
              />
            ))}
          </div>
        )}

        <div className="group-assign">
          <div className="group-assign-title">Assign repositories</div>
          {!groups.length && <div className="side-empty">Add a group above first</div>}
          {groups.length > 0 && (
            <>
              <select
                className="assign-group-select"
                value={assignTarget?.id ?? ''}
                onChange={(e) => setAssignGroupId(e.target.value)}
              >
                {assignOptions.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              {!repos.length && <div className="side-empty">No repositories yet</div>}
              <div className="assign-list">
                {repos.map((r) => {
                  // A repository can belong to any number of groups; the checkbox
                  // toggles membership of the group chosen above only.
                  const others = groups.filter(
                    (g) => g.id !== assignTarget?.id && g.repoIds.includes(r.id)
                  )
                  return (
                    <label key={r.id} className="assign-row">
                      <input
                        type="checkbox"
                        checked={!!assignTarget?.repoIds.includes(r.id)}
                        onChange={(e) => {
                          if (assignTarget)
                            void setGroupMembership(r.id, assignTarget.id, e.target.checked)
                        }}
                      />
                      <span className="assign-name" title={r.path}>
                        {r.name}
                      </span>
                      {others.length > 0 && (
                        <span
                          className="assign-also"
                          title={`Also in: ${others.map((g) => g.name).join(', ')}`}
                        >
                          +{others.length} other{others.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
