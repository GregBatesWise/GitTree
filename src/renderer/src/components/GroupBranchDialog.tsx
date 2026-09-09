import { useState } from 'react'
import { useStore } from '../store'
import { Modal } from './Dialog'
import type { GroupRepoResult, RepoGroup } from '@shared/types'

/** Group names are free text, git branch names are not. */
export function toBranchName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[~^:?*[\]\\@{}]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^[-./]+|[-./]+$/g, '')
}

export function GroupBranchDialog({ group, onClose }: { group: RepoGroup; onClose: () => void }) {
  const repos = useStore((s) => s.repos)
  const busy = useStore((s) => s.busy)
  const checkGroupBranch = useStore((s) => s.checkGroupBranch)
  const createGroupBranch = useStore((s) => s.createGroupBranch)
  const [base, setBase] = useState('vnext')
  const [branch, setBranch] = useState(toBranchName(group.name))
  const [checks, setChecks] = useState<GroupRepoResult[] | null>(null)
  const [results, setResults] = useState<GroupRepoResult[] | null>(null)

  const paths = group.repoIds
    .map((id) => repos.find((r) => r.id === id)?.path)
    .filter((p): p is string => !!p)

  const nameOf = (path: string): string => repos.find((r) => r.path === path)?.name ?? path

  const trimmedBase = base.trim()
  const trimmedBranch = branch.trim()
  const ready = !!paths.length && !!trimmedBase && !!trimmedBranch && !busy
  const canCreate = ready && !!checks?.length && checks.every((c) => c.ok)
  const rows = results ?? checks
  const blocked = rows?.filter((r) => !r.ok).length ?? 0

  const edit = (setter: (v: string) => void, value: string): void => {
    // Any edit invalidates the check that produced the current rows.
    setChecks(null)
    setResults(null)
    setter(value)
  }

  const check = async (): Promise<void> => {
    setResults(null)
    setChecks(await checkGroupBranch(paths, trimmedBase, trimmedBranch))
  }

  const create = async (): Promise<void> => {
    const res = await createGroupBranch(paths, trimmedBase, trimmedBranch)
    if (!res) return
    if (res.every((r) => r.ok)) {
      onClose()
      return
    }
    setChecks(null)
    setResults(res)
  }

  return (
    <Modal
      title={`Start branch across "${group.name}"`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn" disabled={!ready} onClick={check}>
            Check repositories
          </button>
          <button className="btn btn-primary" disabled={!canCreate} onClick={create}>
            Create branch
          </button>
        </>
      }
    >
      <div className="group-flow">
        <p className="group-flow-summary">
          In each of the {paths.length} repositor{paths.length === 1 ? 'y' : 'ies'} in this group:
          check out <code>{trimmedBase || '…'}</code>, pull (fast-forward only), then create{' '}
          <code>{trimmedBranch || '…'}</code>.
        </p>

        <div className="group-flow-fields">
          <label>
            Base branch
            <input
              type="text"
              value={base}
              onChange={(e) => edit(setBase, e.target.value)}
            />
          </label>
          <label>
            New branch
            <input
              type="text"
              autoFocus
              value={branch}
              onChange={(e) => edit(setBranch, e.target.value)}
            />
          </label>
        </div>

        {!paths.length && <div className="side-empty">No repositories in this group</div>}

        {rows && (
          <div className="group-flow-results">
            {rows.map((r) => (
              <div key={r.path} className={`flow-row ${r.ok ? 'flow-ok' : 'flow-bad'}`}>
                <span className="flow-icon">{r.ok ? '✓' : '✕'}</span>
                <span className="flow-name" title={r.path}>
                  {nameOf(r.path)}
                </span>
                <span className="flow-msg">{r.message}</span>
              </div>
            ))}
          </div>
        )}

        {rows && (
          <div className="group-flow-note">
            {blocked
              ? `${blocked} of ${rows.length} repositories ${
                  results ? 'failed' : 'blocked'
                } — nothing else has been changed.`
              : results
                ? `Created "${trimmedBranch}" in all ${rows.length} repositories.`
                : `All ${rows.length} repositories are ready.`}
          </div>
        )}
      </div>
    </Modal>
  )
}
