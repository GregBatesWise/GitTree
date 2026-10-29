import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, isAbsolute, resolve } from 'node:path'
import { runGit, gitOk, onRepoWrite } from './run'
import * as P from './parsers'
import type {
  ApplyPatchOptions,
  BranchInfo,
  CommitDetail,
  CommitInfo,
  CompareDetail,
  FetchOptions,
  FileDiff,
  GroupRepoResult,
  PullOptions,
  PushOptions,
  RemoteInfo,
  RepoSnapshot,
  ResetMode,
  StashDetail,
  StashInfo,
  StatusResult,
  SubmoduleInfo,
  TagInfo
} from '../../shared/types'

export async function isGitRepo(path: string): Promise<boolean> {
  const res = await runGit(path, ['rev-parse', '--is-inside-work-tree'])
  return res.code === 0 && res.stdout.trim() === 'true'
}

export async function repoName(path: string): Promise<string> {
  const res = await runGit(path, ['rev-parse', '--show-toplevel'])
  const top = res.stdout.trim() || path
  return top.split(/[\\/]/).filter(Boolean).pop() || top
}

export async function status(path: string): Promise<StatusResult> {
  // --untracked-files=all lists new files individually instead of collapsing a
  // brand-new directory to a single entry, so added files always show up.
  const res = await gitOk(path, [
    'status',
    '--porcelain=v2',
    '--branch',
    '--untracked-files=all'
  ])
  return P.parseStatus(res.stdout)
}

// --- Caching --------------------------------------------------------------
//
// Spawning git is the dominant cost of a refresh (tens of ms per process on
// Windows before git does any work), and `log --all --topo-order` gets slow on
// large histories. One for-each-ref pass yields branches, tags and the exact
// tip of every ref; history is then logged from those tips, so it is a pure
// function of them and can be cached under a key built from them. A watcher
// on the git directory lets an unchanged repository skip even that pass.

interface Refs {
  /** Short name of the checked-out branch; null when detached. */
  headBranch: string | null
  /** What `log --all` would start from: a detached HEAD, then every ref tip. */
  tips: string[]
  /** Every ref name and target plus HEAD: what the log's decorations show. */
  names: string
  /** Object id by full refname and by short name (branches win over tags). */
  byName: Map<string, string>
  stashOid: string | null
  branches: BranchInfo[]
  tags: TagInfo[]
  readAt: number
}

const gitDirs = new Map<string, Promise<string | null>>()

/** The `.git` directory for `path`, or null when it isn't a plain directory (linked worktree). */
function gitDir(path: string): Promise<string | null> {
  let found = gitDirs.get(path)
  if (!found) {
    found = (async () => {
      const top = await topLevel(path)
      if (!top) return null
      try {
        const dir = join(top, '.git')
        return (await fs.stat(dir)).isDirectory() ? dir : null
      } catch {
        return null
      }
    })()
    gitDirs.set(path, found)
    void found.then((dir) => {
      if (!dir) gitDirs.delete(path)
    })
  }
  return found
}

/** HEAD's symbolic ref (null when detached) and, when detached, its commit. */
async function readHead(
  path: string,
  dir: string | null
): Promise<{ symref: string | null; detached: string | null }> {
  if (dir) {
    try {
      const text = (await fs.readFile(join(dir, 'HEAD'), 'utf8')).trim()
      // Reftable repositories park a placeholder here; ask git instead.
      if (text.startsWith('ref: ') && text !== 'ref: refs/heads/.invalid') {
        return { symref: text.slice(5).trim(), detached: null }
      }
      if (/^[0-9a-f]{40,64}$/i.test(text)) return { symref: null, detached: text }
    } catch {
      // Fall through to git.
    }
  }
  const [sym, rev] = await Promise.all([
    // Exits 1 on a detached HEAD; works on an unborn branch, unlike rev-parse.
    runGit(path, ['symbolic-ref', '-q', 'HEAD']),
    runGit(path, ['rev-parse', '-q', '--verify', 'HEAD'])
  ])
  if (sym.code === 0) return { symref: sym.stdout.trim(), detached: null }
  return { symref: null, detached: rev.code === 0 ? rev.stdout.trim() : null }
}

