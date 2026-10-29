import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { trace, TRACE } from '../trace'

export interface RunResult {
  stdout: string
  stderr: string
  code: number
}

const MAX_BUFFER = 64 * 1024 * 1024

interface DirectGit {
  exe: string
  env: NodeJS.ProcessEnv
}

/**
 * On Windows `git` on PATH is usually Git\cmd\git.exe, a launcher that starts
 * the real binary — two process starts per call, each costing tens of ms.
 * Resolves the real binary once, plus the PATH entries the launcher would add.
 */
const directGit: Promise<DirectGit | null> =
  process.platform !== 'win32'
    ? Promise.resolve(null)
    : spawnGit('git', ['--exec-path'], process.cwd(), process.env).then((res) => {
        // e.g. C:/Program Files/Git/ucrt64/libexec/git-core
        const execPath = res.stdout.trim()
        if (res.code !== 0 || !execPath) return null
        const prefix = dirname(dirname(execPath))
        const exe = join(prefix, 'bin', 'git.exe')
        if (!existsSync(exe)) return null
        const root = dirname(prefix)
        const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
        const extra = [join(prefix, 'bin'), join(root, 'usr', 'bin')]
        const env = {
          ...process.env,
          [pathKey]: [...extra, process.env[pathKey] ?? ''].join(delimiter)
        }
        trace(`[git] using ${exe}`)
        return { exe, env }
      })

/**
 * Commands that only read the repository and never run hooks, helpers or
 * network transports — safe to run on the real binary. Everything else keeps
 * going through the launcher, which sets up what hooks and credential helpers need.
 */
function isLocalRead(args: string[]): boolean {
  let i = 0
  while (args[i] === '-c' || args[i] === '--no-optional-locks') i += args[i] === '-c' ? 2 : 1
  const cmd = args[i]
  const next = args[i + 1]
  switch (cmd) {
    case 'status':
    case 'log':
    case 'show':
    case 'diff':
    case 'for-each-ref':
    case 'show-ref':
    case 'symbolic-ref':
    case 'rev-parse':
    case 'rev-list':
    case 'merge-base':
    case 'ls-files':
    case 'cat-file':
      return true
    case 'stash':
      return next === 'list' || next === 'show'
    case 'remote':
      return next === undefined || next === '-v'
    case 'config':
      return next === '--get' || next === '--list'
    default:
      return false
  }
}

/**
 * Runs a git command. Arguments are passed as an array to execFile (no shell),
 * which prevents command/argument injection from repo paths or user input.
 * Resolves regardless of exit code so callers can inspect output; use gitOk for
 * commands where a non-zero exit should throw. `input` is written to stdin.
 */
export async function runGit(cwd: string, args: string[], input?: string): Promise<RunResult> {
  let res = await runOnce(cwd, args, input)
  // Another git process (a background refresh, an IDE) briefly holding a lock
  // makes git bail before touching anything, so replaying the command is safe.
  for (const delay of LOCK_RETRY_DELAYS) {
    if (res.code === 0 || !LOCK_ERROR.test(res.stderr)) break
    await new Promise((r) => setTimeout(r, delay))
    res = await runOnce(cwd, args, input)
  }
  return res
}

const LOCK_ERROR = /Unable to create '[^']*\.lock': File exists/i
const LOCK_RETRY_DELAYS = [150, 300, 600, 1200, 2000]

async function runOnce(cwd: string, args: string[], input?: string): Promise<RunResult> {
  const local = isLocalRead(args)
  const direct = local ? await directGit : null
  const start = TRACE ? performance.now() : 0
  const res = await spawnGit(direct?.exe ?? 'git', args, cwd, direct?.env ?? process.env, input)
  if (TRACE) {
    const ms = (performance.now() - start).toFixed(0).padStart(5)
    trace(`[git ${ms}ms] exit=${res.code} ${direct ? '' : '(launcher) '}${args.join(' ')}`)
  }
  if (!local) for (const fn of writeListeners) fn(cwd)
  return res
}

const writeListeners: ((cwd: string) => void)[] = []

/** Called after any command that may have changed the repository at `cwd`. */
export function onRepoWrite(fn: (cwd: string) => void): void {
  writeListeners.push(fn)
}

function spawnGit(
  exe: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  input?: string
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(
      exe,
      args,
      { cwd, env, maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const e = err as NodeJS.ErrnoException | null
        if (e && typeof e.code !== 'number') {
          // Spawn failure (e.g. git not installed / not on PATH).
          resolve({
            stdout: stdout || '',
            stderr: (stderr || '') + String(e.message || e),
            code: -1
          })
          return
        }
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          code: e ? Number(e.code) : 0
        })
      }
    )
    if (input !== undefined) child.stdin?.end(input)
  })
}

/** Runs git and throws if the command exits non-zero. */
export async function gitOk(cwd: string, args: string[]): Promise<RunResult> {
  const res = await runGit(cwd, args)
  if (res.code !== 0) {
    throw new Error(res.stderr.trim() || res.stdout.trim() || `git ${args.join(' ')} failed`)
  }
  return res
}
