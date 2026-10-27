import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, isAbsolute, resolve } from 'node:path'
import { runGit, gitOk } from './run'
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
// large histories. History, tags and branches are pure functions of the refs
// (plus, for branches, the upstream config), so they are cached against a
// cheap fingerprint of every ref and reused until something actually moves.

interface RefsState {
  /** Changes whenever HEAD or any ref (branch, remote, tag, stash…) moves. */
  fp: string
  /** Short name of the checked-out branch; null when detached. */
  headBranch: string | null
  /** False when git could not read the refs, so nothing should be cached. */
  cacheable: boolean
}

interface RefCache {
  fp: string
  logs: Map<string, CommitInfo[]>
  tags?: TagInfo[]
  branches?: { stamp: string; data: BranchInfo[] }
}

const MAX_CACHED_REPOS = 50
const refCaches = new Map<string, RefCache>()

/** Cached results for exactly these refs, if any. */
function cached(path: string, refs: RefsState): RefCache | undefined {
  const c = refCaches.get(path)
  return refs.cacheable && c?.fp === refs.fp ? c : undefined
}

/** Results computed during one refresh, waiting to be written to the cache. */
type Pending = ((c: RefCache) => void)[]

/**
 * Stores freshly computed results, but only once the refs are confirmed not to
 * have moved while git was running — otherwise the output could describe a
 * newer state than the fingerprint it would be filed under. Runs in the
 * background so the caller never waits on the extra check.
 */
function commitPending(path: string, refs: RefsState, pending: Pending): void {
  if (!pending.length || !refs.cacheable) return
  void readRefs(path).then((now) => {
    if (!now.cacheable || now.fp !== refs.fp) return
    let c = refCaches.get(path)
    if (!c || c.fp !== now.fp) {
      c = { fp: now.fp, logs: new Map() }
      refCaches.delete(path)
      refCaches.set(path, c)
      if (refCaches.size > MAX_CACHED_REPOS) {
        refCaches.delete(refCaches.keys().next().value as string)
      }
    }
    for (const put of pending) put(c)
  })
}

async function readRefs(path: string): Promise<RefsState> {
  const [sym, refs] = await Promise.all([
    // Exits 1 on a detached HEAD; works on an unborn branch, unlike rev-parse.
    runGit(path, ['symbolic-ref', '-q', 'HEAD']),
    // Exits 1 when there are no refs at all (fresh repository).
    runGit(path, ['show-ref', '--head'])
  ])
  const symName = sym.code === 0 ? sym.stdout.trim() : ''
  return {
    fp: symName + '\n' + refs.stdout,
    headBranch: symName.startsWith('refs/heads/') ? symName.slice('refs/heads/'.length) : null,
    cacheable: (sym.code === 0 || sym.code === 1) && (refs.code === 0 || refs.code === 1)
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
 * file). Upstream tracking lives there, so it versions the branch list.
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

async function logWithRefs(
  path: string,
  limit: number,
  ref: string | undefined,
  refs: RefsState,
  pending: Pending
): Promise<CommitInfo[]> {
  const key = `${limit}\0${ref ?? ''}`
  const hit = cached(path, refs)?.logs.get(key)
  if (hit) return hit
  const commits = await rawLog(path, limit, ref)
  pending.push((c) => c.logs.set(key, commits))
  return commits
}

async function tagsWithRefs(path: string, refs: RefsState, pending: Pending): Promise<TagInfo[]> {
  const hit = cached(path, refs)?.tags
  if (hit) return hit
  const data = await tags(path)
  pending.push((c) => (c.tags = data))
  return data
}

async function branchesWithRefs(
  path: string,
  refs: RefsState,
  pending: Pending
): Promise<BranchInfo[]> {
  const stamp = refs.cacheable ? await configStamp(path) : null
  const hit = cached(path, refs)?.branches
  if (stamp && hit?.stamp === stamp) return hit.data
  const data = await branches(path)
  if (stamp) pending.push((c) => (c.branches = { stamp, data }))
  return data
}

/**
 * Everything a full refresh needs, gathered in one round trip with every git
 * call running in parallel. With `followHead` the history follows the
 * checked-out branch (falling back to `ref` on a detached HEAD); the resolved
 * ref is returned as `historyBranch`. Submodules are deliberately excluded:
 * `git submodule status` can take seconds, so callers load it separately.
 */
export async function snapshot(
  path: string,
  ref: string | undefined,
  followHead: boolean,
  limit = 500
): Promise<RepoSnapshot> {
  const attempt = async <T>(fn: () => Promise<T>, fallback: T): Promise<[T, string | null]> => {
    try {
      return [await fn(), null]
    } catch (e) {
      return [fallback, String((e as Error)?.message || e)]
    }
  }
  const statusP = attempt<StatusResult | null>(() => status(path), null)
  const stashesP = attempt(() => stashes(path), [] as StashInfo[])
  const remotesP = attempt(() => remotes(path), [] as RemoteInfo[])
  const refs = await readRefs(path)
  const historyBranch = followHead && refs.headBranch ? refs.headBranch : (ref ?? '')
  const pending: Pending = []
  const [st, lg, br, sh, rm, tg] = await Promise.all([
    statusP,
    attempt(
      () => logWithRefs(path, limit, historyBranch || undefined, refs, pending),
      [] as CommitInfo[]
    ),
    attempt(() => branchesWithRefs(path, refs, pending), [] as BranchInfo[]),
    stashesP,
    remotesP,
    attempt(() => tagsWithRefs(path, refs, pending), [] as TagInfo[])
  ])
  commitPending(path, refs, pending)
  const error = [st, lg, br, sh, rm, tg].map(([, e]) => e).find((e) => e) ?? null
  return {
    status: st[0],
    historyBranch,
    commits: lg[0],
    branches: br[0],
    stashes: sh[0],
    remotes: rm[0],
    tags: tg[0],
    error
  }
}

export async function log(path: string, limit = 500, ref?: string): Promise<CommitInfo[]> {
  const refs = await readRefs(path)
  const pending: Pending = []
  const commits = await logWithRefs(path, limit, ref, refs, pending)
  commitPending(path, refs, pending)
  return commits
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