async function readRefs(path: string, dir: string | null): Promise<Refs> {
  const [head, res] = await Promise.all([
    readHead(path, dir),
    runGit(path, ['for-each-ref', `--format=${P.REFS_FORMAT}`])
  ])
  if (res.code !== 0) throw new Error(res.stderr.trim() || 'git for-each-ref failed')
  const parsed = P.parseRefs(res.stdout)
  const tips = new Set<string>()
  if (head.detached) tips.add(head.detached)
  const byName = new Map<string, string>()
  let stashOid: string | null = null
  for (const r of parsed.refs) {
    tips.add(r.objectname)
    byName.set(r.refname, r.objectname)
    // Sorted by refname, so heads precede remotes precede tags — git's own precedence.
    if (!byName.has(r.short)) byName.set(r.short, r.objectname)
    if (r.refname === 'refs/stash') stashOid = r.objectname
  }
  const symref = head.symref
  return {
    headBranch: symref?.startsWith('refs/heads/') ? symref.slice('refs/heads/'.length) : null,
    tips: [...tips],
    names: [
      `HEAD ${symref ?? head.detached ?? ''}`,
      ...parsed.refs.map((r) => `${r.refname} ${r.objectname}`)
    ].join('\n'),
    byName,
    stashOid,
    branches: parsed.branches,
    tags: parsed.tags,
    readAt: Date.now()
  }
}

interface Watch {
  watcher: FSWatcher
  /** Set when anything ref-related changed since the refs were last read. */
  dirty: boolean
}

const MAX_WATCHED = 30
// A safety net in case a change notification is ever missed.
const REFS_MAX_AGE_MS = 2 * 60 * 1000
const watches = new Map<string, Watch>()
const lastRefs = new Map<string, Refs>()

function isRefFile(name: string): boolean {
  const n = name.replace(/\\/g, '/')
  return (
    n === 'HEAD' ||
    n === 'packed-refs' ||
    n === 'config' ||
    n.startsWith('refs/') ||
    n.startsWith('reftable/') ||
    n.startsWith('logs/refs/stash')
  )
}

function forgetWatch(path: string): void {
  watches.get(path)?.watcher.close()
  watches.delete(path)
  lastRefs.delete(path)
}

function watchRefs(path: string, dir: string): Watch | null {
  const existing = watches.get(path)
  if (existing) {
    watches.delete(path)
    watches.set(path, existing)
    return existing
  }
  try {
    const entry: Watch = { watcher: null as unknown as FSWatcher, dirty: true }
    entry.watcher = watch(dir, { recursive: true }, (_event, name) => {
      if (!name || isRefFile(String(name))) entry.dirty = true
    })
    entry.watcher.on('error', () => forgetWatch(path))
    watches.set(path, entry)
    if (watches.size > MAX_WATCHED) forgetWatch(watches.keys().next().value as string)
    return entry
  } catch {
    return null
  }
}

// Commands the app runs itself can finish before their change notification
// arrives, so a refresh straight after must not trust the watcher.
onRepoWrite((cwd) => {
  const w = watches.get(cwd)
  if (w) w.dirty = true
})

/** The repository's refs, re-read only when the watcher saw something change. */
async function currentRefs(path: string): Promise<Refs> {
  const dir = await gitDir(path)
  const w = dir ? watchRefs(path, dir) : null
  const last = lastRefs.get(path)
  if (w && !w.dirty && last && Date.now() - last.readAt < REFS_MAX_AGE_MS) return last
  if (w) w.dirty = false
  try {
    const refs = await readRefs(path, dir)
    if (w && watches.get(path) === w) lastRefs.set(path, refs)
    return refs
  } catch (e) {
    if (w) w.dirty = true
    throw e
  }
}

const topLevels = new Map<string, Promise<string | null>>()

/** Working-tree root containing `path`, found by looking for `.git` rather than spawning git. */
function topLevel(path: string): Promise<string | null> {
  let found = topLevels.get(path)
  if (!found) {
    found = (async () => {
      let dir = resolve(path)
      for (;;) {
        try {
          await fs.stat(join(dir, '.git'))
          return dir
        } catch {
          const up = dirname(dir)
          if (up === dir) return null
          dir = up
        }
      }
    })()
    topLevels.set(path, found)
    // Don't remember a miss: the folder may simply not exist yet.
    void found.then((top) => {
      if (!top) topLevels.delete(path)
    })
  }
  return found
}

/**
 * Identifies the current contents of the repository's config file, or null
 * when it can't be located cheaply (e.g. a linked worktree, whose `.git` is a
 * file). Remotes live there, so it versions the remote list.
 */
async function configStamp(path: string): Promise<string | null> {
  const top = await topLevel(path)
  if (!top) return null
  try {
    const st = await fs.stat(join(top, '.git', 'config'))
    return `${st.mtimeMs}:${st.size}`
  } catch {
    return null
  }
}

