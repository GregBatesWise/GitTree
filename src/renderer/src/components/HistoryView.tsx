import { useMemo, type MouseEvent } from 'react'
import { useStore } from '../store'
import { buildGraph, LANE_COLORS, type GraphRow } from '../lib/graph'
import { fullDate, relativeTime } from '../lib/format'
import { DiffViewer } from './DiffViewer'
import type { CommitDetail, CompareDetail, FileChange } from '@shared/types'

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
  const c = detail.commit

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
          const active =
            selectedFile?.kind === 'commit' && selectedFile.path === f.path
          return (
            <div
              key={f.path}
              className={'file-row' + (active ? ' selected' : '')}
              onClick={() => selectCommitFile(f.path)}
              title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
            >
              <span className={'st ' + f.status}>{statusLetter(f.status)}</span>
              <span className="path">{f.path}</span>
            </div>
          )
        })}
        {!detail.files.length && <div className="side-empty">No file changes</div>}
      </div>
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
  const selected = useStore((s) => s.selectedCommit)
  const compareCommit = useStore((s) => s.compareCommit)
  const compareDetail = useStore((s) => s.compareDetail)
  const selectCommit = useStore((s) => s.selectCommit)
  const toggleCompareCommit = useStore((s) => s.toggleCompareCommit)
  const detail = useStore((s) => s.commitDetail)

  const onRowClick = (e: MouseEvent, hash: string): void => {
    if (e.ctrlKey || e.metaKey) toggleCompareCommit(hash)
    else selectCommit(hash)
  }

  const rows = useMemo(() => buildGraph(commits), [commits])
  const graphWidth = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.maxLane), 1) * LANE_W + 6,
    [rows]
  )

  if (!commits.length) {
    return <div className="placeholder">No commits in this repository yet</div>
  }

  return (
    <div className="history">
      <div className="commit-scroll">
        <table className="commit-table">
          <tbody>
            {commits.map((c, i) => (
              <tr
                key={c.hash}
                className={
                  'commit-row' +
                  (c.hash === selected ? ' selected' : '') +
                  (c.hash === compareCommit ? ' compare' : '')
                }
                onClick={(e) => onRowClick(e, c.hash)}
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
    </div>
  )
}
