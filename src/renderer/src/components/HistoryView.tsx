import { useMemo, useState, type MouseEvent } from 'react'
import { useStore } from '../store'
import { buildGraph, LANE_COLORS, type GraphRow } from '../lib/graph'
import { fullDate, relativeTime } from '../lib/format'
import { DiffViewer } from './DiffViewer'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { Modal } from './Dialog'
import type { CommitDetail, CompareDetail, FileChange, ResetMode } from '@shared/types'

const ROW_H = 32
const LANE_W = 14
const NODE_R = 4.5

function GraphCell({ row, width }: { row: GraphRow; width: number }) {
  const cx = (c: number): number => c * LANE_W + LANE_W / 2
  const mid = ROW_H / 2
  const col = row.col
  return (
    <svg width={width} height={ROW_H} style={{ display: 'block' }}>
      {row.throughs.map((t, i) => (
        <line
          key={'t' + i}
          x1={cx(t.col)}
          y1={0}
          x2={cx(t.col)}
          y2={ROW_H}
          stroke={LANE_COLORS[t.color]}
          strokeWidth={1.6}
        />
      ))}
      {row.entries.map((e, i) => (
        <line
          key={'e' + i}
          x1={cx(e.col)}
          y1={0}
          x2={cx(col)}
          y2={mid}
          stroke={LANE_COLORS[e.color]}
          strokeWidth={1.6}
        />
      ))}
      {row.exits.map((e, i) => (
        <line
          key={'x' + i}
          x1={cx(col)}
          y1={mid}
          x2={cx(e.col)}
          y2={ROW_H}
          stroke={LANE_COLORS[e.color]}
          strokeWidth={1.6}
        />
      ))}
      <circle
        cx={cx(col)}
        cy={mid}
        r={NODE_R}
        fill={LANE_COLORS[row.color]}
        stroke="#1b1e24"
        strokeWidth={1.5}
      />
    </svg>
  )
}

type Badge = { type: 'head' | 'local' | 'remote' | 'tag'; name: string }

function refBadges(refs: string[]): Badge[] {
  const out: Badge[] = []
  for (const ref of refs) {
    if (ref.startsWith('HEAD -> ')) out.push({ type: 'head', name: ref.slice(8) })
    else if (ref === 'HEAD') out.push({ type: 'head', name: 'HEAD' })
    else if (ref.startsWith('tag: ')) out.push({ type: 'tag', name: ref.slice(5) })
    else if (ref.includes('/')) out.push({ type: 'remote', name: ref })
    else out.push({ type: 'local', name: ref })
  }
  return out
}

function statusLetter(status: FileChange['status']): string {
  switch (status) {
    case 'modified':
      return 'M'
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'copied':
      return 'C'
    case 'untracked':
      return '?'
    case 'conflicted':
      return '!'
    default:
      return '•'
  }
}

function CommitMeta({ detail }: { detail: CommitDetail }) {
  const selectCommitFile = useStore((s) => s.selectCommitFile)
  const selectedFile = useStore((s) => s.selectedFile)
  const restoreFile = useStore((s) => s.restoreFileFromCommit)
  const externalDiff = useStore((s) => s.externalDiffCommit)
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const c = detail.commit

  const fileMenu = (path: string): MenuItem[] => [
    {
      label: 'Reset to Commit',
      onClick: () => {
        if (
          confirm(
            `Reset "${path}" to its version in ${c.shortHash}? This overwrites your working copy of the file.`
          )
        )
          restoreFile(c.hash, path)
      }
    },
    { label: 'External Diff', onClick: () => externalDiff(c.hash, path) }
  ]

  return (
    <>
      <div className="detail-meta">
        <div className="subject">{c.subject}</div>
        <div className="row">
          <span className="k">Commit</span>
          <span className="v hash">{c.hash}</span>
        </div>
        <div className="row">
          <span className="k">Author</span>
          <span className="v">
            {c.author} &lt;{c.authorEmail}&gt;
          </span>
        </div>
        <div className="row">
          <span className="k">Date</span>
          <span className="v" title={fullDate(c.date)}>
            {fullDate(c.date)}
          </span>
        </div>
        {c.parents.length > 0 && (
          <div className="row">
            <span className="k">Parents</span>
            <span className="v hash">{c.parents.map((p) => p.slice(0, 7)).join(' ')}</span>
          </div>
        )}
        {c.body && <div className="detail-body">{c.body}</div>}
      </div>
      <div className="file-list">
        {detail.files.map((f) => {
          const active = selectedFile?.kind === 'commit' && selectedFile.path === f.path
          return (
            <div
              key={f.path}
              className={'file-row' + (active ? ' selected' : '')}
              onClick={() => selectCommitFile(f.path)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, path: f.path })
              }}
              title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
            >
              <span className={'st ' + f.status}>{statusLetter(f.status)}</span>
              <span className="path">{f.path}</span>
            </div>
          )
        })}
        {!detail.files.length && <div className="side-empty">No file changes</div>}
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={fileMenu(menu.path)} onClose={() => setMenu(null)} />
      )}
    </>
  )
}

