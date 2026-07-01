import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
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
  const copyText = useStore((s) => s.copyText)
  const toast = useStore((s) => s.toast)
  const dismissToast = useStore((s) => s.dismissToast)
  const busy = useStore((s) => s.busy)
  const loading = useStore((s) => s.loading)
  const addRepo = useStore((s) => s.addRepoViaDialog)
  const refreshAll = useStore((s) => s.refreshAll)

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('sidebarWidth'))
    return saved >= 180 && saved <= 520 ? saved : 248
  })

  const onResizeStart = (e: ReactMouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth
    let latest = startW
    const onMove = (ev: MouseEvent): void => {
      latest = Math.min(520, Math.max(180, startW + ev.clientX - startX))
      setSidebarWidth(latest)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('resizing')
      localStorage.setItem('sidebarWidth', String(latest))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.classList.add('resizing')
  }

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => window.api.onRefresh(() => refreshAll()), [refreshAll])

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
          <button className="copy-btn" onClick={() => copyText(error)} title="Copy error message">
            Copy
          </button>
          <button onClick={dismissError} title="Dismiss">
            ✕
          </button>
        </div>
      )}
      <div className="body">
        <Sidebar width={sidebarWidth} />
        <div
          className="resizer"
          onMouseDown={onResizeStart}
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize the sidebar"
        />
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
