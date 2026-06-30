import { create } from 'zustand'
import type {
  BranchInfo,
  CommitDetail,
  CommitInfo,
  CompareDetail,
  FileChange,
  FileDiff,
  GitResult,
  RemoteInfo,
  RepoBookmark,
  StashInfo,
  StatusResult
} from '@shared/types'

const api = window.api

export type MainView = 'working' | 'history'

export interface FileSelection {
  kind: 'working' | 'commit' | 'compare'
  path: string
  staged: boolean
  untracked: boolean
}

interface AppState {
  repos: RepoBookmark[]
  activeRepoPath: string | null
  view: MainView

  status: StatusResult | null
  commits: CommitInfo[]
  branches: BranchInfo[]
  stashes: StashInfo[]
  remotes: RemoteInfo[]

  selectedCommit: string | null
  commitDetail: CommitDetail | null
  compareCommit: string | null
  compareDetail: CompareDetail | null
  selectedFile: FileSelection | null
  diff: FileDiff | null
  diffLoading: boolean

  loading: boolean
  busy: string | null
  error: string | null
  toast: string | null

  init: () => Promise<void>
  selectRepo: (path: string) => Promise<void>
  addRepoViaDialog: () => Promise<void>
  removeRepo: (id: string) => Promise<void>
  refreshAll: () => Promise<void>
  setView: (view: MainView) => void
  dismissError: () => void
  dismissToast: () => void

  selectCommit: (hash: string) => Promise<void>
  selectCommitFile: (path: string) => Promise<void>
  toggleCompareCommit: (hash: string) => Promise<void>
  selectCompareFile: (path: string) => Promise<void>
  selectWorkingFile: (file: FileChange) => Promise<void>

  stageFiles: (paths: string[]) => Promise<void>
  unstageFiles: (paths: string[]) => Promise<void>
  stageAll: () => Promise<void>
  unstageAll: () => Promise<void>
  discardFiles: (paths: string[]) => Promise<void>
  commit: (message: string, amend: boolean) => Promise<boolean>

  push: (setUpstream: boolean) => Promise<void>
  pull: () => Promise<void>
  fetch: () => Promise<void>

  checkoutBranch: (name: string) => Promise<void>
  createBranch: (name: string, checkoutNew: boolean) => Promise<boolean>
  mergeBranch: (name: string) => Promise<void>
  deleteBranch: (name: string, force: boolean) => Promise<void>

  stashSave: (message: string, includeUntracked: boolean) => Promise<boolean>
  stashApply: (ref: string, pop: boolean) => Promise<void>
  stashDrop: (ref: string) => Promise<void>

  addRemote: (name: string, url: string) => Promise<boolean>
  removeRemote: (name: string) => Promise<void>
}