interface LogEntry {
  key: string
  /** Null when the caller already holds the history for `key`. */
  commits: CommitInfo[] | null
}

const MAX_LOGS_PER_REPO = 4
const MAX_LOG_REPOS = 50
const logCaches = new Map<string, { key: string; commits: CommitInfo[] }[]>()

/**
 * History from exactly the given tips. The key covers everything the output
 * depends on (tips, limit, and the ref names shown as decorations), so the
 * renderer can skip receiving — and main skip computing — a list it already has.
 */
async function logFromTips(
  path: string,
  limit: number,
  tips: string[],
  refs: Refs,
  known?: string
): Promise<LogEntry> {
  const key = createHash('sha1')
    .update(`${limit}\n${tips.join('\n')}\n\n${refs.names}`)
    .digest('hex')
    .slice(0, 16)
  if (key === known) return { key, commits: null }
  const hit = logCaches.get(path)?.find((e) => e.key === key)
  if (hit) return hit
  const entry = { key, commits: tips.length ? await logStdin(path, limit, tips) : [] }
  const next = [entry, ...(logCaches.get(path) ?? []).filter((e) => e.key !== key)]
  logCaches.delete(path)
  logCaches.set(path, next.slice(0, MAX_LOGS_PER_REPO))
  if (logCaches.size > MAX_LOG_REPOS) logCaches.delete(logCaches.keys().next().value as string)
  return entry
}

async function logStdin(path: string, limit: number, tips: string[]): Promise<CommitInfo[]> {
  const res = await runGit(
    path,
    ['log', '--stdin', '--topo-order', `--pretty=format:${P.LOG_FORMAT}`, '-n', String(limit)],
    tips.join('\n') + '\n'
  )
  if (res.code !== 0) return []
  return P.parseLog(res.stdout)
}

/** History for `ref` (every ref when empty); key is '' when it can't be cached. */
async function logWithRefs(
  path: string,
  limit: number,
  ref: string | undefined,
  refs: Refs,
  known?: string
): Promise<LogEntry> {
  if (!ref) return logFromTips(path, limit, refs.tips, refs, known)
  const oid = refs.byName.get(ref)
  if (oid) return logFromTips(path, limit, [oid], refs, known)
  // Not a ref name (a hash, `HEAD~3`, …): nothing to key it on.
  return { key: '', commits: await rawLog(path, limit, ref) }
}

const stashCaches = new Map<string, { stamp: string; data: StashInfo[] }>()

async function stashesWithRefs(path: string, refs: Refs): Promise<StashInfo[]> {
  if (!refs.stashOid) {
    stashCaches.delete(path)
    return []
  }
  const dir = await gitDir(path)
  if (!dir) return stashes(path)
  let stamp = refs.stashOid
  try {
    const st = await fs.stat(join(dir, 'logs', 'refs', 'stash'))
    stamp += `:${st.mtimeMs}:${st.size}`
  } catch {
    // Reflog missing: the oid alone still versions the newest entry.
  }
  const hit = stashCaches.get(path)
  if (hit?.stamp === stamp) return hit.data
  const data = await stashes(path)
  stashCaches.set(path, { stamp, data })
  return data
}

const remoteCaches = new Map<string, { stamp: string; data: RemoteInfo[] }>()

async function remotesCached(path: string): Promise<RemoteInfo[]> {
  const stamp = await configStamp(path)
  const hit = remoteCaches.get(path)
  if (stamp && hit?.stamp === stamp) return hit.data
  const data = await remotes(path)
  if (stamp) remoteCaches.set(path, { stamp, data })
  return data
}

/**
 * Everything a full refresh needs except status (fetched separately so it can
 * paint first). With `followHead` the history follows the checked-out branch
 * (falling back to `ref` on a detached HEAD); the resolved ref is returned as
 * `historyBranch`. When the history's key equals `knownLogKey`, `commits` is
 * null and the caller keeps the list it has. Submodules are deliberately
 * excluded: `git submodule status` can take seconds, so callers load it separately.
 */
