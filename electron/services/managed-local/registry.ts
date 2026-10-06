import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import type { ManagedModel } from '../../../src/shared/managed-local'
import { writeJsonFile } from '../../utils/config-utils'

export function inspectGguf(filePath: string) {
  const canonical = fs.realpathSync.native(filePath)
  if (path.extname(canonical).toLowerCase() !== '.gguf') throw new Error('Select a complete .gguf model file, not an archive or shortcut')
  if (/[-.]\d{5}-of-\d{5}\.gguf$/i.test(canonical)) throw new Error('Split GGUF files are not supported in this version; use a complete single-file GGUF')
  const stat = fs.statSync(canonical)
  if (!stat.isFile() || stat.size < 24) throw new Error('Not a regular GGUF model file')
  const fd = fs.openSync(canonical, 'r')
  try {
    const header = Buffer.alloc(24)
    if (fs.readSync(fd, header, 0, 24, 0) !== 24 || header.subarray(0, 4).toString('ascii') !== 'GGUF'
      || ![2, 3].includes(header.readUInt32LE(4)) || header.readBigUInt64LE(8) === 0n) {
      throw new Error('Invalid or unsupported GGUF header; download and extract a complete text-generation model')
    }
  } finally { fs.closeSync(fd) }
  return { filePath: canonical, sizeBytes: stat.size, modifiedMs: stat.mtimeMs }
}

export class ManagedModelRegistry {
  constructor(private readonly root: string) {}
  private get file() { return path.join(this.root, 'models.json') }
  list(): ManagedModel[] {
    if (!fs.existsSync(this.file)) return []
    if (fs.statSync(this.file).size > 2 * 1024 * 1024) throw new Error('Managed model registry is too large; refusing to overwrite it')
    let value: { schemaVersion?: number; models?: ManagedModel[] }
    try { value = JSON.parse(fs.readFileSync(this.file, 'utf8')) as typeof value } catch {
      throw new Error('Managed model registry is corrupt; refusing to overwrite it')
    }
    if (value.schemaVersion !== 1 || !Array.isArray(value.models) || value.models.length > 500) throw new Error('Invalid managed model registry')
    const seen = new Set<string>()
    for (const model of value.models) {
      if (!model || typeof model.id !== 'string' || !/^[a-f0-9-]{36}$/.test(model.id) || seen.has(model.id)
        || typeof model.filePath !== 'string' || !path.isAbsolute(model.filePath)
        || typeof model.name !== 'string' || !Number.isSafeInteger(model.sizeBytes) || model.sizeBytes < 24
        || !Number.isFinite(model.modifiedMs) || typeof model.importedAt !== 'string'
        || (model.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(model.sha256))) throw new Error('Invalid managed model record')
      seen.add(model.id)
    }
    return value.models.map(model => ({ ...model }))
  }
  importSelectedFile(filePath: string): ManagedModel {
    const info = inspectGguf(filePath)
    const all = this.list()
    const existing = all.find(model => model.filePath.toLowerCase() === info.filePath.toLowerCase())
    const model: ManagedModel = {
      id: existing?.id ?? randomUUID(), name: path.basename(info.filePath, path.extname(info.filePath)),
      ...info, importedAt: new Date().toISOString(),
      ...(existing?.sizeBytes === info.sizeBytes && existing.modifiedMs === info.modifiedMs && existing.sha256 ? { sha256: existing.sha256 } : {}),
    }
    if (!existing && all.length >= 500) throw new Error('Maximum imported model count reached')
    this.save([...all.filter(item => item.id !== model.id), model])
    return model
  }
  get(id: string): ManagedModel {
    const model = this.list().find(item => item.id === id)
    if (!model) throw new Error('Imported model was not found; import the GGUF file again')
    const current = inspectGguf(model.filePath)
    if (current.filePath.toLowerCase() !== model.filePath.toLowerCase() || current.sizeBytes !== model.sizeBytes || current.modifiedMs !== model.modifiedMs) {
      throw new Error('Model file changed or moved; re-import it before use')
    }
    return model
  }
  forget(id: string) {
    const all = this.list()
    if (!all.some(model => model.id === id)) throw new Error('Imported model was not found')
    // User-selected model files and Ollama blobs are never deleted here.
    this.save(all.filter(model => model.id !== id))
  }
  async digest(id: string, signal: AbortSignal, progress: (bytes: number, total: number) => void): Promise<string> {
    const model = this.get(id)
    if (model.sha256) return model.sha256
    const digest = createHash('sha256')
    let bytes = 0
    const stream = fs.createReadStream(model.filePath, { signal })
    for await (const chunk of stream) {
      digest.update(chunk); bytes += chunk.length; progress(bytes, model.sizeBytes)
    }
    signal.throwIfAborted()
    this.get(id)
    const sha256 = digest.digest('hex')
    this.save(this.list().map(item => item.id === id ? { ...item, sha256 } : item))
    return sha256
  }
  private save(models: ManagedModel[]) { writeJsonFile(this.file, { schemaVersion: 1, models }) }
}
