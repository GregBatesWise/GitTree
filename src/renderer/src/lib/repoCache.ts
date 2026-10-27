import type {
  BranchInfo,
  CommitInfo,
  RemoteInfo,
  StashInfo,
  StatusResult,
  SubmoduleInfo,
  TagInfo
} from '@shared/types'

/**
 * The last-known view of a repository, kept so switching back to it (or
 * reopening the app on it) paints immediately while a background refresh
 * brings it up to date — stale-while-revalidate.
 */
export interface RepoCacheEntry {
  status: StatusResult | null
  /** The ref `commits` was read for while following the checked-out branch. */
  historyBranch: string
  commits: CommitInfo[]
  branches: BranchInfo[]
  stashes: StashInfo[]
  remotes: RemoteInfo[]
  tags: TagInfo[]
  submodules: SubmoduleInfo[]
  remoteTags: string[] | null
  /** When remoteTags was last read from the remote (epoch ms); 0 = never. */
  remoteTagsAt: number
}

// Only the most recently active repository is written to disk: it is the one
// shown at startup, and keeping just one keeps us far inside the storage quota.
const STORAGE_KEY = 'repoSnapshot.v1'
const PERSIST_DELAY_MS = 1000

const entries = new Map<string, RepoCacheEntry>()
let persistTimer: ReturnType<typeof setTimeout> | undefined

export function getCachedRepo(path: string): RepoCacheEntry | undefined {
  return entries.get(path)
}

export function putCachedRepo(path: string, entry: RepoCacheEntry): void {
  entries.set(path, entry)
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    const e = entries.get(path)
    if (!e) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ path, entry: e }))
    } catch {
      // Over quota or storage unavailable: startup just won't have a head start.
    }
  }, PERSIST_DELAY_MS)
}

export function dropCachedRepo(path: string): void {
  entries.delete(path)
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw && (JSON.parse(raw) as { path?: unknown }).path === path) {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY)
  }
}

/** Seeds the cache with the snapshot saved by the previous session, if usable. */
export function loadPersistedRepo(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const { path, entry } = JSON.parse(raw) as { path?: unknown; entry?: Partial<RepoCacheEntry> }
    const lists = [
      entry?.commits,
      entry?.branches,
      entry?.stashes,
      entry?.remotes,
      entry?.tags,
      entry?.submodules
    ]
    const statusOk =
      entry?.status === null ||
      (Array.isArray(entry?.status?.staged) && Array.isArray(entry?.status?.unstaged))
    if (typeof path !== 'string' || !lists.every(Array.isArray) || !statusOk) return
    entries.set(path, {
      ...(entry as RepoCacheEntry),
      historyBranch: typeof entry?.historyBranch === 'string' ? entry.historyBranch : '',
      remoteTags: Array.isArray(entry?.remoteTags) ? entry.remoteTags : null,
      // Re-check the remote once per session rather than trusting a day-old answer.
      remoteTagsAt: 0
    })
  } catch {
    // Corrupt or from an incompatible version: ignore it, a refresh rebuilds it.
  }
}