export async function snapshot(
  path: string,
  ref: string | undefined,
  followHead: boolean,
  knownLogKey?: string,
  limit = 500
): Promise<RepoSnapshot> {
  const attempt = async <T>(fn: () => Promise<T>, fallback: T): Promise<[T, string | null]> => {
    try {
      return [await fn(), null]
    } catch (e) {
      return [fallback, String((e as Error)?.message || e)]
    }
  }
  const remotesP = attempt(() => remotesCached(path), [] as RemoteInfo[])
  const [refs, refsError] = await attempt<Refs | null>(() => currentRefs(path), null)
  if (!refs) {
    return {
      historyBranch: ref ?? '',
      commits: [],
      logKey: '',
      branches: [],
      stashes: [],
      remotes: (await remotesP)[0],
      tags: [],
      error: refsError
    }
  }
  const historyBranch = followHead && refs.headBranch ? refs.headBranch : (ref ?? '')
  const [lg, sh, rm] = await Promise.all([
    attempt(() => logWithRefs(path, limit, historyBranch || undefined, refs, knownLogKey), {
      key: '',
      commits: [] as CommitInfo[] | null
    }),
    attempt(() => stashesWithRefs(path, refs), [] as StashInfo[]),
    remotesP
  ])
  const error = [lg, sh, rm].map(([, e]) => e).find((e) => e) ?? null
  return {
    historyBranch,
    commits: lg[0].commits,
    logKey: lg[0].key,
    branches: refs.branches,
    stashes: sh[0],
    remotes: rm[0],
    tags: refs.tags,
    error
  }
}

export async function log(path: string, limit = 500, ref?: string): Promise<CommitInfo[]> {
  const refs = await currentRefs(path)
  return (await logWithRefs(path, limit, ref, refs)).commits ?? []
}

async function rawLog(path: string, limit: number, ref?: string): Promise<CommitInfo[]> {
  const scope = ref && ref.trim() ? [ref] : ['--all']
  const res = await runGit(path, [
    'log',
    ...scope,
    '--topo-order',
    `--pretty=format:${P.LOG_FORMAT}`,
    '-n',
    String(limit)
  ])
  // A repository with no commits yet exits non-zero; treat as empty history.
  if (res.code !== 0) return []
  return P.parseLog(res.stdout)
}

/** Searches every commit on every ref by SHA prefix, message or author. */
export async function searchLog(path: string, query: string): Promise<CommitInfo[]> {
  const q = query.trim()
  if (!q) return []
  const base = [
    'log',
    '--all',
    '--topo-order',
    '--regexp-ignore-case',
    '--fixed-strings',
    `--pretty=format:${P.LOG_FORMAT}`
  ]
  // git ANDs --grep with --author, so each needs its own walk.
  const runs = [runGit(path, [...base, `--grep=${q}`]), runGit(path, [...base, `--author=${q}`])]
  // Direct lookup also finds commits no ref reaches (e.g. dropped stashes, rewritten history).
  const isSha = /^[0-9a-f]{4,40}$/i.test(q)
  if (isSha) runs.unshift(runGit(path, ['log', '--no-walk', `--pretty=format:${P.LOG_FORMAT}`, q, '--']))
  const results = await Promise.all(runs)
  const shaHits = isSha && results[0].code === 0 ? P.parseLog(results[0].stdout) : []
  const seen = new Set(shaHits.map((c) => c.hash))
  const rest: CommitInfo[] = []
  for (const r of isSha ? results.slice(1) : results) {
    if (r.code !== 0) continue
    for (const c of P.parseLog(r.stdout)) {
      if (seen.has(c.hash)) continue
      seen.add(c.hash)
      rest.push(c)
    }
  }
  rest.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  return [...shaHits, ...rest]
}

export async function branches(path: string): Promise<BranchInfo[]> {
  const fmt = [
    '%(HEAD)',
    '%(refname)',
    '%(refname:short)',
    '%(upstream:short)',
    '%(upstream:track)'
  ].join('\t')
  const res = await gitOk(path, ['for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes'])
  return P.parseBranches(res.stdout)
}

export async function stashes(path: string): Promise<StashInfo[]> {
  const res = await runGit(path, ['stash', 'list', '--pretty=format:%gd%x1f%s'])
  if (res.code !== 0) return []
  return P.parseStashes(res.stdout)
}

export async function remotes(path: string): Promise<RemoteInfo[]> {
  const res = await runGit(path, ['remote', '-v'])
  if (res.code !== 0) return []
  return P.parseRemotes(res.stdout)
}

export async function tags(path: string): Promise<TagInfo[]> {
  const res = await runGit(path, [
    'for-each-ref',
    '--sort=-creatordate',
    `--format=${P.TAG_FORMAT}`,
    'refs/tags'
  ])
  if (res.code !== 0) return []
  return P.parseTags(res.stdout)
}

export async function submodules(path: string): Promise<SubmoduleInfo[]> {
  // `git submodule status` costs well over a second on Windows (it starts a
  // shell script) and, without a .gitmodules, just fails. Skip it outright.
  const top = await topLevel(path)
  if (top) {
    try {
      await fs.stat(join(top, '.gitmodules'))
    } catch {
      return []
    }
  }
  const res = await runGit(path, ['submodule', 'status'])
  if (res.code !== 0) return []
  return P.parseSubmodules(res.stdout)
}

