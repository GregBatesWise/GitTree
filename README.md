# GitTree

A SourceTree-like Git desktop client built with **Electron + React + TypeScript**.
It drives your installed `git` CLI, so it behaves exactly like the command line —
no embedded Git reimplementation.

## Features (MVP)

- **Repository bookmarks** — add local repos; switch between them from the toolbar.
- **History graph** — multi-lane railroad commit graph across all branches, with
  branch/tag/HEAD badges, author, relative date and short hash.
- **Working copy** — staged / unstaged lists, stage / unstage / discard per file
  or all at once, and a commit box (with amend).
- **Diffs** — file & hunk diff viewer with old/new line numbers for working-copy
  changes and for files inside any commit.
- **Branches** — create, check out, merge and delete.
- **Sync** — push (auto `-u` for new branches), pull, fetch `--all --prune`,
  with ahead/behind indicators.
- **Stashes** — create (optionally including untracked), apply, pop, drop.
- **Remotes** — view, add and remove; check out remote-tracking branches.

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [Git](https://git-scm.com/) on your `PATH`

## Getting started

```powershell
npm install
npm run dev      # launch the app with hot reload
```

## Build & package

```powershell
npm run build        # produce the production bundle in ./out
npm run package:win  # build a Windows installer into ./dist (electron-builder)
```

## Architecture

```
src/
  shared/      Types and IPC channel names shared by every process
  main/        Electron main process
    git/       runGit (execFile, no shell), output parsers, high-level ops
    store.ts   Repo bookmarks persisted to userData/repos.json
    ipc.ts     ipcMain handlers -> GitResult
    index.ts   Window + CSP + bootstrap
  preload/     contextBridge: a typed, sandboxed window.api
  renderer/    React UI
    src/
      lib/graph.ts   Lane-assignment algorithm for the commit graph
      store.ts       Zustand store (all UI state + actions)
      components/     Toolbar, Sidebar, HistoryView, WorkingCopy, DiffViewer
```

### Security

- `contextIsolation: true`, `nodeIntegration: false`; the renderer reaches Git
  only through the narrow preload bridge.
- Git is invoked with `execFile('git', argsArray)` — arguments are never passed
  through a shell, preventing command injection from paths or user input.
- Production builds apply a strict `Content-Security-Policy`.

## Notes / limitations

- The graph and history load the most recent 500 commits across all refs.
- Merge-commit diffs follow the first parent.
- Interactive rebase, submodules, Git-flow and hosting integrations are not part
  of this MVP.