function CompareMeta({ detail }: { detail: CompareDetail }) {
  const selectCompareFile = useStore((s) => s.selectCompareFile)
  const selectedFile = useStore((s) => s.selectedFile)
  const commits = useStore((s) => s.commits)
  const base = commits.find((c) => c.hash === detail.base)
  const target = commits.find((c) => c.hash === detail.target)

  return (
    <>
      <div className="detail-meta compare-meta">
        <div className="compare-title">Comparing commits</div>
        <div className="compare-row">
          <span className="ref-badge tag">{detail.base.slice(0, 7)}</span>
          <span className="compare-subject">{base?.subject ?? ''}</span>
        </div>
        <div className="compare-arrow">↓ changes ↓</div>
        <div className="compare-row">
          <span className="ref-badge head">{detail.target.slice(0, 7)}</span>
          <span className="compare-subject">{target?.subject ?? ''}</span>
        </div>
        <div className="compare-count">
          {detail.files.length} file{detail.files.length === 1 ? '' : 's'} changed
        </div>
      </div>
      <div className="file-list">
        {detail.files.map((f) => {
          const active = selectedFile?.kind === 'compare' && selectedFile.path === f.path
          return (
            <div
              key={f.path}
              className={'file-row' + (active ? ' selected' : '')}
              onClick={() => selectCompareFile(f.path)}
              title={f.origPath ? `${f.origPath} \u2192 ${f.path}` : f.path}
            >
              <span className={'st ' + f.status}>{statusLetter(f.status)}</span>
              <span className="path">{f.path}</span>
            </div>
          )
        })}
        {!detail.files.length && (
          <div className="side-empty">No differences between these commits</div>
        )}
      </div>
    </>
  )
}