export async function diffWorkingFile(
  path: string,
  file: string,
  staged: boolean,
  untracked: boolean
): Promise<FileDiff> {
  if (untracked) {
    const res = await runGit(path, ['diff', '--no-index', '--', '/dev/null', file])
    if (res.stdout.trim()) return P.parseDiff(file, res.stdout)
    // Fallback for platforms where --no-index against /dev/null yields nothing.
    try {
      const abs = isAbsolute(file) ? file : join(path, file)
      const content = await fs.readFile(abs, 'utf8')
      return P.syntheticAddedDiff(file, content)
    } catch {
      return { path: file, binary: false, hunks: [] }
    }
  }
  const args = staged ? ['diff', '--cached', '--', file] : ['diff', '--', file]
  const res = await runGit(path, args)
  return P.parseDiff(file, res.stdout)
}

export async function commitDetail(path: string, hash: string): Promise<CommitDetail> {
  const info = await gitOk(path, ['show', '--no-patch', `--pretty=format:${P.LOG_FORMAT}`, hash])
  const commit = P.parseLog(info.stdout)[0]
  const fres = await runGit(path, [
    'show',
    '--name-status',
    '--first-parent',
    '-M',
    '--pretty=format:',
    hash
  ])
  const files = P.parseNameStatus(fres.stdout)
  return { commit, files }
}

export async function commitFileDiff(
  path: string,
  hash: string,
  file: string
): Promise<FileDiff> {
  const res = await runGit(path, ['show', '--first-parent', '-M', '--format=', hash, '--', file])
  return P.parseDiff(file, res.stdout)
}

export async function compareDetail(
  path: string,
  base: string,
  target: string
): Promise<CompareDetail> {
  const res = await runGit(path, ['diff', '--name-status', '-M', base, target])
  return { base, target, files: P.parseNameStatus(res.stdout) }
}

export async function compareFileDiff(
  path: string,
  base: string,
  target: string,
  file: string
): Promise<FileDiff> {
  const res = await runGit(path, ['diff', '-M', base, target, '--', file])
  return P.parseDiff(file, res.stdout)
}

export async function stashFiles(path: string, ref: string): Promise<StashDetail> {
  // -u includes untracked files captured by `git stash push -u`.
  const res = await runGit(path, ['stash', 'show', '-u', '--name-status', '-M', ref])
  if (res.code !== 0) return { ref, files: [] }
  return { ref, files: P.parseNameStatus(res.stdout) }
}

export async function stashFileDiff(
  path: string,
  ref: string,
  file: string
): Promise<FileDiff> {
  // Tracked changes live between the stash base (^1) and the stash commit.
  const tracked = await runGit(path, ['diff', `${ref}^1`, ref, '--', file])
  if (tracked.stdout.trim()) return P.parseDiff(file, tracked.stdout)
  // Untracked files (stashed with -u) live in the third parent (^3).
  const untracked = await runGit(path, ['diff', `${ref}^1`, `${ref}^3`, '--', file])
  if (untracked.stdout.trim()) return P.parseDiff(file, untracked.stdout)
  return { path: file, binary: false, hunks: [] }
}

export async function stage(path: string, files: string[]): Promise<void> {
  await gitOk(path, ['add', '--', ...files])
}

export async function unstage(path: string, files: string[]): Promise<void> {
  await gitOk(path, ['restore', '--staged', '--', ...files])
}

export async function stageAll(path: string): Promise<void> {
  await gitOk(path, ['add', '-A'])
}

export async function unstageAll(path: string): Promise<void> {
  await gitOk(path, ['reset'])
}

export async function discard(path: string, files: string[]): Promise<void> {
  // Restore tracked files from HEAD and remove untracked ones. Individual
  // commands may fail depending on whether a file is tracked; ignore those.
  await runGit(path, ['checkout', '--', ...files])
  await runGit(path, ['clean', '-f', '--', ...files])
}

export async function applyPatch(
  path: string,
  patch: string,
  opts: ApplyPatchOptions
): Promise<void> {
  const tmp = join(tmpdir(), `gittree-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`)
  await fs.writeFile(tmp, patch, 'utf8')
  try {
    const args = ['apply', '--recount', '--whitespace=nowarn']
    if (opts.cached) args.push('--cached')
    if (opts.reverse) args.push('--reverse')
    args.push('--', tmp)
    await gitOk(path, args)
  } finally {
    await fs.rm(tmp, { force: true })
  }
}

