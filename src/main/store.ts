import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RepoBookmark } from '../shared/types'

function storeFile(): string {
  return join(app.getPath('userData'), 'repos.json')
}

async function read(): Promise<RepoBookmark[]> {
  try {
    const raw = await fs.readFile(storeFile(), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function write(list: RepoBookmark[]): Promise<void> {
  await fs.writeFile(storeFile(), JSON.stringify(list, null, 2), 'utf8')
}

export async function listRepos(): Promise<RepoBookmark[]> {
  return read()
}

export async function addRepo(path: string, name: string): Promise<RepoBookmark> {
  const list = await read()
  const existing = list.find((r) => r.path === path)
  if (existing) return existing
  const item: RepoBookmark = { id: randomUUID(), name, path }
  list.push(item)
  await write(list)
  return item
}

export async function removeRepo(id: string): Promise<void> {
  const list = (await read()).filter((r) => r.id !== id)
  await write(list)
}
