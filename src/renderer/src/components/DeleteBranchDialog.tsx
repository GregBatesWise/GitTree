import { useState } from 'react'
import { useStore } from '../store'
import { Modal } from './Dialog'
import type { BranchInfo } from '@shared/types'

/**
 * Replaces a native confirm() that could only ever run `git branch -d`, leaving
 * no way to delete a branch whose commits are not merged anywhere. Failures keep
 * the dialog open so ticking Force and retrying is one click, with git's own
 * reason ("not fully merged", …) visible in the error bar behind it.
 */
export function DeleteBranchDialog({
  branch,
  onClose
}: {
  branch: BranchInfo
  onClose: () => void
}) {
  const [force, setForce] = useState(!!branch.gone)
  const deleteBranch = useStore((s) => s.deleteBranch)
  const busy = useStore((s) => s.busy)

  const submit = async (): Promise<void> => {
    if (await deleteBranch(branch.name, force)) onClose()
  }

  return (
    <Modal
      title="Delete Branch"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" disabled={!!busy} onClick={submit}>
            {force ? 'Force Delete' : 'Delete'}
          </button>
        </>
      }
    >
      <div className="dialog-subject">
        <span className="ico">○</span>
        <span className="dialog-subject-name">{branch.name}</span>
        {branch.gone && <span className="gone-badge">gone</span>}
      </div>
      <p className="modal-note">
        {branch.gone
          ? `Its upstream ${branch.upstream} no longer exists on the remote, so this branch has most likely already been merged and can be removed.`
          : 'Only the local branch is deleted — anything already pushed to a remote is untouched.'}
      </p>
      <label className="check">
        <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
        Force delete (<code>-D</code>) — discards commits that are not merged anywhere else
      </label>
    </Modal>
  )
}