export async function commit(path: string, message: string, amend: boolean): Promise<void> {
  const args = ['commit', '-m', message]
  if (amend) args.push('--amend')
  await gitOk(path, args)
}

export async function checkout(path: string, name: string): Promise<void> {
  await gitOk(path, ['checkout', name])
}

export async function createBranch(
  path: string,
  name: string,
  checkoutNew: boolean,
  startPoint?: string
): Promise<void> {
  if (checkoutNew) {
    await gitOk(path, ['checkout', '-b', name, ...(startPoint ? [startPoint] : [])])
  } else {
    await gitOk(path, ['branch', name, ...(startPoint ? [startPoint] : [])])
  }
}

export async function merge(path: string, name: string): Promise<void> {
  await gitOk(path, ['merge', name])
}

export async function deleteBranch(path: string, name: string, force: boolean): Promise<void> {
  await gitOk(path, ['branch', force ? '-D' : '-d', name])
}

export async function renameBranch(
  path: string,
  oldName: string,
  newName: string
): Promise<void> {
  await gitOk(path, ['branch', '-m', oldName, newName])
}

export async function push(path: string, opts: PushOptions): Promise<void> {
  const args = ['push']
  if (opts.force) args.push('--force-with-lease')
  if (opts.setUpstream) args.push('-u')
  if (opts.remote) args.push(opts.remote)
  if (opts.branch) args.push(opts.branch)
  await gitOk(path, args)
}

export async function pull(path: string, opts: PullOptions): Promise<void> {
  const args = ['pull']
  if (opts.rebase) args.push('--rebase')
  await gitOk(path, args)
}

export async function fetch(path: string, opts: FetchOptions): Promise<void> {
  const args = ['fetch', '--all']
  if (opts.prune) args.push('--prune')
  await gitOk(path, args)
}

export async function stashSave(
  path: string,
  message: string,
  includeUntracked: boolean
): Promise<void> {
  const args = ['stash', 'push']
  if (includeUntracked) args.push('-u')
  if (message) args.push('-m', message)
  await gitOk(path, args)
}

export async function stashApply(path: string, ref: string, pop: boolean): Promise<void> {
  await gitOk(path, ['stash', pop ? 'pop' : 'apply', ref])
}

export async function stashDrop(path: string, ref: string): Promise<void> {
  await gitOk(path, ['stash', 'drop', ref])
}

export async function addRemote(path: string, name: string, url: string): Promise<void> {
  await gitOk(path, ['remote', 'add', name, url])
}

export async function removeRemote(path: string, name: string): Promise<void> {
  await gitOk(path, ['remote', 'remove', name])
}

export async function createTag(
  path: string,
  name: string,
  ref: string | undefined,
  message: string | undefined
): Promise<void> {
  const args = ['tag']
  if (message && message.trim()) args.push('-a', '-m', message)
  args.push(name)
  if (ref) args.push(ref)
  await gitOk(path, args)
}

export async function deleteTag(path: string, name: string): Promise<void> {
  await gitOk(path, ['tag', '-d', name])
}

export async function pushTag(path: string, remote: string, name: string): Promise<void> {
  await gitOk(path, ['push', remote, `refs/tags/${name}`])
}

/** Tag names present on the remote (network call). */
export async function remoteTags(path: string, remote: string): Promise<string[]> {
  if (!remote || remote.startsWith('-')) throw new Error('Invalid remote')
  const res = await gitOk(path, ['ls-remote', '--tags', '--refs', remote])
  return res.stdout
    .split('\n')
    .map((l) => l.split('\t')[1]?.trim())
    .filter((r): r is string => !!r && r.startsWith('refs/tags/'))
    .map((r) => r.slice('refs/tags/'.length))
}

export async function submoduleUpdate(
  path: string,
  init: boolean,
  paths?: string[]
): Promise<void> {
  const args = ['submodule', 'update']
  if (init) args.push('--init')
  args.push('--recursive')
  if (paths && paths.length) args.push('--', ...paths)
  await gitOk(path, args)
}

export async function rebase(path: string, onto: string): Promise<void> {
  await gitOk(path, ['rebase', onto])
}

export async function revertCommit(path: string, hash: string): Promise<void> {
  await gitOk(path, ['revert', '--no-edit', hash])
}

export async function resetTo(path: string, hash: string, mode: ResetMode): Promise<void> {
  await gitOk(path, ['reset', `--${mode}`, hash])
}

