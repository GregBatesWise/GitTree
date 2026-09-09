import { useState } from 'react'
import { useStore } from '../store'
import { Modal } from './Dialog'
import { toBranchName } from './GroupBranchDialog'
import type { GroupRepoResult, RepoGroup } from '@shared/types'

/**
 * Group-wide counterpart of GroupBranchDialog for a branch that already
 * exists: every repo in the group checks out the same branch name, defaulting
 * to the group's own branch name as Start branch would have created it.
 */
export function GroupCheckoutDialog({ group, onClose }: { group: RepoGroup; onClose: () => void }) {
  const repos = useStore((s) => s.repos)
  const busy = useStore((s) => s.busy)
  const checkGroupCheckout = useStore((s) => s.checkGroupCheckout)
  const checkoutGroupBranch = useStore((s) => s.checkoutGroupBranch)
  const [branch, setBranch] = useState(toBranchName(group.name))
  const [checks, setChecks] = useState<GroupRepoResult[] | null>(null)
  const [results, setResults] = useState<GroupRepoResult[] | null>(null)

  const paths = group.repoIds
    .map((id) => repos.find((r) => r.id === id)?.path)
    .filter((p): p is string => !!p)

  const nameOf = (path: string): string => repos.find((r) => r.path === path)?.name ?? path

  const trimmedBranch = branch.trim()
  const ready = !!paths.length && !!trimmedBranch && !busy
  const canCheckout = ready && !!checks?.length && checks.every((c) => c.ok)
  const rows = results ?? checks
  const blocked = rows?.filter((r) => !r.ok).length ?? 0

  const edit = (value: string): void => {
    // Any edit invalidates the check that produced the current rows.
    setChecks(null)
    setResults(null)
    setBranch(value)
  }

  const check = async (): Promise<void> => {
    setResults(null)
    setChecks(await checkGroupCheckout(paths, trimmedBranch))
  }

  const checkout = async (): Promise<void> => {
    const res = await checkoutGroupBranch(paths, trimmedBranch)
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
      title={`Check out branch across "${group.name}"`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn" disabled={!ready} onClick={check}>
            Check repositories
          </button>
          <button className="btn btn-primary" disabled={!canCheckout} onClick={checkout}>
            Check out branch
          </button>
        </>
      }
    >
      <div className="group-flow">
        <p className="group-flow-summary">
          Check out <code>{trimmedBranch || '…'}</code> in each of the {paths.length} repositor
          {paths.length === 1 ? 'y' : 'ies'} in this group. The branch must already exist there —
          use Start branch from the Groups dialog to create it first.
        </p>

        <div className="group-flow-fields">
          <label>
            Branch
            <input type="text" autoFocus value={branch} onChange={(e) => edit(e.target.value)} />
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
                ? `Checked out "${trimmedBranch}" in all ${rows.length} repositories.`
                : `All ${rows.length} repositories are ready.`}
          </div>
        )}
      </div>
    </Modal>
  )
}
