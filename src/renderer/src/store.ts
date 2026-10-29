import { create } from 'zustand'
import { buildLinePatch } from './lib/patch'
import {
  dropCachedRepo,
  getCachedRepo,
  loadPersistedRepos,
  putCachedRepo,
  touchCachedRepo,
  type RepoCacheEntry
} from './lib/repoCache'
import type {
  BranchInfo,
  CommitDetail,
  CommitInfo,
  CompareDetail,
  DiffHunk,
  FileChange,
  FileDiff,
  GitResult,
  GroupRepoResult,
  RemoteInfo,
  RepoBookmark,
  RepoGroup,
  RepoSnapshot,
  ResetMode,
  StashDetail,
  StashInfo,
  StatusResult,
  SubmoduleInfo,
  TagInfo
} from '@shared/types'

const api = window.api

export type MainView = 'working' | 'history'

export interface FileSelection {
  kind: 'working' | 'commit' | 'compare' | 'stash'
  path: string
  staged: boolean
  untracked: boolean
}

/**
 * Lines picked out of a single hunk of the open working-copy diff, for staging
 * less than a whole hunk. Kept in the store rather than in DiffViewer so the
 * working-copy Space shortcut can act on it instead of staging whole files.
 *
 * `path`/`staged` identify the diff it was made against: hunk indices shift as
 * soon as the diff is reloaded, so consumers must check it still matches the
 * selected file, and every action that changes the index clears it.
 */
export interface LineSelection {
  path: string
  staged: boolean
  hunkIndex: number
  /** Indices into the hunk's `lines`, ascending. */
  lines: number[]
  /** Line the last plain click landed on, for shift-click ranges. */
  anchor: number
}

export interface AppState {
  repos: RepoBookmark[]
  groups: RepoGroup[]
  activeRepoPath: string | null
  /** Toolbar group filter for the repo picker; null shows every repository.
   *  Persisted via AppSettings.lastGroupId. */
  activeGroupId: string | null
  view: MainView

  status: StatusResult | null
  commits: CommitInfo[]
  /** Main's key for `commits`, so an unchanged history isn't re-sent; '' = unknown. */
  logKey: string
  branches: BranchInfo[]
  stashes: StashInfo[]
  remotes: RemoteInfo[]
  tags: TagInfo[]
  /** Tag names on the default remote; null = not known (no remote, offline, or not loaded yet). */
  remoteTags: string[] | null
  submodules: SubmoduleInfo[]

  historyBranch: string
  historyBranchAuto: boolean
  historyQuery: string
  /** Git-side matches for historyQuery across full history; null = not searched yet. */
  searchResults: CommitInfo[] | null

  selectedCommit: string | null
  commitDetail: CommitDetail | null
  compareCommit: string | null
  compareDetail: CompareDetail | null
  selectedStash: StashInfo | null
  stashDetail: StashDetail | null
  selectedFile: FileSelection | null
  diff: FileDiff | null
  diffLoading: boolean
  lineSelection: LineSelection | null

  /** Unsent commit messages, keyed by repo path. Held here rather than in
   *  CommitBox's local state so switching repo/view (which unmounts it) does
   *  not discard what the user has typed. In-memory only — not persisted. */
  commitDrafts: Record<string, string>

  /** Whether the group's feature id is appended to commit messages. Persisted
   *  via AppSettings; defaults to true. */
  appendFeatureId: boolean

  loading: boolean
  busy: string | null
  error: string | null
  toast: string | null

  init: () => Promise<void>
  selectRepo: (path: string) => Promise<void>
  addRepoViaDialog: () => Promise<void>
  removeRepo: (id: string) => Promise<void>
  reorderRepos: (ids: string[]) => Promise<void>
  loadGroups: () => Promise<void>
  createGroup: (name: string) => Promise<void>
  renameGroup: (id: string, name: string) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  /** Toggles one repository's membership of one group. A repository may belong
   *  to any number of groups at once. */
  setGroupMembership: (repoId: string, groupId: string, member: boolean) => Promise<void>
  /** Sets the toolbar group filter (null = All repos), keeping the working copy
   *  inside the newly selected group. */
  setActiveGroup: (groupId: string | null) => Promise<void>
  setGroupFeatureId: (id: string, featureId: string) => Promise<void>
  /** Dry run of createGroupBranch, so blockers show before anything is changed. */
  checkGroupBranch: (
    paths: string[],
    base: string,
    branch: string
  ) => Promise<GroupRepoResult[] | null>
  createGroupBranch: (
    paths: string[],
    base: string,
    branch: string
  ) => Promise<GroupRepoResult[] | null>
  /** Dry run of checkoutGroupBranch, so blockers show before anything is changed. */
  checkGroupCheckout: (paths: string[], branch: string) => Promise<GroupRepoResult[] | null>
  checkGroupClean: (paths: string[]) => Promise<GroupRepoResult[] | null>
  checkoutGroupBranch: (paths: string[], branch: string) => Promise<GroupRepoResult[] | null>
  refreshAll: () => Promise<void>
  refreshStatus: () => Promise<void>
  setView: (view: MainView) => void
  dismissError: () => void
  dismissToast: () => void

  selectCommit: (hash: string) => Promise<void>
  selectCommitFile: (path: string) => Promise<void>
  toggleCompareCommit: (hash: string) => Promise<void>
  selectCompareFile: (path: string) => Promise<void>
  selectWorkingFile: (file: FileChange) => Promise<void>
  selectStash: (stash: StashInfo) => Promise<void>
  selectStashFile: (path: string) => Promise<void>
  clearStash: () => void

