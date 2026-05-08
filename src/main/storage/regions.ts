import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import type { SharedRegion } from '@shared/ipc'

const FILE = 'regions.json'

type RegionsFile = Record<string, SharedRegion>

async function pathFor(): Promise<string> {
  const dir = app.getPath('userData')
  await mkdir(dir, { recursive: true })
  return join(dir, FILE)
}

async function load(): Promise<RegionsFile> {
  try {
    const raw = await readFile(await pathFor(), 'utf8')
    return JSON.parse(raw) as RegionsFile
  } catch {
    return {}
  }
}

async function persist(data: RegionsFile): Promise<void> {
  await writeFile(await pathFor(), JSON.stringify(data, null, 2), 'utf8')
}

export async function getRegion(windowName: string): Promise<SharedRegion | null> {
  const data = await load()
  return data[windowName] ?? null
}

export async function setRegion(windowName: string, region: SharedRegion): Promise<void> {
  const data = await load()
  data[windowName] = region
  await persist(data)
}
