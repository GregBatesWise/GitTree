import { execFile } from 'node:child_process'

export interface RunResult {
  stdout: string
  stderr: string
  code: number
}

const MAX_BUFFER = 64 * 1024 * 1024

/**
 * Runs a git command. Arguments are passed as an array to execFile (no shell),
 * which prevents command/argument injection from repo paths or user input.
 * Resolves regardless of exit code so callers can inspect output; use gitOk for
 * commands where a non-zero exit should throw.
 */
export async function runGit(cwd: string, args: string[]): Promise<RunResult> {
  let res = await runOnce(cwd, args)
  // Another git process (a background refresh, an IDE) briefly holding a lock
  // makes git bail before touching anything, so replaying the command is safe.
  for (const delay of LOCK_RETRY_DELAYS) {
    if (res.code === 0 || !LOCK_ERROR.test(res.stderr)) break
    await new Promise((r) => setTimeout(r, delay))
    res = await runOnce(cwd, args)
  }
  return res
}

const LOCK_ERROR = /Unable to create '[^']*\.lock': File exists/i
const LOCK_RETRY_DELAYS = [150, 300, 600, 1200, 2000]

function runOnce(cwd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'utf8' },
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