export function HistoryView() {
  const commits = useStore((s) => s.commits)
  const branches = useStore((s) => s.branches)
  const selected = useStore((s) => s.selectedCommit)
  const compareCommit = useStore((s) => s.compareCommit)
  const compareDetail = useStore((s) => s.compareDetail)
  const selectCommit = useStore((s) => s.selectCommit)
  const toggleCompareCommit = useStore((s) => s.toggleCompareCommit)
  const detail = useStore((s) => s.commitDetail)
  const historyQuery = useStore((s) => s.historyQuery)
  const setHistoryQuery = useStore((s) => s.setHistoryQuery)
  const historyBranch = useStore((s) => s.historyBranch)
  const setHistoryBranch = useStore((s) => s.setHistoryBranch)
  const checkout = useStore((s) => s.checkoutBranch)
  const merge = useStore((s) => s.mergeBranch)
  const rebaseOnto = useStore((s) => s.rebaseOnto)
  const revert = useStore((s) => s.revertCommit)
  const cherryPick = useStore((s) => s.cherryPick)
  const copySha = useStore((s) => s.copySha)

  const [menu, setMenu] = useState<{ x: number; y: number; hash: string } | null>(null)
  const [branchAt, setBranchAt] = useState<string | null>(null)
  const [resetAt, setResetAt] = useState<string | null>(null)

  const locals = branches.filter((b) => !b.isRemote)
  const remoteBranches = branches.filter((b) => b.isRemote)

  const onRowClick = (e: MouseEvent, hash: string): void => {
    if (e.ctrlKey || e.metaKey) toggleCompareCommit(hash)
    else selectCommit(hash)
  }

  const filtered = useMemo(() => {
    const q = historyQuery.trim().toLowerCase()
    if (!q) return commits
    return commits.filter(
      (c) =>
        c.hash.toLowerCase().includes(q) ||
        c.subject.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q)
    )
  }, [commits, historyQuery])

  const rows = useMemo(() => buildGraph(filtered), [filtered])
  const graphWidth = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.maxLane), 1) * LANE_W + 6,
    [rows]
  )

  const commitMenu = (hash: string): MenuItem[] => {
    const short = hash.slice(0, 7)
    return [
      {
        label: 'Checkout…',
        onClick: () => {
          if (confirm(`Check out ${short}? This leaves HEAD detached.`)) checkout(hash)
        }
      },
      { label: 'Merge into Current Branch', onClick: () => merge(hash) },
      {
        label: 'Rebase Current Branch onto…',
        onClick: () => {
          if (confirm(`Rebase the current branch onto ${short}?`)) rebaseOnto(hash)
        }
      },
      { label: 'Branch…', onClick: () => setBranchAt(hash) },
      { separator: true },
      {
        label: 'Cherry Pick',
        onClick: () => {
          if (confirm(`Cherry-pick ${short} onto the current branch?`)) cherryPick(hash)
        }
      },
      {
        label: 'Revert Commit',
        onClick: () => {
          if (confirm(`Revert ${short}? This adds a new commit undoing its changes.`)) revert(hash)
        }
      },
      {
        label: 'Reset Current Branch to This Commit…',
        danger: true,
        onClick: () => setResetAt(hash)
      },
      { separator: true },
      { label: 'Copy SHA to Clipboard', onClick: () => copySha(hash) }
    ]
  }

  return (
    <div className="history">
      <div className="history-bar">
        <div className="history-search-wrap">
          <input
            className="history-search"
            type="text"
            placeholder="Search by SHA, message, or author…"
            value={historyQuery}
            onChange={(e) => setHistoryQuery(e.target.value)}
          />
          {historyQuery && (
            <button
              className="history-clear"
              title="Clear search"
              onClick={() => setHistoryQuery('')}
            >
              ✕
            </button>
          )}
        </div>
        <select
          className="branch-filter"
          value={historyBranch}
          onChange={(e) => setHistoryBranch(e.target.value)}
          title="Show history for a specific branch"
        >
          <option value="">All branches</option>
          {locals.length > 0 && (
            <optgroup label="Local">
              {locals.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          )}
          {remoteBranches.length > 0 && (
            <optgroup label="Remote">
              {remoteBranches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      <div className="commit-scroll">
        {filtered.length ? (
          <table className="commit-table">
            <tbody>
              {filtered.map((c, i) => (
                <tr
                  key={c.hash}
                  className={
                    'commit-row' +
                    (c.hash === selected ? ' selected' : '') +
                    (c.hash === compareCommit ? ' compare' : '')
                  }
                  onClick={(e) => onRowClick(e, c.hash)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenu({ x: e.clientX, y: e.clientY, hash: c.hash })
                  }}
                >
                  <td className="col-graph" style={{ width: graphWidth }}>
                    <GraphCell row={rows[i]} width={graphWidth} />
                  </td>
                  <td className="col-msg">
                    <div className="msg-wrap">
                      {refBadges(c.refs).map((b, bi) => (
                        <span key={bi} className={'ref-badge ' + b.type}>
                          {b.name}
                        </span>
                      ))}
                      <span className="msg-text">{c.subject}</span>
                    </div>
                  </td>
                  <td className="col-author">{c.author}</td>
                  <td className="col-date" title={fullDate(c.date)}>
                    {relativeTime(c.date)}
                  </td>
                  <td className="col-hash">{c.shortHash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="placeholder">
            {commits.length ? 'No commits match your search' : 'No commits to display'}
          </div>
        )}
      </div>
      <div className="detail-split">
        <div className="detail-left">
          {compareDetail ? (
            <CompareMeta detail={compareDetail} />
          ) : detail ? (
            <CommitMeta detail={detail} />
          ) : (
            <div className="placeholder">
              Select a commit to see details. Ctrl+click a second commit to compare.
            </div>
          )}
        </div>
        <DiffViewer />
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={commitMenu(menu.hash)}
          onClose={() => setMenu(null)}
        />
      )}
      {branchAt && <BranchAtDialog hash={branchAt} onClose={() => setBranchAt(null)} />}
      {resetAt && <ResetDialog hash={resetAt} onClose={() => setResetAt(null)} />}
    </div>
  )
}

function BranchAtDialog({ hash, onClose }: { hash: string; onClose: () => void }) {
  const [name, setName] = useState('')
  const [checkoutNew, setCheckoutNew] = useState(true)
  const createBranch = useStore((s) => s.createBranch)
  const busy = useStore((s) => s.busy)

  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    const ok = await createBranch(name.trim(), checkoutNew, hash)
    if (ok) onClose()
  }

  return (
    <Modal
      title={`New Branch at ${hash.slice(0, 7)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!name.trim() || !!busy} onClick={submit}>
            Create Branch
          </button>
        </>
      }
    >
      <label>
        Branch name
        <input
          type="text"
          autoFocus
          value={name}
          placeholder="feature/my-change"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={checkoutNew}
          onChange={(e) => setCheckoutNew(e.target.checked)}
        />
        Check out new branch
      </label>
    </Modal>
  )
}

function ResetDialog({ hash, onClose }: { hash: string; onClose: () => void }) {
  const [mode, setMode] = useState<ResetMode>('mixed')
  const resetTo = useStore((s) => s.resetTo)
  const busy = useStore((s) => s.busy)

  const submit = async (): Promise<void> => {
    await resetTo(hash, mode)
    onClose()
  }

  return (
    <Modal
      title={`Reset Current Branch to ${hash.slice(0, 7)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" disabled={!!busy} onClick={submit}>
            Reset
          </button>
        </>
      }
    >
      <p className="modal-note">Moves the current branch tip to this commit.</p>
      <label className="radio">
        <input
          type="radio"
          name="reset-mode"
          checked={mode === 'soft'}
          onChange={() => setMode('soft')}
        />
        <span>
          <b>Soft</b> — keep working tree and index (changes stay staged)
        </span>
      </label>
      <label className="radio">
        <input
          type="radio"
          name="reset-mode"
          checked={mode === 'mixed'}
          onChange={() => setMode('mixed')}
        />
        <span>
          <b>Mixed</b> — keep working tree, reset index (changes unstaged)
        </span>
      </label>
      <label className="radio">
        <input
          type="radio"
          name="reset-mode"
          checked={mode === 'hard'}
          onChange={() => setMode('hard')}
        />
        <span>
          <b>Hard</b> — discard all working tree changes
        </span>
      </label>
    </Modal>
  )
}