  stageFiles: (paths: string[]) => Promise<void>
  unstageFiles: (paths: string[]) => Promise<void>
  stageAll: () => Promise<void>
  unstageAll: () => Promise<void>
  discardFiles: (paths: string[]) => Promise<void>
  /** `what` only names the unit in the status bar, e.g. 'hunk' or '3 lines'. */
  stageHunk: (patch: string, what?: string) => Promise<void>
  unstageHunk: (patch: string, what?: string) => Promise<void>
  discardHunk: (patch: string, what?: string) => Promise<void>
  setLineSelection: (selection: LineSelection | null) => void
  /** Stages the selected lines, or unstages them if picked on the staged side. */
  applyLineSelection: () => Promise<void>
  discardLineSelection: () => Promise<void>
  commit: (message: string, amend: boolean, push: boolean) => Promise<boolean>
  setCommitDraft: (message: string) => void
  setAppendFeatureId: (on: boolean) => void

  push: (setUpstream: boolean) => Promise<void>
  pull: () => Promise<void>
  fetch: () => Promise<void>

  checkoutBranch: (name: string) => Promise<void>
  createBranch: (name: string, checkoutNew: boolean, startPoint?: string) => Promise<boolean>
  mergeBranch: (name: string) => Promise<void>
  deleteBranch: (name: string, force: boolean) => Promise<boolean>
  renameBranch: (oldName: string, newName: string) => Promise<boolean>

  stashSave: (message: string, includeUntracked: boolean) => Promise<boolean>
  stashApply: (ref: string, pop: boolean) => Promise<void>
  stashDrop: (ref: string) => Promise<void>

  addRemote: (name: string, url: string) => Promise<boolean>
  removeRemote: (name: string) => Promise<void>

  createTag: (name: string, message: string, ref?: string) => Promise<boolean>
  deleteTag: (name: string) => Promise<void>
  pushTag: (name: string) => Promise<void>
  /** Reads which tags exist on the default remote (a network call). With
   *  `ifStale`, skips the call when a recent answer is already on screen. */
  loadRemoteTags: (opts?: { ifStale?: boolean }) => Promise<void>

  updateSubmodules: () => Promise<void>
  updateSubmodule: (path: string) => Promise<void>

  revealInFileManager: () => Promise<void>
  openInTerminal: () => Promise<void>
  /** Opens a working-copy file in the external editor (Notepad++ on Windows). */
  openFile: (file: string) => Promise<void>
  resolveInMergeTool: (file: string) => Promise<void>
  resolveConflict: (file: string, side: 'ours' | 'theirs') => Promise<void>

  setHistoryBranch: (ref: string) => Promise<void>
  setHistoryQuery: (query: string) => void
  rebaseOnto: (onto: string) => Promise<void>
  revertCommit: (hash: string) => Promise<void>
  resetTo: (hash: string, mode: ResetMode) => Promise<void>
  cherryPick: (hash: string, mainline?: number) => Promise<void>
  restoreFileFromCommit: (hash: string, file: string) => Promise<void>
  externalDiffCommit: (hash: string, file: string) => Promise<void>
  copySha: (hash: string) => Promise<void>
  copyText: (text: string) => Promise<void>
}

/**
 * The line selection, but only when it still describes the diff on screen.
 * Both the diff pane (highlighting, buttons) and the working-copy Space
 * shortcut go through this so they can never disagree about what is picked.
 */
export function activeLineSelection(
  s: Pick<AppState, 'lineSelection' | 'selectedFile' | 'diff'>
): LineSelection | null {
  const { lineSelection: ls, selectedFile: sel, diff } = s
  if (!ls || !diff || sel?.kind !== 'working') return null
  if (sel.path !== ls.path || sel.staged !== ls.staged) return null
  if (!ls.lines.length || !diff.hunks[ls.hunkIndex]) return null
  return ls
}

// Bumped by every status fetch; a fetch only publishes if it is still the latest,
// so a slow refreshAll can't overwrite a newer post-staging status.
let statusSeq = 0

let searchSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined

/** How long a remote-tags answer is trusted before switching back re-asks the remote. */
const REMOTE_TAGS_TTL_MS = 5 * 60_000

/**
 * Returns `prev` when `next` holds the same data, so a refresh that changed
 * nothing keeps every reference stable and React skips re-rendering (the
 * history table alone is hundreds of rows of SVG).
 */
function keep<T>(prev: T, next: T): T {
  if (prev === next) return prev
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next
}

