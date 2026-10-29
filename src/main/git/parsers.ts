import type {
  BranchInfo,
  CommitInfo,
  DiffHunk,
  FileChange,
  FileDiff,
  FileStatus,
  RemoteInfo,
  StashInfo,
  StatusResult,
  SubmoduleInfo,
  SubmoduleState,
  TagInfo
} from '../../shared/types'

const SEP = '\x1f' // unit separator
const REC = '\x1e' // record separator

export const LOG_FORMAT =
  ['%H', '%h', '%P', '%an', '%ae', '%aI', '%s', '%b', '%D'].join(SEP) + REC

function codeToStatus(code: string): FileStatus {
  switch (code) {
    case 'M':
      return 'modified'
    case 'T':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case '?':
      return 'untracked'
    case 'U':
      return 'conflicted'
    default:
      return 'unknown'
  }
}

function makeChange(path: string, code: string, staged: boolean, orig?: string): FileChange {
  return {
    path,
    origPath: orig,
    index: staged ? code : '.',
    workingTree: staged ? '.' : code,
    staged,
    unstaged: !staged,
    status: codeToStatus(code)
  }
}

/** Returns the substring after the first `tokenCount` space-separated fields. */
function sliceAfter(line: string, tokenCount: number): string {
  let idx = 0
  let count = 0
  while (count < tokenCount && idx < line.length) {
    if (line[idx] === ' ') count++
    idx++
  }
  return line.substring(idx)
}

export function parseStatus(raw: string): StatusResult {
  const res: StatusResult = {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: []
  }
  for (const line of raw.split('\n')) {
    if (!line) continue
    if (line.startsWith('# branch.head')) {
      const v = line.substring('# branch.head'.length).trim()
      res.branch = v === '(detached)' ? null : v
    } else if (line.startsWith('# branch.upstream')) {
      res.upstream = line.substring('# branch.upstream'.length).trim()
    } else if (line.startsWith('# branch.ab')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) {
        res.ahead = Number(m[1])
        res.behind = Number(m[2])
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const renamed = line.startsWith('2 ')
      const xy = line.split(' ')[1] ?? '..'
      const X = xy[0]
      const Y = xy[1]
      let pathPart: string
      let orig: string | undefined
      if (renamed) {
        const rest = sliceAfter(line, 9)
        const tab = rest.indexOf('\t')
        pathPart = tab >= 0 ? rest.substring(0, tab) : rest
        orig = tab >= 0 ? rest.substring(tab + 1) : undefined
      } else {
        pathPart = sliceAfter(line, 8)
      }
      if (X !== '.') res.staged.push(makeChange(pathPart, X, true, orig))
      if (Y !== '.') res.unstaged.push(makeChange(pathPart, Y, false, orig))
    } else if (line.startsWith('u ')) {
      const rest = sliceAfter(line, 10)
      res.unstaged.push({
        path: rest,
        index: 'U',
        workingTree: 'U',
        staged: false,
        unstaged: true,
        status: 'conflicted'
      })
    } else if (line.startsWith('? ')) {
      const p = line.substring(2)
      res.unstaged.push({
        path: p,
        index: '?',
        workingTree: '?',
        staged: false,
        unstaged: true,
        status: 'untracked'
      })
    }
  }
  return res
}

export function parseLog(raw: string): CommitInfo[] {
  const commits: CommitInfo[] = []
  for (let rec of raw.split(REC)) {
    rec = rec.replace(/^\n/, '')
    if (!rec.trim()) continue
    const f = rec.split(SEP)
    if (f.length < 9) continue
    const parents = f[2].trim() ? f[2].trim().split(' ') : []
    const refs = f[8].trim()
      ? f[8]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
    commits.push({
      hash: f[0],
      shortHash: f[1],
      parents,
      author: f[3],
      authorEmail: f[4],
      date: f[5],
      subject: f[6],
      body: f[7].replace(/\n+$/, ''),
      refs
    })
  }
  return commits
}

