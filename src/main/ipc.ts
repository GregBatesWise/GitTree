import { ipcMain, dialog, shell, clipboard, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { CH } from '../shared/channels'
import type {
  ApplyPatchOptions,
  FetchOptions,
  GitResult,
  PullOptions,
  PushOptions,
  ResetMode
} from '../shared/types'
import * as repo from './git/repo'
import { runGit } from './git/run'
import * as store from './store'

async function wrap<T>(fn: () => Promise<T>): Promise<GitResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) }
  }
}

/** Opens a system terminal at the given directory, trying platform options in order. */
function openTerminal(cwd: string): Promise<void> {
  const candidates =
    process.platform === 'win32'
      ? [
          { cmd: 'wt.exe', args: ['-d', cwd] },
          { cmd: 'cmd.exe', args: ['/c', 'start', '', 'cmd.exe'] }
        ]
      : process.platform === 'darwin'
        ? [{ cmd: 'open', args: ['-a', 'Terminal', cwd] }]
        : [
            { cmd: 'x-terminal-emulator', args: ['--working-directory', cwd] },
            { cmd: 'gnome-terminal', args: [`--working-directory=${cwd}`] },
            { cmd: 'konsole', args: ['--workdir', cwd] },
            { cmd: 'xterm', args: [] }
          ]

  return new Promise((resolve, reject) => {
    const tryAt = (i: number): void => {
      if (i >= candidates.length) {
        reject(new Error('No terminal emulator was found'))
        return
      }
      const child = spawn(candidates[i].cmd, candidates[i].args, {
        cwd,
        detached: true,
        stdio: 'ignore'
      })
      child.once('error', () => tryAt(i + 1))
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    }
    tryAt(0)
  })
}

/** Launches the user's configured Git difftool for a file at a commit vs. its parent. */
async function externalDiff(cwd: string, hash: string, file: string): Promise<void> {
  const tool = await runGit(cwd, ['config', '--get', 'diff.tool'])
  const guitool = await runGit(cwd, ['config', '--get', 'diff.guitool'])
  const hasGui = !!guitool.stdout.trim()
  if (!tool.stdout.trim() && !hasGui) {
    throw new Error('No external diff tool is configured. Set "diff.tool" in your Git config.')
  }
  const args = ['difftool', '-y']
  if (hasGui) args.push('-g')
  args.push(`${hash}^!`, '--', file)
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, { cwd, detached: true, stdio: 'ignore' })
    child.once('error', (e) => reject(e))
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
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

  ipcMain.handle(CH.revealInFileManager, (_e, p: string) =>
    wrap(async () => {
      const err = await shell.openPath(p)
      if (err) throw new Error(err)
    })
  )
  ipcMain.handle(CH.openInTerminal, (_e, p: string) => wrap(() => openTerminal(p)))

  ipcMain.handle(CH.status, (_e, p: string) => wrap(() => repo.status(p)))
  ipcMain.handle(CH.log, (_e, p: string, limit?: number, ref?: string) =>
    wrap(() => repo.log(p, limit, ref))
  )
  ipcMain.handle(CH.branches, (_e, p: string) => wrap(() => repo.branches(p)))
  ipcMain.handle(CH.stashes, (_e, p: string) => wrap(() => repo.stashes(p)))
  ipcMain.handle(CH.remotes, (_e, p: string) => wrap(() => repo.remotes(p)))
  ipcMain.handle(CH.tags, (_e, p: string) => wrap(() => repo.tags(p)))
  ipcMain.handle(CH.submodules, (_e, p: string) => wrap(() => repo.submodules(p)))

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
  ipcMain.handle(CH.applyPatch, (_e, p: string, patch: string, opts: ApplyPatchOptions) =>
    wrap(() => repo.applyPatch(p, patch, opts))
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
  ipcMain.handle(CH.renameBranch, (_e, p: string, oldName: string, newName: string) =>
    wrap(() => repo.renameBranch(p, oldName, newName))
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
  ipcMain.handle(
    CH.createTag,
    (_e, p: string, name: string, ref: string | undefined, message: string | undefined) =>
      wrap(() => repo.createTag(p, name, ref, message))
  )
  ipcMain.handle(CH.deleteTag, (_e, p: string, name: string) =>
    wrap(() => repo.deleteTag(p, name))
  )
  ipcMain.handle(CH.pushTag, (_e, p: string, remote: string, name: string) =>
    wrap(() => repo.pushTag(p, remote, name))
  )
  ipcMain.handle(CH.submoduleUpdate, (_e, p: string, init: boolean, paths?: string[]) =>
    wrap(() => repo.submoduleUpdate(p, init, paths))
  )
  ipcMain.handle(CH.rebase, (_e, p: string, onto: string) => wrap(() => repo.rebase(p, onto)))
  ipcMain.handle(CH.revertCommit, (_e, p: string, hash: string) =>
    wrap(() => repo.revertCommit(p, hash))
  )
  ipcMain.handle(CH.resetTo, (_e, p: string, hash: string, mode: ResetMode) =>
    wrap(() => repo.resetTo(p, hash, mode))
  )
  ipcMain.handle(CH.cherryPick, (_e, p: string, hash: string) =>
    wrap(() => repo.cherryPick(p, hash))
  )
  ipcMain.handle(CH.restoreFileFromCommit, (_e, p: string, hash: string, file: string) =>
    wrap(() => repo.restoreFileFromCommit(p, hash, file))
  )
  ipcMain.handle(CH.externalDiffCommit, (_e, p: string, hash: string, file: string) =>
    wrap(() => externalDiff(p, hash, file))
  )
  ipcMain.handle(CH.copyText, (_e, text: string) => {
    clipboard.writeText(text)
  })
}
