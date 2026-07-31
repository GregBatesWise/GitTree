import { useStore } from '../store'
import { Modal } from './Dialog'
import type { StashInfo } from '@shared/types'

/**
 * Replaces a native confirm() that showed only the reflog selector ('Drop
 * stash@{0}?'), which is opaque, shifts as stashes are dropped, and appears
 * nowhere else in the UI.
 */
export function DropStashDialog({
  stash,
  onClose
}: {
  stash: StashInfo
  onClose: () => void
}) {
  const stashDrop = useStore((s) => s.stashDrop)
  const busy = useStore((s) => s.busy)

  const submit = async (): Promise<void> => {
    await stashDrop(stash.ref)
    // Failures surface in the error bar; nothing useful left in the dialog.
    onClose()
  }

  return (
    <Modal
      title="Drop stash"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" disabled={!!busy} onClick={submit}>
            Drop stash
          </button>
        </>
      }
    >
      <div className="dialog-subject" title={stash.message}>
        <span className="ico">⚑</span>
        <span className="dialog-subject-name">{stash.name}</span>
        {stash.branch && <span className="stash-branch">{stash.branch}</span>}
      </div>
      <p className="modal-note">
        This discards the stashed changes for good — they cannot be recovered from the
        stash list afterwards.
      </p>
    </Modal>
  )
}
