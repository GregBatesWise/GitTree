import { useState } from 'react'
import { useStore } from '../store'
import { Modal } from './Dialog'
import type { RepoGroup } from '@shared/types'

function GroupRow({
  group,
  onRename,
  onDelete,
  onSetFeatureId
}: {
  group: RepoGroup
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onSetFeatureId: (id: string, featureId: string) => void
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
  const createGroup = useStore((s) => s.createGroup)
  const renameGroup = useStore((s) => s.renameGroup)
  const deleteGroup = useStore((s) => s.deleteGroup)
  const assignGroup = useStore((s) => s.assignGroup)
  const setGroupFeatureId = useStore((s) => s.setGroupFeatureId)
  const [newName, setNewName] = useState('')

  const groupOf = (repoId: string): string =>
    groups.find((g) => g.repoIds.includes(repoId))?.id ?? ''

  const addGroup = async (): Promise<void> => {
    const n = newName.trim()
    if (!n) return
    await createGroup(n)
    setNewName('')
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
              />
            ))}
          </div>
        )}

        <div className="group-assign">
          <div className="group-assign-title">Assign repositories</div>
          {!repos.length && <div className="side-empty">No repositories yet</div>}
          {repos.map((r) => (
            <div key={r.id} className="assign-row">
              <span className="assign-name" title={r.path}>
                {r.name}
              </span>
              <select
                value={groupOf(r.id)}
                onChange={(e) => assignGroup(r.id, e.target.value || null)}
              >
                <option value="">Ungrouped</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
