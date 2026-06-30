import { ipcMain, dialog, BrowserWindow } from 'electron'
import { CH } from '../shared/channels'
import type {
  FetchOptions,
  GitResult,
  PullOptions,
  PushOptions
} from '../shared/types'
import * as repo from './git/repo'
import * as store from './store'

async function wrap<T>(fn: () => Promise<T>): Promise<GitResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) }
  }
}

export function registerIpc(): void {
  ipcMain.handle(CH.reposList, () => store.listRepos())

  ipcMain.handle(CH.repoAdd, (_e, path: string) =>
    wrap(async () => {
      if (!(await repo.isGitRepo(path))) {
        throw new Error(`Not a Git repository: ${path}`)
      }
      const name = await repo.repoName(path)
      return store.addRepo(path, name)
    })
  )

  ipcMain.handle(CH.repoRemove, (_e, id: string) => store.removeRepo(id))

  ipcMain.handle(CH.openFolder, async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(CH.status, (_e, p: string) => wrap(() => repo.status(p)))
  ipcMain.handle(CH.log, (_e, p: string, limit?: number) => wrap(() => repo.log(p, limit)))
  ipcMain.handle(CH.branches, (_e, p: string) => wrap(() => repo.branches(p)))
  ipcMain.handle(CH.stashes, (_e, p: string) => wrap(() => repo.stashes(p)))
  ipcMain.handle(CH.remotes, (_e, p: string) => wrap(() => repo.remotes(p)))

  ipcMain.handle(
    CH.diffWorking,
    (_e, p: string, file: string, staged: boolean, untracked: boolean) =>
      wrap(() => repo.diffWorkingFile(p, file, staged, untracked))
  )
  ipcMain.handle(CH.commitFiles, (_e, p: string, hash: string) =>
    wrap(() => repo.commitDetail(p, hash))
  )
  ipcMain.handle(CH.commitFileDiff, (_e, p: string, hash: string, file: string) =>
    wrap(() => repo.commitFileDiff(p, hash, file))
  )
  ipcMain.handle(CH.compareFiles, (_e, p: string, base: string, target: string) =>
    wrap(() => repo.compareDetail(p, base, target))
  )
  ipcMain.handle(
    CH.compareFileDiff,
    (_e, p: string, base: string, target: string, file: string) =>
      wrap(() => repo.compareFileDiff(p, base, target, file))
  )

  ipcMain.handle(CH.stage, (_e, p: string, files: string[]) => wrap(() => repo.stage(p, files)))
  ipcMain.handle(CH.unstage, (_e, p: string, files: string[]) =>
    wrap(() => repo.unstage(p, files))
  )
  ipcMain.handle(CH.stageAll, (_e, p: string) => wrap(() => repo.stageAll(p)))
  ipcMain.handle(CH.unstageAll, (_e, p: string) => wrap(() => repo.unstageAll(p)))
  ipcMain.handle(CH.discard, (_e, p: string, files: string[]) =>
    wrap(() => repo.discard(p, files))
  )
  ipcMain.handle(CH.commit, (_e, p: string, message: string, amend: boolean) =>
    wrap(() => repo.commit(p, message, amend))
  )
  ipcMain.handle(CH.checkout, (_e, p: string, name: string) => wrap(() => repo.checkout(p, name)))
  ipcMain.handle(
    CH.createBranch,
    (_e, p: string, name: string, checkoutNew: boolean, startPoint?: string) =>
      wrap(() => repo.createBranch(p, name, checkoutNew, startPoint))
  )
  ipcMain.handle(CH.merge, (_e, p: string, name: string) => wrap(() => repo.merge(p, name)))
  ipcMain.handle(CH.deleteBranch, (_e, p: string, name: string, force: boolean) =>
    wrap(() => repo.deleteBranch(p, name, force))
  )
  ipcMain.handle(CH.push, (_e, p: string, opts: PushOptions) => wrap(() => repo.push(p, opts)))
  ipcMain.handle(CH.pull, (_e, p: string, opts: PullOptions) => wrap(() => repo.pull(p, opts)))
  ipcMain.handle(CH.fetch, (_e, p: string, opts: FetchOptions) => wrap(() => repo.fetch(p, opts)))
  ipcMain.handle(
    CH.stashSave,
    (_e, p: string, message: string, includeUntracked: boolean) =>
      wrap(() => repo.stashSave(p, message, includeUntracked))
  )
  ipcMain.handle(CH.stashApply, (_e, p: string, ref: string, pop: boolean) =>
    wrap(() => repo.stashApply(p, ref, pop))
  )
  ipcMain.handle(CH.stashDrop, (_e, p: string, ref: string) => wrap(() => repo.stashDrop(p, ref)))
  ipcMain.handle(CH.addRemote, (_e, p: string, name: string, url: string) =>
    wrap(() => repo.addRemote(p, name, url))
  )
  ipcMain.handle(CH.removeRemote, (_e, p: string, name: string) =>
    wrap(() => repo.removeRemote(p, name))
  )
}