/** `mainline` is required for merge commits: the 1-based parent to diff against. */
export async function cherryPick(path: string, hash: string, mainline?: number): Promise<void> {
  const args = ['cherry-pick']
  if (mainline !== undefined) {
    if (!Number.isInteger(mainline) || mainline < 1) throw new Error('Invalid mainline parent')
    args.push('-m', String(mainline))
  }
  await gitOk(path, [...args, hash])
}

export async function restoreFileFromCommit(
  path: string,
  hash: string,
  file: string
): Promise<void> {
  await gitOk(path, ['checkout', hash, '--', file])
}

/**
 * Resolves a conflicted file wholesale with one side's version and stages it.
 * "ours" is the current branch, "theirs" the incoming one (VS Code's Current /
 * Incoming). When that side deleted the file, resolving to it means removing it.
 */
export async function resolveConflict(
  path: string,
  file: string,
  side: 'ours' | 'theirs'
): Promise<void> {
  const res = await runGit(path, ['checkout', `--${side}`, '--', file])
  if (res.code === 0) {
    await gitOk(path, ['add', '--', file])
  } else if (/does not have (our|their) version/i.test(res.stderr)) {
    await gitOk(path, ['rm', '--quiet', '--', file])
  } else {
    throw new Error(res.stderr.trim() || `Could not resolve "${file}"`)
  }
}

async function refExists(path: string, ref: string): Promise<boolean> {
  const res = await runGit(path, ['rev-parse', '--verify', '--quiet', ref])
  return res.code === 0 && !!res.stdout.trim()
}

/** True when the branch exists on any remote, e.g. origin/vnext. */
async function remoteBranchExists(path: string, name: string): Promise<boolean> {
  const res = await runGit(path, [
    'for-each-ref',
    '--count=1',
    '--format=%(refname)',
    `refs/remotes/*/${name}`
  ])
  return res.code === 0 && !!res.stdout.trim()
}

/**
 * Why `base` -> pull -> new `branch` cannot run here, or null when it can.
 * Checked before touching any repository so a group either goes together or
 * not at all, and re-checked per repo at run time in case something changed.
 */
async function branchFlowBlocker(
  path: string,
  base: string,
  branch: string
): Promise<string | null> {
  if (!(await isGitRepo(path))) return 'Not a Git repository'
  const st = await status(path)
  const dirty = [...st.staged, ...st.unstaged].filter((f) => f.status !== 'untracked')
  if (dirty.length) {
    return `${dirty.length} uncommitted change${dirty.length === 1 ? '' : 's'} — commit or stash first`
  }
  if (await refExists(path, `refs/heads/${branch}`)) return `Branch "${branch}" already exists`
  const hasLocalBase = await refExists(path, `refs/heads/${base}`)
  const hasRemoteBase = await remoteBranchExists(path, base)
  if (!hasLocalBase && !hasRemoteBase) return `No branch "${base}" locally or on a remote`
  // A local base without an upstream would make the pull fail with "no tracking
  // information"; a remote-only base gets one when checkout creates it.
  if (hasLocalBase && !(await refExists(path, `${base}@{upstream}`))) {
    return `"${base}" has no upstream branch to pull from`
  }
  return null
}

/** Dry run of createGroupBranch across a group's repositories. */
export async function checkGroupBranch(
  paths: string[],
  base: string,
  branch: string
): Promise<GroupRepoResult[]> {
  return Promise.all(
    paths.map(async (path) => {
      try {
        const blocker = await branchFlowBlocker(path, base, branch)
        return blocker
          ? { path, ok: false, message: blocker }
          : { path, ok: true, message: `Ready — will branch from "${base}"` }
      } catch (e) {
        return { path, ok: false, message: String((e as Error)?.message || e) }
      }
    })
  )
}

/** Checks out `base`, fast-forwards it, then creates `branch` in each repository. */
export async function createGroupBranch(
  paths: string[],
  base: string,
  branch: string
): Promise<GroupRepoResult[]> {
  const results: GroupRepoResult[] = []
  for (const path of paths) {
    try {
      const blocker = await branchFlowBlocker(path, base, branch)
      if (blocker) throw new Error(blocker)
      await gitOk(path, ['checkout', base])
      await gitOk(path, ['pull', '--ff-only'])
      await gitOk(path, ['checkout', '-b', branch])
      results.push({ path, ok: true, message: `Created "${branch}" from "${base}"` })
    } catch (e) {
      results.push({ path, ok: false, message: String((e as Error)?.message || e) })
    }
  }
  return results
}

