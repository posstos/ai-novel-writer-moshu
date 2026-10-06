import fs from 'node:fs'
import path from 'node:path'

/** Include license texts for installed packages, including renderer-bundled dependencies. */
export function collectMoshuLicenses(root) {
  const store = path.join(root, 'node_modules/.pnpm')
  const sections = ['MOSHU THIRD-PARTY NOTICES\nThe application is a modified AI Novel Writer distribution under GPL-3.0.\nThird-party components retain their own copyrights and licenses.\nThe following inventory includes build-tool dependencies as a superset of runtime dependencies.\nMicrosoft VC runtime and Electron/Chromium notices are supplied separately.']
  const packages = new Set()
  const inspect = folder => {
    const file = path.join(folder, 'package.json')
    if (!fs.existsSync(file)) return
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
    const id = `${pkg.name}@${pkg.version}`
    if (packages.has(id)) return
    packages.add(id)
    const texts = fs.readdirSync(folder).filter(name => /^(licen[cs]e|notice|copying|copyright|ofl)([._-]|$)/i.test(name) && fs.statSync(path.join(folder, name)).isFile())
    sections.push(`\n${'='.repeat(72)}\n${id}\nDeclared license: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? 'See upstream package')}\n${texts.map(name => `\n--- ${name} ---\n${fs.readFileSync(path.join(folder, name), 'utf8')}`).join('\n')}`)
  }
  for (const entry of fs.readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    const modules = path.join(store, entry.name, 'node_modules')
    if (!fs.existsSync(modules)) continue
    for (const child of fs.readdirSync(modules, { withFileTypes: true })) {
      if (!child.isDirectory()) continue
      const folder = path.join(modules, child.name)
      if (child.name.startsWith('@')) {
        for (const scoped of fs.readdirSync(folder, { withFileTypes: true })) if (scoped.isDirectory()) inspect(path.join(folder, scoped.name))
      } else inspect(folder)
    }
  }
  const output = path.join(root, '.runtime/moshu-package/THIRD-PARTY-NOTICES.txt')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, sections.join('\n') + '\n')
  return { packages: packages.size, file: path.relative(root, output), bytes: fs.statSync(output).size }
}
