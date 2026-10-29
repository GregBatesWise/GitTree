import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store'
import { Modal } from './Dialog'
import type { GroupRepoResult, RepoGroup } from '@shared/types'

/** Confirms every repo in the group has an empty working directory and nothing unpushed. */
export function GroupCleanDialog({ group, onClose }: { group: RepoGroup; onClose: () => void }) {
  const repos = useStore((s) => s.repos)
  const busy = useStore((s) => s.busy)
  const checkGroupClean = useStore((s) => s.checkGroupClean)
  const [rows, setRows] = useState<GroupRepoResult[] | null>(null)

  const paths = group.repoIds
    .map((id) => repos.find((r) => r.id === id)?.path)
    .filter((p): p is string => !!p)
  const key = paths.join('\n')

  const nameOf = (path: string): string => repos.find((r) => r.path === path)?.name ?? path

  const check = useCallback(async (): Promise<void> => {
    setRows(null)
    setRows(await checkGroupClean(key ? key.split('\n') : []))
  }, [checkGroupClean, key])

  useEffect(() => {
    void check()
  }, [check])

  const failing = rows?.filter((r) => !r.ok).length ?? 0

  return (
    <Modal
      title={`Check "${group.name}" is clean and pushed`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" disabled={!paths.length || !!busy} onClick={check}>
            Check again
          </button>
        </>
      }
    >
      <div className="group-flow">
        <p className="group-flow-summary">
          Each repository should have no uncommitted or untracked files, and no local branch with
          commits that haven&apos;t been pushed. Compared against the last fetch.
        </p>

        {!paths.length && <div className="side-empty">No repositories in this group</div>}
        {paths.length > 0 && !rows && <div className="side-empty">Checking…</div>}

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

        {rows && rows.length > 0 && (
          <div className="group-flow-note">
            {failing
              ? `${failing} of ${rows.length} repositories need attention.`
              : `All ${rows.length} repositories are clean and pushed.`}
          </div>
        )}
      </div>
    </Modal>
  )
}