export function parseBranches(raw: string): BranchInfo[] {
  const out: BranchInfo[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const [head, refname, short, upstream, track] = line.split('\t')
    const isRemote = refname.startsWith('refs/remotes/')
    if (isRemote && short.endsWith('/HEAD')) continue
    let ahead = 0
    let behind = 0
    let gone = false
    if (track) {
      const a = /ahead (\d+)/.exec(track)
      if (a) ahead = Number(a[1])
      const b = /behind (\d+)/.exec(track)
      if (b) behind = Number(b[1])
      // %(upstream:track) reports a deleted upstream as the literal '[gone]',
      // which matches neither count above.
      gone = /\[gone\]/.test(track)
    }
    out.push({
      name: short,
      current: head === '*',
      upstream: upstream || null,
      ahead,
      behind,
      isRemote,
      gone
    })
  }
  return out
}

export function parseStashes(raw: string): StashInfo[] {
  const out: StashInfo[] = []
  raw.split('\n').forEach((line, i) => {
    if (!line.trim()) return
    const [ref, msg] = line.split('\x1f')
    const message = msg || ''
    let branch: string | null = null
    let name = message
    // git's stash subject is 'WIP on <branch>: <sha> <subject>' when auto-named
    // and 'On <branch>: <message>' when created with -m. Anchored so a user
    // message that merely looks like a prefix can't be mistaken for one, and
    // [^:]+ stops at the first colon because refs cannot contain one — the rest
    // is kept whole, since both user messages and commit subjects may have colons.
    const m = /^(WIP on|On) ([^:]+): ?(.*)$/.exec(message)
    if (m) {
      branch = m[2]
      // The auto-named form prefixes the base commit's short sha; that's noise.
      const rest = m[1] === 'WIP on' ? m[3].replace(/^[0-9a-f]{7,40} /, '') : m[3]
      name = rest.trim() || message
    }
    out.push({ index: i, ref: ref || `stash@{${i}}`, message, name, branch })
  })
  return out
}

export function parseRemotes(raw: string): RemoteInfo[] {
  const map = new Map<string, RemoteInfo>()
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const m = /^(\S+)\t(.+) \((fetch|push)\)$/.exec(line)
    if (!m) continue
    const [, name, url, type] = m
    let r = map.get(name)
    if (!r) {
      r = { name, fetchUrl: '', pushUrl: '' }
      map.set(name, r)
    }
    if (type === 'fetch') r.fetchUrl = url
    else r.pushUrl = url
  }
  return [...map.values()]
}

export const TAG_FORMAT = [
  '%(refname:short)',
  '%(objecttype)',
  '%(objectname)',
  '%(*objectname)',
  '%(creatordate:iso-strict)',
  '%(contents:subject)',
  '%(*contents:subject)'
].join(SEP)

/** Every ref in one for-each-ref pass: enough for branches, tags and the stash. */
export const REFS_FORMAT =
  [
    '%(refname)',
    '%(objectname)',
    '%(HEAD)',
    '%(upstream:short)',
    '%(upstream:track)',
    TAG_FORMAT
  ].join(SEP) + REC

export interface RefEntry {
  refname: string
  short: string
  objectname: string
}

export interface ParsedRefs {
  refs: RefEntry[]
  branches: BranchInfo[]
  tags: TagInfo[]
}

export function parseRefs(raw: string): ParsedRefs {
  const refs: RefEntry[] = []
  const branchLines: string[] = []
  const tagLines: string[] = []
  for (let rec of raw.split(REC)) {
    rec = rec.replace(/^\n/, '')
    if (!rec) continue
    const f = rec.split(SEP)
    if (f.length < 12) continue
    const [refname, objectname, head, upstream, track] = f
    const tagFields = f.slice(5)
    refs.push({ refname, short: tagFields[0], objectname })
    if (refname.startsWith('refs/heads/') || refname.startsWith('refs/remotes/')) {
      branchLines.push([head, refname, tagFields[0], upstream, track].join('\t'))
    } else if (refname.startsWith('refs/tags/')) {
      // Subjects may contain anything but newlines, so a line per tag is safe.
      tagLines.push(tagFields.join(SEP))
    }
  }
  const tags = parseTags(tagLines.join('\n'))
  // Newest first, as `--sort=-creatordate` would give.
  const time = (t: TagInfo): number => (t.date ? Date.parse(t.date) || 0 : 0)
  tags.sort((a, b) => time(b) - time(a))
  return { refs, branches: parseBranches(branchLines.join('\n')), tags }
}