/** Number of remotes that have a branch with this name (e.g. origin/vnext). */
async function remoteBranchCount(path: string, name: string): Promise<number> {
  const res = await runGit(path, ['for-each-ref', '--format=%(refname)', `refs/remotes/*/${name}`])
  if (res.code !== 0) return 0
  return res.stdout.split('\n').filter((l) => l.trim()).length
}

/**
 * Why the existing `branch` cannot be checked out here, or null when it can.
 * Unlike branchFlowBlocker the branch must already exist — locally, or on
 * exactly one remote (git then creates a local tracking branch automatically).
 */
async function checkoutFlowBlocker(path: string, branch: string): Promise<string | null> {
  if (!(await isGitRepo(path))) return 'Not a Git repository'
  const st = await status(path)
  if (st.branch === branch) return null
  const dirty = [...st.staged, ...st.unstaged].filter((f) => f.status !== 'untracked')
  if (dirty.length) {
    return `${dirty.length} uncommitted change${dirty.length === 1 ? '' : 's'} — commit or stash first`
  }
  if (await refExists(path, `refs/heads/${branch}`)) return null
  const remotes = await remoteBranchCount(path, branch)
  if (remotes === 1) return null
  if (remotes > 1) {
    return `Branch "${branch}" exists on ${remotes} remotes — check it out manually once so git knows which to track`
  }
  return `No branch "${branch}" locally or on a remote`
}

/** Dry run of checkoutGroupBranch across a group's repositories. */
export async function checkGroupCheckout(
  paths: string[],
  branch: string
): Promise<GroupRepoResult[]> {
  return Promise.all(
    paths.map(async (path) => {
      try {
        const blocker = await checkoutFlowBlocker(path, branch)
        if (blocker) return { path, ok: false, message: blocker }
        const st = await status(path)
        return st.branch === branch
          ? { path, ok: true, message: `Already on "${branch}"` }
          : { path, ok: true, message: `Ready — will check out "${branch}"` }
      } catch (e) {
        return { path, ok: false, message: String((e as Error)?.message || e) }
      }
    })
  )
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Whether each repository has an empty working directory and nothing left to
 * push: the current branch has an upstream and no local branch is ahead of its
 * upstream. Compares against the last-fetched remote state.
 */
export async function checkGroupClean(paths: string[]): Promise<GroupRepoResult[]> {
  return Promise.all(
    paths.map(async (path) => {
      try {
        if (!(await isGitRepo(path))) return { path, ok: false, message: 'Not a Git repository' }
        const [st, all] = await Promise.all([status(path), branches(path)])
        const problems: string[] = []
        const files = [...st.staged, ...st.unstaged]
        const untracked = files.filter((f) => f.status === 'untracked').length
        // A file can be both staged and modified; count it once.
        const changed = new Set(files.filter((f) => f.status !== 'untracked').map((f) => f.path))
        if (changed.size) problems.push(plural(changed.size, 'uncommitted change'))
        if (untracked) problems.push(plural(untracked, 'untracked file'))
        if (!st.branch) problems.push('Detached HEAD')
        for (const b of all) {
          if (b.isRemote) continue
          if (b.current && !b.upstream) problems.push(`"${b.name}" has never been pushed`)
          else if (b.current && b.gone) problems.push(`"${b.name}" upstream was deleted`)
          else if (b.ahead) {
            problems.push(`"${b.name}" has ${plural(b.ahead, 'unpushed commit')}`)
          }
        }
        if (problems.length) return { path, ok: false, message: problems.join(' · ') }
        const behind = st.behind ? ` (${st.behind} behind ${st.upstream})` : ''
        return { path, ok: true, message: `Clean — "${st.branch}" is pushed${behind}` }
      } catch (e) {
        return { path, ok: false, message: String((e as Error)?.message || e) }
      }
    })
  )
}

/** Checks out the already-existing `branch` in each repository. */
export async function checkoutGroupBranch(
  paths: string[],
  branch: string
): Promise<GroupRepoResult[]> {
  const results: GroupRepoResult[] = []
  for (const path of paths) {
    try {
      const blocker = await checkoutFlowBlocker(path, branch)
      if (blocker) throw new Error(blocker)
      const st = await status(path)
      if (st.branch === branch) {
        results.push({ path, ok: true, message: `Already on "${branch}"` })
      } else {
        await gitOk(path, ['checkout', branch])
        results.push({ path, ok: true, message: `Checked out "${branch}"` })
      }
    } catch (e) {
      results.push({ path, ok: false, message: String((e as Error)?.message || e) })
    }
  }
  return results
}