export const useStore = create<AppState>((set, get) => {
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
    activeRepoPath: null,
    view: 'working',
    status: null,
    commits: [],
    branches: [],
    stashes: [],
    remotes: [],
    selectedCommit: null,
    commitDetail: null,
    compareCommit: null,
    compareDetail: null,
    selectedFile: null,
    diff: null,
    diffLoading: false,
    loading: false,
    busy: null,
    error: null,
    toast: null,

    init: async () => {
      const repos = await api.listRepos()
      set({ repos })
      if (repos.length) await get().selectRepo(repos[0].path)
    },

    selectRepo: async (path) => {
      set({
        activeRepoPath: path,
        selectedCommit: null,
        commitDetail: null,
        compareCommit: null,
        compareDetail: null,
        selectedFile: null,
        diff: null,
        status: null,
        commits: [],
        branches: [],
        stashes: [],
        remotes: []
      })
      await get().refreshAll()
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
      set({ repos })
      if (wasActive) {
        if (repos.length) await get().selectRepo(repos[0].path)
        else
          set({
            activeRepoPath: null,
            status: null,
            commits: [],
            branches: [],
            stashes: [],
            remotes: [],
            selectedCommit: null,
            commitDetail: null,
            compareCommit: null,
            compareDetail: null,
            selectedFile: null,
            diff: null
          })
      }
    },

    refreshAll: async () => {
      const p = get().activeRepoPath
      if (!p) return
      set({ loading: true })
      const [st, lg, br, sh, rm] = await Promise.all([
        api.status(p),
        api.log(p, 500),
        api.branches(p),
        api.stashes(p),
        api.remotes(p)
      ])
      const firstErr = [st, lg, br, sh, rm].find((r) => !r.ok)
      set({
        status: st.ok ? (st.data as StatusResult) : null,
        commits: lg.ok ? (lg.data as CommitInfo[]) : [],
        branches: br.ok ? (br.data as BranchInfo[]) : [],
        stashes: sh.ok ? (sh.data as StashInfo[]) : [],
        remotes: rm.ok ? (rm.data as RemoteInfo[]) : [],
        loading: false,
        error: firstErr ? firstErr.error || 'Failed to load repository' : get().error
      })

      // Re-load an open working-copy diff so it reflects the new status.
      const sel = get().selectedFile
      if (sel && sel.kind === 'working') {
        const all = [...(get().status?.staged ?? []), ...(get().status?.unstaged ?? [])]
        const match = all.find((f) => f.path === sel.path && f.staged === sel.staged)
        if (match) {
          const d = await api.diffWorking(p, sel.path, sel.staged, sel.untracked)
          set({ diff: d.ok ? (d.data as FileDiff) : null })
        } else {
          set({ selectedFile: null, diff: null })
        }
      }
    },

    setView: (view) =>
      set({
        view,
        compareCommit: null,
        compareDetail: null,
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
      const p = get().activeRepoPath
      if (!p) return
      const untracked = file.status === 'untracked'
      set({
        selectedFile: { kind: 'working', path: file.path, staged: file.staged, untracked },
        diffLoading: true,
        diff: null
      })
      const res = await api.diffWorking(p, file.path, file.staged, untracked)
      set({ diff: res.ok ? (res.data as FileDiff) : null, diffLoading: false })
      if (!res.ok) set({ error: res.error || 'Failed to load diff' })
    },

    stageFiles: async (paths) => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction('Staging', () => api.stage(p, paths))) {
        set({ selectedFile: null, diff: null })
        await get().refreshAll()
      }
    },

    unstageFiles: async (paths) => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction('Unstaging', () => api.unstage(p, paths))) {
        set({ selectedFile: null, diff: null })
        await get().refreshAll()
      }
    },

    stageAll: async () => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction('Staging all', () => api.stageAll(p))) {
        set({ selectedFile: null, diff: null })
        await get().refreshAll()
      }
    },

    unstageAll: async () => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction('Unstaging all', () => api.unstageAll(p))) {
        set({ selectedFile: null, diff: null })
        await get().refreshAll()
      }
    },

    discardFiles: async (paths) => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction('Discarding', () => api.discard(p, paths))) {
        set({ selectedFile: null, diff: null })
        await get().refreshAll()
      }
    },

    commit: async (message, amend) => {
      const p = get().activeRepoPath
      if (!p) return false
      const ok = await runAction('Committing', () => api.commit(p, message, amend), 'Commit created')
      if (ok) {
        set({ selectedFile: null, diff: null })
        await get().refreshAll()
      }
      return ok
    },

    push: async (setUpstream) => {
      const p = get().activeRepoPath
      if (!p) return
      const st = get().status
      const opts =
        setUpstream && st?.branch
          ? { setUpstream: true, remote: 'origin', branch: st.branch }
          : {}
      if (await runAction('Pushing', () => api.push(p, opts), 'Pushed')) await get().refreshAll()
    },

    pull: async () => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction('Pulling', () => api.pull(p, {}), 'Pulled')) await get().refreshAll()
    },

    fetch: async () => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction('Fetching', () => api.fetch(p, { prune: true }), 'Fetched'))
        await get().refreshAll()
    },

    checkoutBranch: async (name) => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction(`Checking out ${name}`, () => api.checkout(p, name)))
        await get().refreshAll()
    },

    createBranch: async (name, checkoutNew) => {
      const p = get().activeRepoPath
      if (!p) return false
      const ok = await runAction('Creating branch', () => api.createBranch(p, name, checkoutNew))
      if (ok) await get().refreshAll()
      return ok
    },

    mergeBranch: async (name) => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction(`Merging ${name}`, () => api.merge(p, name), `Merged ${name}`))
        await get().refreshAll()
    },

    deleteBranch: async (name, force) => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction(`Deleting ${name}`, () => api.deleteBranch(p, name, force)))
        await get().refreshAll()
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
      if (await runAction('Applying stash', () => api.stashApply(p, ref, pop)))
        await get().refreshAll()
    },

    stashDrop: async (ref) => {
      const p = get().activeRepoPath
      if (!p) return
      if (await runAction('Dropping stash', () => api.stashDrop(p, ref))) await get().refreshAll()
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
    }
  }
})
