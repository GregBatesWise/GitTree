// Shared types used by main, preload and renderer.

export interface RepoBookmark {
  id: string
  name: string
  path: string
}

export interface CommitInfo {
  hash: string
  shortHash: string
  parents: string[]
  author: string
  authorEmail: string
  date: string // ISO 8601
  subject: string
  body: string
  refs: string[] // decorations, e.g. "HEAD -> main", "origin/main", "tag: v1.0"
}

export type FileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'
  | 'unknown'

export interface FileChange {
  path: string
  origPath?: string
  index: string // staged status code (X)
  workingTree: string // unstaged status code (Y)
  staged: boolean
  unstaged: boolean
  status: FileStatus
}

export interface StatusResult {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  staged: FileChange[]
  unstaged: FileChange[]
}

export interface BranchInfo {
  name: string
  current: boolean
  upstream: string | null
  ahead: number
  behind: number
  isRemote: boolean
}

export interface StashInfo {
  index: number
  ref: string // e.g. stash@{0}
  message: string
  branch: string | null
}

export interface RemoteInfo {
  name: string
  fetchUrl: string
  pushUrl: string
}

export type DiffLineType = 'context' | 'add' | 'del' | 'meta'

export interface DiffLine {
  type: DiffLineType
  text: string
  oldNumber: number | null
  newNumber: number | null
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface FileDiff {
  path: string
  binary: boolean
  hunks: DiffHunk[]
}

export interface CommitDetail {
  commit: CommitInfo
  files: FileChange[]
}

export interface CompareDetail {
  base: string // older commit
  target: string // newer commit
  files: FileChange[]
}

export interface PushOptions {
  remote?: string
  branch?: string
  setUpstream?: boolean
  force?: boolean
}

export interface PullOptions {
  rebase?: boolean
}

export interface FetchOptions {
  prune?: boolean
}

export interface GitResult<T = void> {
  ok: boolean
  data?: T
  error?: string
}
