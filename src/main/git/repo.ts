import { promises as fs } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { runGit, gitOk } from './run'
import * as P from './parsers'
import type {
  BranchInfo,
  CommitDetail,
  CommitInfo,
  CompareDetail,
  FetchOptions,
  FileDiff,
  PullOptions,
  PushOptions,
  RemoteInfo,
  ResetMode,
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
  const res = await gitOk(path, ['status', '--porcelain=v2', '--branch'])
  return P.parseStatus(res.stdout)
}

export async function log(path: string, limit = 500, ref?: string): Promise<CommitInfo[]> {
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

export async function cherryPick(path: string, hash: string): Promise<void> {
  await gitOk(path, ['cherry-pick', hash])
}

export async function restoreFileFromCommit(
  path: string,
  hash: string,
  file: string
): Promise<void> {
  await gitOk(path, ['checkout', hash, '--', file])
}