// Background refresh of the other repositories, so switching to one paints
// data that is seconds old rather than from whenever it was last opened.
const PREFETCH_MAX = 20
const PREFETCH_FRESH_MS = 2 * 60_000
const PREFETCH_DELAY_MS = 1500
let prefetchRun = 0

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export const useStore = create<AppState>((set, get) => {
  /**
   * Records the active repository's on-screen data in the repo cache so the
   * next visit can paint it instantly. Only the auto-followed history is kept,
   * because selectRepo always restores the filter to the checked-out branch.
   */
  function remember(p: string, extra?: Partial<RepoCacheEntry>): void {
    const s = get()
    if (s.activeRepoPath !== p) return
    const prev = getCachedRepo(p)
    putCachedRepo(p, {
      status: s.status,
      historyBranch: s.historyBranchAuto ? s.historyBranch : (prev?.historyBranch ?? ''),
      commits: s.historyBranchAuto ? s.commits : (prev?.commits ?? []),
      logKey: s.historyBranchAuto ? s.logKey : (prev?.logKey ?? ''),
      branches: s.branches,
      stashes: s.stashes,
      remotes: s.remotes,
      tags: s.tags,
      submodules: s.submodules,
      remoteTags: s.remoteTags,
      remoteTagsAt: prev?.remoteTagsAt ?? 0,
      at: prev?.at ?? 0,
      ...extra
    })
  }

  /**
   * Refreshes the other repositories in the group filter (or all of them) one
   * at a time into the repo cache only, yielding to anything the user does.
   * A newer call supersedes an older one.
   */
  async function prefetchOthers(): Promise<void> {
    const run = ++prefetchRun
    await sleep(PREFETCH_DELAY_MS)
    const s = get()
    const group = s.groups.find((g) => g.id === s.activeGroupId)
    const pool = (group ? s.repos.filter((r) => group.repoIds.includes(r.id)) : s.repos).slice(
      0,
      PREFETCH_MAX
    )
    for (const { path } of pool) {
      while (get().busy || get().loading) {
        if (run !== prefetchRun) return
        await sleep(500)
      }
      if (run !== prefetchRun) return
      const c = getCachedRepo(path)
      if (path === get().activeRepoPath || (c && Date.now() - c.at < PREFETCH_FRESH_MS)) continue
      const [st, res] = await Promise.all([
        api.status(path),
        api.snapshot(path, undefined, true, c?.logKey)
      ])
      const snap = res.data as RepoSnapshot | undefined
      // The user may have opened it meanwhile; its live refresh owns the cache then.
      if (!st.ok || !res.ok || !snap || snap.error || path === get().activeRepoPath) continue
      const now = getCachedRepo(path)
      putCachedRepo(path, {
        status: st.data as StatusResult,
        historyBranch: snap.historyBranch,
        commits: snap.commits ?? now?.commits ?? [],
        logKey: snap.commits || now?.logKey === snap.logKey ? snap.logKey : '',
        branches: snap.branches,
        stashes: snap.stashes,
        remotes: snap.remotes,
        tags: snap.tags,
        submodules: now?.submodules ?? [],
        remoteTags: now?.remoteTags ?? null,
        remoteTagsAt: now?.remoteTagsAt ?? 0,
        at: Date.now()
      })
    }
  }

  /** Publishes fresh working-tree status, optionally re-loading the open diff. */
  async function loadStatus(p: string, reloadDiff: boolean): Promise<void> {
    const seq = ++statusSeq
    const st = await api.status(p)
    if (get().activeRepoPath !== p || seq !== statusSeq) return
    if (!st.ok) {
      set({ error: st.error || 'Failed to load status' })
      return
    }
    set({ status: keep(get().status, st.data as StatusResult) })
    remember(p)
    if (reloadDiff) await reloadOpenDiff(p)
  }

  /** Selects a working-copy file and shows its diff, optionally one already being loaded. */
  async function openWorkingFile(
    file: FileChange,
    pending?: Promise<GitResult<FileDiff>>
  ): Promise<void> {
    const p = get().activeRepoPath
    if (!p) return
    const untracked = file.status === 'untracked'
    set({
      selectedFile: { kind: 'working', path: file.path, staged: file.staged, untracked },
      diffLoading: true,
      diff: null,
      lineSelection: null
    })
    const res = await (pending ?? api.diffWorking(p, file.path, file.staged, untracked))
    set({ diff: res.ok ? (res.data as FileDiff) : null, diffLoading: false })
    if (!res.ok) set({ error: res.error || 'Failed to load diff' })
  }

  /**
   * Re-loads an open working-copy diff so it reflects the latest status. A line
   * selection indexes into the diff, so it is dropped unless the diff is
   * unchanged (e.g. a window-focus refresh where nothing was touched).
   */
  async function reloadOpenDiff(p: string): Promise<void> {
    const sel = get().selectedFile
    if (!sel || sel.kind !== 'working') return
    const st = get().status
    const all = [...(st?.staged ?? []), ...(st?.unstaged ?? [])]
    if (!all.some((f) => f.path === sel.path && f.staged === sel.staged)) {
      set({ selectedFile: null, diff: null, lineSelection: null })
      return
    }
    const d = await api.diffWorking(p, sel.path, sel.staged, sel.untracked)
    // The user may have moved on to another file or repository meanwhile.
    if (get().activeRepoPath !== p || get().selectedFile !== sel) return
    const prev = get().diff
    const diff = keep(prev, d.ok ? (d.data as FileDiff) : null)
    if (diff !== prev) set({ diff, lineSelection: null })
  }

  async function runSearch(): Promise<void> {
    const seq = ++searchSeq
    const p = get().activeRepoPath
    const q = get().historyQuery.trim()
    if (!p || !q) {
      set({ searchResults: null })
      return
    }
    const res = await api.searchLog(p, q)
    if (seq !== searchSeq || get().activeRepoPath !== p) return
    set({ searchResults: res.ok ? (res.data as CommitInfo[]) : null })
  }
  /** Resolves the current line selection into everything buildLinePatch needs. */
  function lineTarget(): {
    path: string
    staged: boolean
    hunk: DiffHunk
    lines: Set<number>
    what: string
  } | null {
    const ls = activeLineSelection(get())
    const diff = get().diff
    if (!ls || !diff) return null
    return {
      path: diff.path,
      staged: ls.staged,
      hunk: diff.hunks[ls.hunkIndex],
      lines: new Set(ls.lines),
      what: `${ls.lines.length} line${ls.lines.length === 1 ? '' : 's'}`
    }
  }

  async function runAction(
    label: string,
    fn: () => Promise<GitResult<unknown> | void>,
    successToast?: string
  ): Promise<boolean> {
    set({ busy: label, error: null })
    try {
      const res = await fn()
      if (res && (res as GitResult).ok === false) {
        set({ error: (res as GitResult).error || `${label} failed` })
        return false
      }
      if (successToast) set({ toast: successToast })
      return true
    } catch (e) {
      set({ error: String((e as Error)?.message || e) })
      return false
    } finally {
      set({ busy: null })
    }
  }

  return {
    repos: [],
    groups: [],
    activeRepoPath: null,
    activeGroupId: null,
    view: 'working',
    status: null,
    commits: [],
    logKey: '',
    branches: [],
    stashes: [],
    remotes: [],
    tags: [],
    remoteTags: null,
    submodules: [],
    historyBranch: '',
    historyBranchAuto: true,
    historyQuery: '',
    searchResults: null,
    selectedCommit: null,
    commitDetail: null,
    compareCommit: null,
    compareDetail: null,
    selectedStash: null,
    stashDetail: null,
    selectedFile: null,
    diff: null,
    diffLoading: false,
    lineSelection: null,
    commitDrafts: {},
    appendFeatureId: true,
    loading: false,
    busy: null,
    error: null,
    toast: null,

    init: async () => {
      const [repos, groups, settings] = await Promise.all([
        api.listRepos(),
        api.listGroups(),
        api.getSettings(),
        // Lets the last session's repositories paint before git answers.
        loadPersistedRepos()
      ])
      // Restore the group filter, dropping a stale id left by a deleted group.
      const activeGroupId = groups.some((g) => g.id === settings.lastGroupId)
        ? (settings.lastGroupId as string)
        : null
      // Undefined means the setting predates the checkbox: opt the user IN, as
      // the suffix has always been appended until now.
      set({ repos, groups, activeGroupId, appendFeatureId: settings.appendFeatureId !== false })
      if (repos.length) {
        // The last repo only wins when it is inside the restored group filter.
        const group = groups.find((g) => g.id === activeGroupId)
        const pool = group ? repos.filter((r) => group.repoIds.includes(r.id)) : repos
        const candidates = pool.length ? pool : repos
        const last = candidates.find((r) => r.path === settings.lastRepoPath)
        await get().selectRepo((last ?? candidates[0]).path)
      }
    },

    selectRepo: async (path) => {
      // A repository seen before paints from the cache straight away; the
      // refresh below then replaces it with live data.
      const cached = getCachedRepo(path)
      touchCachedRepo(path)
      set({
        activeRepoPath: path,
        // An action still running against the previous repo must not leave the
        // new repo's UI (commit box, dialogs) disabled once it finally lands.
        busy: null,
        selectedCommit: null,
        commitDetail: null,
        compareCommit: null,
        compareDetail: null,
        selectedStash: null,
        stashDetail: null,
        selectedFile: null,
        diff: null,
        status: cached?.status ?? null,
        commits: cached?.commits ?? [],
        logKey: cached?.logKey ?? '',
        branches: cached?.branches ?? [],
        stashes: cached?.stashes ?? [],
        remotes: cached?.remotes ?? [],
        tags: cached?.tags ?? [],
        remoteTags: cached?.remoteTags ?? null,
        submodules: cached?.submodules ?? [],
        historyBranch: cached?.historyBranch ?? '',
        historyBranchAuto: true,
        historyQuery: '',
        searchResults: null
      })
      // The group filter (lastGroupId) is owned by setActiveGroup, not by repo
      // selection — picking a repo no longer changes which group is filtered in.
      void api.setSettings({ lastRepoPath: path })
      await get().refreshAll()
      void get().loadRemoteTags({ ifStale: true })
      void prefetchOthers()
    },

    addRepoViaDialog: async () => {
      const folder = await api.openFolder()
      if (!folder) return
      const res = await api.addRepo(folder)
      if (!res.ok) {
        set({ error: res.error || 'Could not add repository' })
        return
      }
      const repos = await api.listRepos()
      set({ repos })
      if (res.data) await get().selectRepo(res.data.path)
    },

    removeRepo: async (id) => {
      await api.removeRepo(id)
      const repos = await api.listRepos()
      const removed = get().repos.find((r) => r.id === id)
      const wasActive = removed && removed.path === get().activeRepoPath
      const drafts = { ...get().commitDrafts }
      if (removed) {
        delete drafts[removed.path]
        dropCachedRepo(removed.path)
      }
      set({ repos, commitDrafts: drafts })
      await get().loadGroups()
      if (wasActive) {
        if (repos.length) {
          // Stay inside the group filter when it still has members.
          const group = get().groups.find((g) => g.id === get().activeGroupId)
          const pool = group ? repos.filter((r) => group.repoIds.includes(r.id)) : repos
          await get().selectRepo((pool[0] ?? repos[0]).path)
        } else
          set({
            activeRepoPath: null,
            status: null,
            commits: [],
            logKey: '',
            branches: [],
            stashes: [],
            remotes: [],
            tags: [],
            remoteTags: null,
            submodules: [],
            historyBranch: '',
            historyBranchAuto: true,
            historyQuery: '',
            searchResults: null,
            selectedCommit: null,
            commitDetail: null,
            compareCommit: null,
            compareDetail: null,
            selectedStash: null,
            stashDetail: null,
            selectedFile: null,
            diff: null
          })
      }
    },

    reorderRepos: async (ids) => {
      // Reflect the drop immediately so the row does not snap back while the
      // JSON store is written, then take main's authoritative order.
      const byId = new Map(get().repos.map((r) => [r.id, r]))
      const optimistic = ids.map((id) => byId.get(id)).filter((r): r is RepoBookmark => !!r)
      if (optimistic.length === get().repos.length) set({ repos: optimistic })
      set({ repos: await api.reorderRepos(ids) })
    },

    loadGroups: async () => {
      const groups = await api.listGroups()
      set({ groups })
    },

    createGroup: async (name) => {
      await api.createGroup(name)
      await get().loadGroups()
    },

    renameGroup: async (id, name) => {
      await api.renameGroup(id, name)
      await get().loadGroups()
    },

    deleteGroup: async (id) => {
      await api.deleteGroup(id)
      // Deleting the filtered group drops the filter back to All repos.
      if (get().activeGroupId === id) {
        set({ activeGroupId: null })
        void api.setSettings({ lastGroupId: undefined })
      }
      await get().loadGroups()
    },

    setGroupMembership: async (repoId, groupId, member) => {
      await api.setGroupMembership(repoId, groupId, member)
      await get().loadGroups()
    },

    setActiveGroup: async (groupId) => {
      const id = groupId && get().groups.some((g) => g.id === groupId) ? groupId : null
      set({ activeGroupId: id })
      void api.setSettings({ lastGroupId: id ?? undefined })
      if (!id) {
        void prefetchOthers()
        return
      }
      // Keep the working copy inside the group: when the current repository is
      // not a member, switch to the group's first repository.
      const group = get().groups.find((g) => g.id === id)
      const members = get().repos.filter((r) => group?.repoIds.includes(r.id))
      if (members.length && !members.some((r) => r.path === get().activeRepoPath)) {
        await get().selectRepo(members[0].path)
      } else {
        void prefetchOthers()
      }
    },

    setGroupFeatureId: async (id, featureId) => {
      await api.setGroupFeatureId(id, featureId)
      await get().loadGroups()
    },

    checkGroupBranch: async (paths, base, branch) => {
      set({ busy: 'Checking repositories', error: null })
      try {
        const res = await api.checkGroupBranch(paths, base, branch)
        if (!res.ok) {
          set({ error: res.error || 'Check failed' })
          return null
        }
        return res.data as GroupRepoResult[]
      } catch (e) {
        set({ error: String((e as Error)?.message || e) })
        return null
      } finally {
        set({ busy: null })
      }
    },

    createGroupBranch: async (paths, base, branch) => {
      set({ busy: `Creating ${branch}`, error: null })
      try {
        const res = await api.createGroupBranch(paths, base, branch)
        if (!res.ok) {
          set({ error: res.error || 'Create branch failed' })
          return null
        }
        const results = res.data as GroupRepoResult[]
        const done = results.filter((r) => r.ok).length
        if (done === results.length) {
          set({ toast: `Created ${branch} in ${done} repositor${done === 1 ? 'y' : 'ies'}` })
        }
        const active = get().activeRepoPath
        if (active && paths.includes(active)) await get().refreshAll()
        return results
      } catch (e) {
        set({ error: String((e as Error)?.message || e) })
        return null
      } finally {
        set({ busy: null })
      }
    },

    checkGroupClean: async (paths) => {
      set({ busy: 'Checking repositories', error: null })
      try {
        const res = await api.checkGroupClean(paths)
        if (!res.ok) {
          set({ error: res.error || 'Check failed' })
          return null
        }
        return res.data as GroupRepoResult[]
      } catch (e) {
        set({ error: String((e as Error)?.message || e) })
        return null
      } finally {
        set({ busy: null })
      }
    },

    checkGroupCheckout: async (paths, branch) => {
      set({ busy: 'Checking repositories', error: null })
      try {
        const res = await api.checkGroupCheckout(paths, branch)
        if (!res.ok) {
          set({ error: res.error || 'Check failed' })
          return null
        }
        return res.data as GroupRepoResult[]
      } catch (e) {
        set({ error: String((e as Error)?.message || e) })
        return null
      } finally {
        set({ busy: null })
      }
    },

    checkoutGroupBranch: async (paths, branch) => {
      set({ busy: `Checking out ${branch}`, error: null })
      try {
        const res = await api.checkoutGroupBranch(paths, branch)
        if (!res.ok) {
          set({ error: res.error || 'Checkout failed' })
          return null
        }
        const results = res.data as GroupRepoResult[]
        const done = results.filter((r) => r.ok).length
        if (done === results.length) {
          set({ toast: `Checked out ${branch} in ${done} repositor${done === 1 ? 'y' : 'ies'}` })
        }
        const active = get().activeRepoPath
        if (active && paths.includes(active)) await get().refreshAll()
        return results
      } catch (e) {
        set({ error: String((e as Error)?.message || e) })
        return null
      } finally {
        set({ busy: null })
      }
    },

    refreshAll: async () => {
      const p = get().activeRepoPath
      if (!p) return
      set({ loading: true })
      const seq = ++statusSeq
      const reqAuto = get().historyBranchAuto
      const reqBranch = get().historyBranch
      // Submodule status can take seconds, so it lands on its own rather than
      // holding up everything else.
      void api.submodules(p).then((sm) => {
        if (get().activeRepoPath !== p) return
        set({
          submodules: keep(get().submodules, sm.ok ? (sm.data as SubmoduleInfo[]) : []),
          ...(sm.ok || get().error ? {} : { error: sm.error || 'Failed to load submodules' })
        })
        remember(p)
      })
      // Status is fetched on its own so the working copy paints as soon as it lands.
      const statusP = api.status(p).then((st) => {
        if (get().activeRepoPath !== p || seq !== statusSeq) return false
        if (!st.ok) {
          set({ error: st.error || 'Failed to load status' })
          return false
        }
        set({ status: keep(get().status, st.data as StatusResult) })
        return true
      })
      // With auto on, main resolves the checked-out branch itself.
      const sentKey = get().logKey
      const res = await api.snapshot(p, reqBranch || undefined, reqAuto, sentKey)
      // The user can switch repo while this is in flight; publishing then
      // would overwrite the new repo's state with this one's.
      if (get().activeRepoPath !== p) return
      const s = get()
      if (!res.ok || !res.data) {
        set({ error: res.error || 'Failed to load repository' })
        await statusP
        if (get().activeRepoPath === p) set({ loading: false })
        return
      }
      const snap = res.data as RepoSnapshot
      // An explicit branch picked while this was running already loaded its own history.
      const historyCurrent =
        s.historyBranchAuto === reqAuto && (reqAuto || s.historyBranch === reqBranch)
      // Null commits mean "same as what you sent"; only valid if that is still what's shown.
      const history = !historyCurrent
        ? {}
        : snap.commits
          ? {
              historyBranch: snap.historyBranch,
              commits: keep(s.commits, snap.commits),
              logKey: snap.logKey
            }
          : s.logKey === sentKey
            ? { historyBranch: snap.historyBranch, logKey: snap.logKey }
            : {}
      set({
        ...history,
        branches: keep(s.branches, snap.branches),
        stashes: keep(s.stashes, snap.stashes),
        remotes: keep(s.remotes, snap.remotes),
        tags: keep(s.tags, snap.tags),
        error: snap.error ?? s.error
      })
      const fresh = await statusP
      if (get().activeRepoPath !== p) return
      set({ loading: false })
      remember(p, { at: Date.now() })
      if (get().historyQuery.trim()) void runSearch()
      if (!fresh) return
      await reloadOpenDiff(p)
    },

    // Lightweight refresh for staging operations: only the working-tree status
    // changes, so reloading commits/branches/stashes/tags/submodules (a much
    // heavier set of git calls) is unnecessary and makes staging feel sluggish.
    refreshStatus: async () => {
      const p = get().activeRepoPath
      if (!p) return
      await loadStatus(p, true)
    },

    setView: (view) =>
      set({
        view,
        compareCommit: null,
        compareDetail: null,
        selectedStash: null,
        stashDetail: null,
        selectedFile: null,
        diff: null
      }),

    dismissError: () => set({ error: null }),
    dismissToast: () => set({ toast: null }),

    selectCommit: async (hash) => {
      const p = get().activeRepoPath
      if (!p) return
      set({
        selectedCommit: hash,
        compareCommit: null,
        compareDetail: null,
        selectedFile: null,
        diff: null,
        commitDetail: null
      })
      const res = await api.commitFiles(p, hash)
      if (res.ok) set({ commitDetail: res.data as CommitDetail })
      else set({ error: res.error || 'Failed to load commit' })
    },

    selectCommitFile: async (path) => {
      const p = get().activeRepoPath
      const hash = get().selectedCommit
      if (!p || !hash) return
      set({
        selectedFile: { kind: 'commit', path, staged: false, untracked: false },
        diffLoading: true,
        diff: null
      })
      const res = await api.commitFileDiff(p, hash, path)
      set({ diff: res.ok ? (res.data as FileDiff) : null, diffLoading: false })
      if (!res.ok) set({ error: res.error || 'Failed to load diff' })
    },

    toggleCompareCommit: async (hash) => {
      const p = get().activeRepoPath
      if (!p) return
      const anchor = get().selectedCommit
      // With no anchor yet, Ctrl+click behaves like a normal selection.
      if (!anchor || anchor === hash) {
        await get().selectCommit(hash)
        return
      }
      // Clicking the current compare target again clears the comparison.
      if (get().compareCommit === hash) {
        set({ compareCommit: null, compareDetail: null, selectedFile: null, diff: null })
        await get().selectCommit(anchor)
        return
      }
      // Order base/target so the diff reads oldest -> newest. The commit list is
      // newest-first, so the higher index is the older commit.
      const commits = get().commits
      const ai = commits.findIndex((c) => c.hash === anchor)
      const bi = commits.findIndex((c) => c.hash === hash)
      const base = ai > bi ? anchor : hash
      const target = ai > bi ? hash : anchor
      set({
        compareCommit: hash,
        commitDetail: null,
        compareDetail: null,
        selectedFile: null,
        diff: null
      })
      const res = await api.compareFiles(p, base, target)
      if (res.ok) set({ compareDetail: res.data as CompareDetail })
      else set({ error: res.error || 'Failed to compare commits' })
    },

    selectCompareFile: async (path) => {
      const p = get().activeRepoPath
      const cd = get().compareDetail
      if (!p || !cd) return
      set({
        selectedFile: { kind: 'compare', path, staged: false, untracked: false },
        diffLoading: true,
        diff: null
      })
      const res = await api.compareFileDiff(p, cd.base, cd.target, path)
      set({ diff: res.ok ? (res.data as FileDiff) : null, diffLoading: false })
      if (!res.ok) set({ error: res.error || 'Failed to load diff' })
    },

    selectWorkingFile: async (file) => {
      await openWorkingFile(file)
    },

    selectStash: async (stash) => {
      const p = get().activeRepoPath
      if (!p) return
      set({
        selectedStash: stash,
        stashDetail: null,
        selectedCommit: null,
        commitDetail: null,
        compareCommit: null,
        compareDetail: null,
        selectedFile: null,
        diff: null
      })
      const res = await api.stashFiles(p, stash.ref)
      if (res.ok) {
        const detail = res.data as StashDetail
        set({ stashDetail: detail })
        if (detail.files.length) await get().selectStashFile(detail.files[0].path)
      } else {
        set({ error: res.error || 'Failed to load stash' })
      }
    },

    selectStashFile: async (path) => {
      const p = get().activeRepoPath
      const sd = get().stashDetail
      if (!p || !sd) return
      set({
        selectedFile: { kind: 'stash', path, staged: false, untracked: false },
        diffLoading: true,
        diff: null
      })
      const res = await api.stashFileDiff(p, sd.ref, path)
      set({ diff: res.ok ? (res.data as FileDiff) : null, diffLoading: false })
      if (!res.ok) set({ error: res.error || 'Failed to load diff' })
    },

    clearStash: () =>
      set({ selectedStash: null, stashDetail: null, selectedFile: null, diff: null }),

    stageFiles: async (paths) => {
      const p = get().activeRepoPath
      if (!p) return
      // Remember where a single staged file sat so we can select its successor.
      const before = get().status?.unstaged ?? []
      const idx = paths.length === 1 ? before.findIndex((f) => f.path === paths[0]) : -1
      // The successor (or, at the end, the predecessor) is almost always what
      // gets selected next; staging another file can't change its diff.
      const guess = idx >= 0 ? (before[idx + 1] ?? before[idx - 1]) : undefined
      if (await runAction('Staging', () => api.stage(p, paths))) {
        const guessDiff = guess
          ? api.diffWorking(p, guess.path, false, guess.status === 'untracked')
          : undefined
        // The staged file's own diff is about to be replaced, so don't reload it.
        await loadStatus(p, false)
        if (get().activeRepoPath !== p) return
        if (idx >= 0) {
          const after = get().status?.unstaged ?? []
          const next = after.length ? after[Math.min(idx, after.length - 1)] : null
          const hit = next && guess && next.path === guess.path && next.status === guess.status
          if (next) await openWorkingFile(next, hit ? guessDiff : undefined)
          else set({ selectedFile: null, diff: null })
        } else {
          set({ selectedFile: null, diff: null })
        }
      }
    },

    unstageFiles: async (paths) => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction('Unstaging', () => api.unstage(p, paths))) {
        set({ selectedFile: null, diff: null })
        await get().refreshStatus()
      }
    },

    stageAll: async () => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction('Staging all', () => api.stageAll(p))) {
        set({ selectedFile: null, diff: null })
        await get().refreshStatus()
      }
    },

    unstageAll: async () => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction('Unstaging all', () => api.unstageAll(p))) {
        set({ selectedFile: null, diff: null })
        await get().refreshStatus()
      }
    },

    discardFiles: async (paths) => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction('Discarding', () => api.discard(p, paths))) {
        set({ selectedFile: null, diff: null })
        await get().refreshStatus()
      }
    },

    // The three patch actions clear any line selection: it indexes into a diff
    // that is about to be reloaded, so its hunk/line numbers no longer hold.
    stageHunk: async (patch, what = 'hunk') => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction(`Staging ${what}`, () => api.applyPatch(p, patch, { cached: true }))) {
        set({ lineSelection: null })
        await get().refreshStatus()
      }
    },

    unstageHunk: async (patch, what = 'hunk') => {
      const p = get().activeRepoPath
      if (!p) return
      if (
        await runAction(`Unstaging ${what}`, () =>
          api.applyPatch(p, patch, { cached: true, reverse: true })
        )
      ) {
        set({ lineSelection: null })
        await get().refreshStatus()
      }
    },

    discardHunk: async (patch, what = 'hunk') => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction(`Discarding ${what}`, () => api.applyPatch(p, patch, { reverse: true }))) {
        set({ lineSelection: null })
        await get().refreshStatus()
      }
    },

    setLineSelection: (selection) => set({ lineSelection: selection }),

    applyLineSelection: async () => {
      const t = lineTarget()
      if (!t) return
      if (t.staged) await get().unstageHunk(buildLinePatch(t.path, t.hunk, t.lines, 'reverse'), t.what)
      else await get().stageHunk(buildLinePatch(t.path, t.hunk, t.lines, 'forward'), t.what)
    },

    discardLineSelection: async () => {
      const t = lineTarget()
      // Nothing to discard on the staged side — unstage those lines instead.
      if (!t || t.staged) return
      await get().discardHunk(buildLinePatch(t.path, t.hunk, t.lines, 'reverse'), t.what)
    },

    commit: async (message, amend, push) => {
      const p = get().activeRepoPath
      if (!p) return false
      const ok = await runAction(
        'Committing',
        () => api.commit(p, message, amend),
        push ? undefined : 'Commit created'
      )
      if (ok) {
        const drafts = { ...get().commitDrafts }
        delete drafts[p]
        set({ selectedFile: null, diff: null, commitDrafts: drafts })
        await get().refreshAll()
        if (push) {
          const st = get().status
          const noUpstream = !!(st?.branch && !st.upstream)
          await get().push(noUpstream)
        }
      }
      return ok
    },

    setCommitDraft: (message) => {
      const p = get().activeRepoPath
      if (!p) return
      set({ commitDrafts: { ...get().commitDrafts, [p]: message } })
    },

    setAppendFeatureId: (on) => {
      set({ appendFeatureId: on })
      void api.setSettings({ appendFeatureId: on })
    },

    push: async (setUpstream) => {
      const p = get().activeRepoPath
      if (!p) return
      const st = get().status
      const opts =
        setUpstream && st?.branch
          ? { setUpstream: true, remote: 'origin', branch: st.branch }
          : {}
      if (await runAction('Pushing', () => api.push(p, opts), 'Pushed')) {
        await get().refreshAll()
        void get().loadRemoteTags()
      }
    },

    pull: async () => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction('Pulling', () => api.pull(p, {}), 'Pulled')) {
        await get().refreshAll()
        void get().loadRemoteTags()
      }
    },

    fetch: async () => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction('Fetching', () => api.fetch(p, { prune: true }), 'Fetched')) {
        await get().refreshAll()
        void get().loadRemoteTags()
      }
    },

    checkoutBranch: async (name) => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction(`Checking out ${name}`, () => api.checkout(p, name)))
        await get().refreshAll()
    },

    createBranch: async (name, checkoutNew, startPoint) => {
      const p = get().activeRepoPath
      if (!p) return false
      const ok = await runAction('Creating branch', () =>
        api.createBranch(p, name, checkoutNew, startPoint)
      )
      if (ok) await get().refreshAll()
      return ok
    },

    mergeBranch: async (name) => {
      const p = get().activeRepoPath
      if (!p) return
      const merged = await runAction(`Merging ${name}`, () => api.merge(p, name), `Merged ${name}`)
      // A merge that stops on conflicts makes runAction return false, but the
      // working tree HAS changed (conflict markers + MERGE_HEAD). Refresh either
      // way so the conflicted files show up without a manual refresh.
      await get().refreshAll()
      if (merged) set({ toast: `Merged ${name}` })
    },

    deleteBranch: async (name, force) => {
      const p = get().activeRepoPath
      if (!p) return false
      const ok = await runAction(`Deleting ${name}`, () => api.deleteBranch(p, name, force))
      if (ok) await get().refreshAll()
      return ok
    },

    renameBranch: async (oldName, newName) => {
      const p = get().activeRepoPath
      if (!p) return false
      const ok = await runAction(`Renaming ${oldName}`, () =>
        api.renameBranch(p, oldName, newName)
      )
      if (ok) await get().refreshAll()
      return ok
    },

    stashSave: async (message, includeUntracked) => {
      const p = get().activeRepoPath
      if (!p) return false
      const ok = await runAction(
        'Stashing',
        () => api.stashSave(p, message, includeUntracked),
        'Changes stashed'
      )
      if (ok) await get().refreshAll()
      return ok
    },

    stashApply: async (ref, pop) => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction('Applying stash', () => api.stashApply(p, ref, pop))) {
        if (pop || get().selectedStash?.ref === ref) get().clearStash()
        await get().refreshAll()
      }
    },

    stashDrop: async (ref) => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction('Dropping stash', () => api.stashDrop(p, ref))) {
        if (get().selectedStash?.ref === ref) get().clearStash()
        await get().refreshAll()
      }
    },

    addRemote: async (name, url) => {
      const p = get().activeRepoPath
      if (!p) return false
      const ok = await runAction('Adding remote', () => api.addRemote(p, name, url))
      if (ok) await get().refreshAll()
      return ok
    },

    removeRemote: async (name) => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction('Removing remote', () => api.removeRemote(p, name)))
        await get().refreshAll()
    },

    createTag: async (name, message, ref) => {
      const p = get().activeRepoPath
      if (!p) return false
      const ok = await runAction('Creating tag', () =>
        api.createTag(p, name, ref, message || undefined)
      )
      if (ok) await get().refreshAll()
      return ok
    },

    deleteTag: async (name) => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction(`Deleting tag ${name}`, () => api.deleteTag(p, name)))
        await get().refreshAll()
    },

    pushTag: async (name) => {
      const p = get().activeRepoPath
      if (!p) return
      const remotes = get().remotes
      const remote = remotes.find((r) => r.name === 'origin')?.name ?? remotes[0]?.name
      if (!remote) {
        set({ error: 'No remote configured to push the tag to' })
        return
      }
      if (
        await runAction(`Pushing tag ${name}`, () => api.pushTag(p, remote, name), `Pushed ${name}`)
      ) {
        const known = get().remoteTags
        if (get().activeRepoPath !== p) return
        if (known) {
          if (!known.includes(name)) {
            set({ remoteTags: [...known, name] })
            remember(p)
          }
        } else void get().loadRemoteTags()
      }
    },

    loadRemoteTags: async (opts) => {
      const p = get().activeRepoPath
      if (!p) return
      const remotes = get().remotes
      const remote = remotes.find((r) => r.name === 'origin')?.name ?? remotes[0]?.name
      if (!remote) {
        set({ remoteTags: null })
        remember(p, { remoteTagsAt: 0 })
        return
      }
      const at = getCachedRepo(p)?.remoteTagsAt ?? 0
      if (opts?.ifStale && get().remoteTags && Date.now() - at < REMOTE_TAGS_TTL_MS) return
      // Silent on failure: the badge just stays unknown rather than raising an error.
      const res = await api.remoteTags(p, remote)
      if (get().activeRepoPath !== p) return
      set({ remoteTags: res.ok ? keep(get().remoteTags, res.data as string[]) : null })
      remember(p, { remoteTagsAt: res.ok ? Date.now() : 0 })
    },

    updateSubmodules: async () => {
      const p = get().activeRepoPath
      if (!p) return
      if (
        await runAction('Updating submodules', () => api.submoduleUpdate(p, true), 'Submodules updated')
      )
        await get().refreshAll()
    },

    updateSubmodule: async (path) => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction(`Updating ${path}`, () => api.submoduleUpdate(p, true, [path])))
        await get().refreshAll()
    },

    revealInFileManager: async () => {
      const p = get().activeRepoPath
      if (!p) return
      await runAction('Opening folder', () => api.revealInFileManager(p))
    },

    openInTerminal: async () => {
      const p = get().activeRepoPath
      if (!p) return
      await runAction('Opening terminal', () => api.openInTerminal(p))
    },

    openFile: async (file) => {
      const p = get().activeRepoPath
      if (!p) return
      await runAction('Opening file', () => api.openFile(p, file))
    },

    resolveInMergeTool: async (file) => {
      const p = get().activeRepoPath
      if (!p) return
      await runAction(
        'Opening merge tool',
        () => api.mergeTool(p, file),
        'Opened in VS Code — refresh once you have saved the resolution'
      )
    },

    resolveConflict: async (file, side) => {
      const p = get().activeRepoPath
      if (!p) return
      const label = side === 'theirs' ? 'Accepting incoming' : 'Keeping current'
      if (await runAction(label, () => api.resolveConflict(p, file, side), `Resolved ${file}`)) {
        set({ selectedFile: null, diff: null })
        await get().refreshStatus()
      }
    },

    setHistoryBranch: async (ref) => {
      // An explicit choice stops the filter from auto-tracking the current branch.
      set({ historyBranch: ref, historyBranchAuto: false, logKey: '' })
      const p = get().activeRepoPath
      if (!p) return
      set({ loading: true })
      const lg = await api.log(p, 500, ref || undefined)
      set({
        commits: lg.ok ? (lg.data as CommitInfo[]) : [],
        loading: false,
        error: lg.ok ? get().error : lg.error || 'Failed to load history'
      })
    },

    setHistoryQuery: (query) => {
      set({ historyQuery: query })
      clearTimeout(searchTimer)
      if (!query.trim()) {
        ++searchSeq
        set({ searchResults: null })
        return
      }
      searchTimer = setTimeout(() => void runSearch(), 250)
    },

    rebaseOnto: async (onto) => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction(`Rebasing onto ${onto.slice(0, 7)}`, () => api.rebase(p, onto), 'Rebased'))
        await get().refreshAll()
    },

    revertCommit: async (hash) => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction('Reverting commit', () => api.revertCommit(p, hash), 'Commit reverted'))
        await get().refreshAll()
    },

    resetTo: async (hash, mode) => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction(`Resetting (${mode})`, () => api.resetTo(p, hash, mode), 'Branch reset'))
        await get().refreshAll()
    },

    cherryPick: async (hash, mainline) => {
      const p = get().activeRepoPath
      if (!p) return
      await runAction('Cherry-picking', () => api.cherryPick(p, hash, mainline), 'Cherry-picked')
      // Refresh on failure too, so conflicted files from a stopped cherry-pick show up.
      await get().refreshAll()
    },

    restoreFileFromCommit: async (hash, file) => {
      const p = get().activeRepoPath
      if (!p) return
      if (
        await runAction(
          'Resetting file',
          () => api.restoreFileFromCommit(p, hash, file),
          'File reset to commit'
        )
      )
        await get().refreshAll()
    },

    externalDiffCommit: async (hash, file) => {
      const p = get().activeRepoPath
      if (!p) return
      await runAction('Opening external diff', () => api.externalDiffCommit(p, hash, file))
    },

    copySha: async (hash) => {
      await api.copyText(hash)
      set({ toast: 'SHA copied to clipboard' })
    },

    copyText: async (text) => {
      await api.copyText(text)
      set({ toast: 'Copied to clipboard' })
    }
  }
})
