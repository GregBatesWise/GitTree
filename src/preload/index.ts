import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../shared/channels'
import type {
  BranchInfo,
  CommitDetail,
  CommitInfo,
  CompareDetail,
  FetchOptions,
  FileDiff,
  GitResult,
  PullOptions,
  PushOptions,
  RemoteInfo,
  RepoBookmark,
  StashInfo,
  StatusResult
} from '../shared/types'

const api = {
  listRepos: (): Promise<RepoBookmark[]> => ipcRenderer.invoke(CH.reposList),
  addRepo: (path: string): Promise<GitResult<RepoBookmark>> => ipcRenderer.invoke(CH.repoAdd, path),
  removeRepo: (id: string): Promise<void> => ipcRenderer.invoke(CH.repoRemove, id),
  openFolder: (): Promise<string | null> => ipcRenderer.invoke(CH.openFolder),

  status: (p: string): Promise<GitResult<StatusResult>> => ipcRenderer.invoke(CH.status, p),
  log: (p: string, limit?: number): Promise<GitResult<CommitInfo[]>> =>
    ipcRenderer.invoke(CH.log, p, limit),
  branches: (p: string): Promise<GitResult<BranchInfo[]>> => ipcRenderer.invoke(CH.branches, p),
  stashes: (p: string): Promise<GitResult<StashInfo[]>> => ipcRenderer.invoke(CH.stashes, p),
  remotes: (p: string): Promise<GitResult<RemoteInfo[]>> => ipcRenderer.invoke(CH.remotes, p),

  diffWorking: (
    p: string,
    file: string,
    staged: boolean,
    untracked: boolean
  ): Promise<GitResult<FileDiff>> => ipcRenderer.invoke(CH.diffWorking, p, file, staged, untracked),
  commitFiles: (p: string, hash: string): Promise<GitResult<CommitDetail>> =>
    ipcRenderer.invoke(CH.commitFiles, p, hash),
  commitFileDiff: (p: string, hash: string, file: string): Promise<GitResult<FileDiff>> =>
    ipcRenderer.invoke(CH.commitFileDiff, p, hash, file),
  compareFiles: (p: string, base: string, target: string): Promise<GitResult<CompareDetail>> =>
    ipcRenderer.invoke(CH.compareFiles, p, base, target),
  compareFileDiff: (
    p: string,
    base: string,
    target: string,
    file: string
  ): Promise<GitResult<FileDiff>> => ipcRenderer.invoke(CH.compareFileDiff, p, base, target, file),

  stage: (p: string, files: string[]): Promise<GitResult> => ipcRenderer.invoke(CH.stage, p, files),
  unstage: (p: string, files: string[]): Promise<GitResult> =>
    ipcRenderer.invoke(CH.unstage, p, files),
  stageAll: (p: string): Promise<GitResult> => ipcRenderer.invoke(CH.stageAll, p),
  unstageAll: (p: string): Promise<GitResult> => ipcRenderer.invoke(CH.unstageAll, p),
  discard: (p: string, files: string[]): Promise<GitResult> =>
    ipcRenderer.invoke(CH.discard, p, files),
  commit: (p: string, message: string, amend: boolean): Promise<GitResult> =>
    ipcRenderer.invoke(CH.commit, p, message, amend),
  checkout: (p: string, name: string): Promise<GitResult> => ipcRenderer.invoke(CH.checkout, p, name),
  createBranch: (
    p: string,
    name: string,
    checkoutNew: boolean,
    startPoint?: string
  ): Promise<GitResult> => ipcRenderer.invoke(CH.createBranch, p, name, checkoutNew, startPoint),
  merge: (p: string, name: string): Promise<GitResult> => ipcRenderer.invoke(CH.merge, p, name),
  deleteBranch: (p: string, name: string, force: boolean): Promise<GitResult> =>
    ipcRenderer.invoke(CH.deleteBranch, p, name, force),
  push: (p: string, opts: PushOptions): Promise<GitResult> => ipcRenderer.invoke(CH.push, p, opts),
  pull: (p: string, opts: PullOptions): Promise<GitResult> => ipcRenderer.invoke(CH.pull, p, opts),
  fetch: (p: string, opts: FetchOptions): Promise<GitResult> =>
    ipcRenderer.invoke(CH.fetch, p, opts),
  stashSave: (p: string, message: string, includeUntracked: boolean): Promise<GitResult> =>
    ipcRenderer.invoke(CH.stashSave, p, message, includeUntracked),
  stashApply: (p: string, ref: string, pop: boolean): Promise<GitResult> =>
    ipcRenderer.invoke(CH.stashApply, p, ref, pop),
  stashDrop: (p: string, ref: string): Promise<GitResult> =>
    ipcRenderer.invoke(CH.stashDrop, p, ref),
  addRemote: (p: string, name: string, url: string): Promise<GitResult> =>
    ipcRenderer.invoke(CH.addRemote, p, name, url),
  removeRemote: (p: string, name: string): Promise<GitResult> =>
    ipcRenderer.invoke(CH.removeRemote, p, name)
}

contextBridge.exposeInMainWorld('api', api)

export type GitDesktopApi = typeof api
