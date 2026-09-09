import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppSettings, RepoBookmark, RepoGroup } from '../shared/types'

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
  const groups = await readGroups()
  let changed = false
  for (const g of groups) {
    const next = g.repoIds.filter((rid) => rid !== id)
    if (next.length !== g.repoIds.length) {
      g.repoIds = next
      changed = true
    }
  }
  if (changed) await writeGroups(groups)
}

/**
 * Rewrites the bookmark order to match `ids`. The stored array's order is what
 * the repository picker renders, so this is how a drag-reorder is persisted.
 * Ids the caller did not mention (added by another window since it read the
 * list) keep their relative order at the end rather than being dropped.
 */
export async function reorderRepos(ids: string[]): Promise<RepoBookmark[]> {
  const list = await read()
  const ranked = new Map(ids.map((id, i) => [id, i]))
  const next = [...list].sort(
    (a, b) => (ranked.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (ranked.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  )
  await write(next)
  return next
}

function groupsFile(): string {
  return join(app.getPath('userData'), 'groups.json')
}

async function readGroups(): Promise<RepoGroup[]> {
  try {
    const raw = await fs.readFile(groupsFile(), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeGroups(list: RepoGroup[]): Promise<void> {
  await fs.writeFile(groupsFile(), JSON.stringify(list, null, 2), 'utf8')
}

export async function listGroups(): Promise<RepoGroup[]> {
  return readGroups()
}

export async function createGroup(name: string): Promise<RepoGroup> {
  const list = await readGroups()
  const item: RepoGroup = { id: randomUUID(), name, repoIds: [] }
  list.push(item)
  await writeGroups(list)
  return item
}

export async function renameGroup(id: string, name: string): Promise<void> {
  const list = await readGroups()
  const g = list.find((x) => x.id === id)
  if (g) {
    g.name = name
    await writeGroups(list)
  }
}

export async function setGroupFeatureId(id: string, featureId: string): Promise<void> {
  const list = await readGroups()
  const g = list.find((x) => x.id === id)
  if (g) {
    const trimmed = featureId.trim()
    if (trimmed) g.featureId = trimmed
    else delete g.featureId
    await writeGroups(list)
  }
}

export async function deleteGroup(id: string): Promise<void> {
  const list = (await readGroups()).filter((g) => g.id !== id)
  await writeGroups(list)
}

/**
 * Adds or removes one repository's membership of one group. A repository may
 * belong to any number of groups at once, so only the target group is touched.
 */
export async function setRepoGroupMembership(
  repoId: string,
  groupId: string,
  member: boolean
): Promise<void> {
  const list = await readGroups()
  const target = list.find((g) => g.id === groupId)
  if (!target) return
  const has = target.repoIds.includes(repoId)
  if (member && !has) target.repoIds.push(repoId)
  if (!member && has) target.repoIds = target.repoIds.filter((rid) => rid !== repoId)
  await writeGroups(list)
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsFile(), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as AppSettings) : {}
  } catch {
    return {}
  }
}

export async function setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings()
  const next = { ...current, ...patch }
  await fs.writeFile(settingsFile(), JSON.stringify(next, null, 2), 'utf8')
  return next
}
