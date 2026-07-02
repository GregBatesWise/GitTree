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
npm run package:win
```

That's it. Each run automatically:

1. Bumps the **minor** version in `package.json` (e.g. `0.2.0 → 0.3.0`) — the new version is embedded as the executable's file/product version metadata.
2. Builds the production bundle.
3. Packages two Windows executables into `./dist/`:

| File | Description |
|---|---|
| `GitTree-setup.exe` | NSIS installer — lets the user choose the install directory; creates Start Menu and Desktop shortcuts. |
| `GitTree.exe` | Self-contained portable executable — no installation required; just run it. |

4. Installs `GitTree.exe` to `%LOCALAPPDATA%\Programs\GitTree` and creates (or refreshes) a **GitTree** shortcut on your Desktop pointing to it. Any old `GitTree.exe` left directly on the Desktop by previous builds is removed.

> **First-time setup:** run `npm run build:icon` once to generate `build/icon.ico` from `build/icon.svg` before your first build. You only need to repeat this if you change the icon.

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
