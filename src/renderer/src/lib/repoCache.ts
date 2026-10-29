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
  /** Main's key for `commits`, so an unchanged history isn't re-sent; '' = unknown. */
  logKey: string
  branches: BranchInfo[]
  stashes: StashInfo[]
  remotes: RemoteInfo[]
  tags: TagInfo[]
  submodules: SubmoduleInfo[]
  remoteTags: string[] | null
  /** When remoteTags was last read from the remote (epoch ms); 0 = never. */
  remoteTagsAt: number
  /** When this was last read from git (epoch ms); 0 = never. */
  at: number
}

// Only the most recently opened repositories are written to disk: they are
// the likeliest to be shown at startup or switched to soon after.
const PERSIST_COUNT = 10
const PERSIST_DELAY_MS = 1000
const LEGACY_STORAGE_KEY = 'repoSnapshot.v1'

const entries = new Map<string, RepoCacheEntry>()
/** Paths in order of last being opened, most recent first. */
let recent: string[] = []
let persistTimer: ReturnType<typeof setTimeout> | undefined

export function getCachedRepo(path: string): RepoCacheEntry | undefined {
  return entries.get(path)
}

/** Records that `path` was opened, which decides what is persisted. */
export function touchCachedRepo(path: string): void {
  recent = [path, ...recent.filter((p) => p !== path)]
}

export function putCachedRepo(path: string, entry: RepoCacheEntry): void {
  entries.set(path, entry)
  if (recent.slice(0, PERSIST_COUNT).includes(path)) schedulePersist()
}

export function dropCachedRepo(path: string): void {
  entries.delete(path)
  recent = recent.filter((p) => p !== path)
  schedulePersist()
}

function schedulePersist(): void {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    const saved = recent
      .filter((p) => entries.has(p))
      .slice(0, PERSIST_COUNT)
      .map((p) => ({ path: p, entry: entries.get(p) }))
    void window.api.saveRepoCache({ version: 2, entries: saved }).catch(() => undefined)
  }, PERSIST_DELAY_MS)
}

function validEntry(entry: Partial<RepoCacheEntry> | undefined): RepoCacheEntry | null {
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
  if (!lists.every(Array.isArray) || !statusOk) return null
  return {
    ...(entry as RepoCacheEntry),
    historyBranch: typeof entry?.historyBranch === 'string' ? entry.historyBranch : '',
    logKey: typeof entry?.logKey === 'string' ? entry.logKey : '',
    remoteTags: Array.isArray(entry?.remoteTags) ? entry.remoteTags : null,
    // Re-check the remote once per session rather than trusting a day-old answer.
    remoteTagsAt: 0,
    at: typeof entry?.at === 'number' ? entry.at : 0
  }
}

/** Seeds the cache with the snapshots saved by the previous session, if usable. */
export async function loadPersistedRepos(): Promise<void> {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // Storage unavailable: nothing to clean up.
  }
  try {
    const data = (await window.api.loadRepoCache()) as {
      version?: unknown
      entries?: { path?: unknown; entry?: Partial<RepoCacheEntry> }[]
    } | null
    if (data?.version !== 2 || !Array.isArray(data.entries)) return
    for (const item of data.entries) {
      const entry = validEntry(item?.entry)
      if (typeof item?.path !== 'string' || !entry || entries.has(item.path)) continue
      entries.set(item.path, entry)
      recent.push(item.path)
    }
  } catch {
    // Corrupt or from an incompatible version: ignore it, a refresh rebuilds it.
  }
}
