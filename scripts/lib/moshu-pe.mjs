import { readFileSync } from 'node:fs'

/** Inspect PE headers without loading or executing the binary. */
export function inspectPE(file) {
  const b = readFileSync(file)
  if (b.length < 64 || b.readUInt16LE(0) !== 0x5a4d) throw new Error(`Not a PE binary: ${file}`)
  const pe = b.readUInt32LE(0x3c)
  if (pe + 24 > b.length || b.readUInt32LE(pe) !== 0x4550) throw new Error(`Invalid PE header: ${file}`)
  const machine = b.readUInt16LE(pe + 4)
  const count = b.readUInt16LE(pe + 6)
  const optionalSize = b.readUInt16LE(pe + 20)
  const opt = pe + 24
  const magic = b.readUInt16LE(opt)
  const directory = opt + (magic === 0x20b ? 112 : 96)
  const sections = []
  for (let i = 0; i < count; i++) {
    const at = opt + optionalSize + i * 40
    if (at + 40 > b.length) throw new Error('Truncated PE section table')
    sections.push({ va: b.readUInt32LE(at + 12), size: Math.max(b.readUInt32LE(at + 8), b.readUInt32LE(at + 16)), raw: b.readUInt32LE(at + 20) })
  }
  const offset = rva => {
    const section = sections.find(s => rva >= s.va && rva < s.va + s.size)
    const value = section ? section.raw + rva - section.va : rva
    if (value < 0 || value >= b.length) throw new Error('PE RVA is outside the file')
    return value
  }
  const nameAt = rva => {
    const at = offset(rva), end = b.indexOf(0, at)
    if (end < at || end - at > 260) throw new Error('Invalid PE import name')
    return b.subarray(at, end).toString('ascii').toLowerCase()
  }
  const imports = new Set()
  const importRva = directory + 16 <= opt + optionalSize ? b.readUInt32LE(directory + 8) : 0
  if (importRva) {
    let at = offset(importRva)
    for (let i = 0; i < 2048 && at + 20 <= b.length; i++, at += 20) {
      const name = b.readUInt32LE(at + 12)
      if (!name) break
      imports.add(nameAt(name))
    }
  }
  const delayRva = directory + 14 * 8 <= opt + optionalSize ? b.readUInt32LE(directory + 13 * 8) : 0
  if (delayRva) {
    let at = offset(delayRva)
    for (let i = 0; i < 2048 && at + 32 <= b.length; i++, at += 32) {
      const attributes = b.readUInt32LE(at), name = b.readUInt32LE(at + 4)
      if (!name) break
      if (!(attributes & 1)) throw new Error('Legacy VA-based delay imports are unsupported')
      imports.add(nameAt(name))
    }
  }
  return { machine, architecture: machine === 0x8664 ? 'x64' : machine === 0x14c ? 'x86' : `0x${machine.toString(16)}`, imports: [...imports].sort() }
}