export function parseTags(raw: string): TagInfo[] {
  const out: TagInfo[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const [name, type, obj, derefObj, date, subj, derefSubj] = line.split(SEP)
    const annotated = type === 'tag'
    out.push({
      name,
      hash: annotated ? derefObj || obj : obj,
      annotated,
      subject: (annotated ? subj || derefSubj : subj) || '',
      date: date || null
    })
  }
  return out
}

export function parseSubmodules(raw: string): SubmoduleInfo[] {
  const out: SubmoduleInfo[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    const flag = line[0]
    const m = /^(\S+)\s+(.+?)(?:\s+\((.+)\))?$/.exec(line.slice(1))
    if (!m) continue
    const [, hash, path, describe] = m
    let state: SubmoduleState = 'initialized'
    if (flag === '-') state = 'uninitialized'
    else if (flag === '+') state = 'modified'
    else if (flag === 'U') state = 'conflict'
    out.push({
      name: path.split(/[\\/]/).filter(Boolean).pop() || path,
      path,
      hash,
      describe: describe || null,
      state
    })
  }
  return out
}

export function parseNameStatus(raw: string): FileChange[] {
  const out: FileChange[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    const code = parts[0][0]
    if ((code === 'R' || code === 'C') && parts.length >= 3) {
      out.push({
        path: parts[2],
        origPath: parts[1],
        index: code,
        workingTree: '.',
        staged: true,
        unstaged: false,
        status: code === 'R' ? 'renamed' : 'copied'
      })
    } else if (parts.length >= 2) {
      out.push(makeChange(parts[1], code, true))
    }
  }
  return out
}

export function parseDiff(path: string, raw: string): FileDiff {
  const text = raw.replace(/\n$/, '')
  const lines = text.split('\n')
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  let binary = false

  for (const line of lines) {
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('old mode') ||
      line.startsWith('new mode') ||
      line.startsWith('similarity ') ||
      line.startsWith('dissimilarity ') ||
      line.startsWith('rename ') ||
      line.startsWith('copy ') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file')
    ) {
      continue
    }
    if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) {
      binary = true
      continue
    }
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (m) {
        oldNo = Number(m[1])
        newNo = Number(m[2])
        current = { header: line, lines: [] }
        hunks.push(current)
      }
      continue
    }
    if (!current) continue
    if (line.startsWith('+')) {
      current.lines.push({ type: 'add', text: line.slice(1), oldNumber: null, newNumber: newNo++ })
    } else if (line.startsWith('-')) {
      current.lines.push({ type: 'del', text: line.slice(1), oldNumber: oldNo++, newNumber: null })
    } else if (line.startsWith('\\')) {
      current.lines.push({ type: 'meta', text: line.slice(2), oldNumber: null, newNumber: null })
    } else {
      const t = line.startsWith(' ') ? line.slice(1) : line
      current.lines.push({ type: 'context', text: t, oldNumber: oldNo++, newNumber: newNo++ })
    }
  }
  return { path, binary, hunks }
}

/** Builds an all-additions diff for an untracked file from its raw content. */
export function syntheticAddedDiff(path: string, content: string): FileDiff {
  const text = content.replace(/\n$/, '')
  const rows = text.length ? text.split('\n') : []
  const hunk: DiffHunk = {
    header: `@@ -0,0 +1,${rows.length} @@`,
    lines: rows.map((t, i) => ({
      type: 'add' as const,
      text: t,
      oldNumber: null,
      newNumber: i + 1
    }))
  }
  return { path, binary: false, hunks: rows.length ? [hunk] : [] }
}
