import { app } from 'electron'
import { createWriteStream, type WriteStream } from 'node:fs'
import { join } from 'node:path'

/** Timing log, on when the app is started with GITTREE_TRACE=1. */
export const TRACE = process.env['GITTREE_TRACE'] === '1'

let out: WriteStream | null = null

export function trace(line: string): void {
  if (!TRACE) return
  const stamped = `${new Date().toISOString()} ${line}`
  console.log(stamped)
  try {
    out ??= createWriteStream(join(app.getPath('userData'), 'trace.log'), { flags: 'a' })
    out.write(stamped + '\n')
  } catch {
    // Console output alone is fine.
  }
}
