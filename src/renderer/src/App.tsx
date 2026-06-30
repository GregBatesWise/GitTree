import { useEffect } from 'react'
import { useStore } from './store'
import { Toolbar } from './components/Toolbar'
import { Sidebar } from './components/Sidebar'
import { WorkingCopy } from './components/WorkingCopy'
import { HistoryView } from './components/HistoryView'

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty">
      <h2>Welcome to GitTree</h2>
      <p>Add a local Git repository to get started.</p>
      <button className="btn btn-primary" onClick={onAdd}>
        Open Repository…
      </button>
    </div>
  )
}

export default function App() {
  const init = useStore((s) => s.init)
  const view = useStore((s) => s.view)
  const active = useStore((s) => s.activeRepoPath)
  const status = useStore((s) => s.status)
  const error = useStore((s) => s.error)
  const dismissError = useStore((s) => s.dismissError)
  const toast = useStore((s) => s.toast)
  const dismissToast = useStore((s) => s.dismissToast)
  const busy = useStore((s) => s.busy)
  const loading = useStore((s) => s.loading)
  const addRepo = useStore((s) => s.addRepoViaDialog)

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(dismissToast, 2500)
    return () => clearTimeout(t)
  }, [toast, dismissToast])

  return (
    <div className="app">
      <Toolbar />
      {error && (
        <div className="error-bar">
          <span className="msg">{error}</span>
          <button onClick={dismissError} title="Dismiss">
            ✕
          </button>
        </div>
      )}
      <div className="body">
        <Sidebar />
        <div className="content">
          {!active ? (
            <EmptyState onAdd={addRepo} />
          ) : view === 'working' ? (
            <WorkingCopy />
          ) : (
            <HistoryView />
          )}
        </div>
      </div>
      <div className="statusbar">
        {busy ? (
          <span className="spin">{busy}…</span>
        ) : loading ? (
          <span className="spin">Loading…</span>
        ) : (
          <span>Ready</span>
        )}
        {status?.branch && (
          <span>
            On {status.branch}
            {status.upstream ? ` → ${status.upstream}` : ' (no upstream)'}
          </span>
        )}
        {status && (status.ahead > 0 || status.behind > 0) && (
          <span>
            ↑{status.ahead} ↓{status.behind}
          </span>
        )}
        {active && <span style={{ marginLeft: 'auto' }}>{active}</span>}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
