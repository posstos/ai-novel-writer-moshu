/** Browser-only QA against vite.moshu-preview.config.ts. Never point this at the desktop renderer. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
const base = process.argv[2] || 'http://127.0.0.1:4173'
const output = resolve(process.argv[3] || '.runtime/moshu-ui-check')
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
const checks = [], errors = [], modelRequests = []
page.on('pageerror', error => errors.push(error.message))
page.on('request', request => { if (/127\.0\.0\.1:(11434|1234)/.test(request.url())) modelRequests.push(request.url()) })
const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS', name) }
const close = async () => { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('[role="dialog"][data-state="open"]')) }
try {
  await page.goto(base, { waitUntil: 'networkidle' })
  assert.ok(await page.evaluate(() => !!window.moshuPreview), 'Requires the isolated browser fixture')
  await check('empty bookshelf and honest model state', async () => {
    assert.match(await page.locator('h1').innerText(), /把心里的故事/)
    assert.match(await page.locator('.moshu-empty-shelf').innerText(), /创建第一部作品/)
    assert.match(await page.locator('.moshu-model-pill').innerText(), /待配置/)
    assert.equal(await page.locator('#bottom[data-panel]').evaluate(e => e.getBoundingClientRect().height), 0)
  })
  await check('new-novel action and Escape', async () => {
    await page.getByRole('button', { name: '新建小说', exact: true }).click()
    assert.match(await page.getByRole('dialog').innerText(), /新建小说项目/)
    await close()
  })
  await check('guide navigation and explicit model-settings action', async () => {
    await page.getByRole('button', { name: '从这里开始' }).click()
    await page.getByRole('button', { name: '连接本地模型', exact: true }).click()
    assert.match(await page.locator('.moshu-guide-content').innerText(), /不会替你安装/)
    await page.screenshot({ path: resolve(output, 'guide.png'), animations: 'disabled' })
    await page.getByRole('button', { name: '去配置模型' }).click()
    await page.getByRole('button', { name: '检测本地模型', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.moshuPreview.layout.getState().settingsSection), 'llm')
    await page.screenshot({ path: resolve(output, 'settings.png'), animations: 'disabled' })
  })
  await check('settings focus stays in the dialog', async () => {
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press('Tab')
      assert.ok(await page.evaluate(() => document.querySelector('[role="dialog"]').contains(document.activeElement)))
    }
    await close()
  })
  await check('left navigation opens a valid settings section', async () => {
    await page.locator('.writer-left-rail').getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '检测本地模型', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.moshuPreview.layout.getState().settingsSection), 'llm')
    await close()
  })
  await check('keyboard-accessible status-bar settings entry', async () => {
    await page.getByRole('button', { name: '未配置模型', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: '检测本地模型', exact: true }).waitFor()
    await close()
  })
  await check('bottom panel releases space and reopens', async () => {
    const tasks = page.locator('.writer-left-rail').getByRole('button', { name: '任务', exact: true })
    await tasks.click()
    await page.waitForFunction(() => document.querySelector('#bottom[data-panel]').getBoundingClientRect().height > 80)
    await tasks.click()
    await page.waitForFunction(() => document.querySelector('#bottom[data-panel]').getBoundingClientRect().height < 1)
    await tasks.click()
    await page.waitForFunction(() => document.querySelector('#bottom[data-panel]').getBoundingClientRect().height > 80)
    await tasks.click()
  })
  await check('sidebar and AI panel toggles remain available', async () => {
    const home = page.locator('.writer-left-rail').getByRole('button', { name: '首页', exact: true })
    await home.click(); await page.locator('.moshu-home-sidebar').waitFor(); await home.click()
    const ai = page.getByRole('button', { name: 'AI 输出', exact: true })
    await ai.click(); assert.equal(await page.evaluate(() => window.moshuPreview.layout.getState().aiPanelOpen), true); await ai.click()
  })
  await check('recent projects are real keyboard buttons', async () => {
    await page.evaluate(() => window.moshuPreview.project.setState({
      recentProjects: [{ name: '风停在山海之间', path: '示例书架 / 风停在山海之间' }, { name: '长安夜雨', path: '示例书架 / 长安夜雨' }],
      openProject: async path => { window.moshuOpenedPath = path; return true },
    }))
    const book = page.getByRole('button', { name: '打开小说：风停在山海之间', exact: true })
    await book.focus(); await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(() => window.moshuOpenedPath), '示例书架 / 风停在山海之间')
    await page.locator('.moshu-welcome').evaluate(e => { e.scrollTop = 0 })
    await page.screenshot({ path: resolve(output, 'home.png'), animations: 'disabled' })
  })
  await check('dark and paper themes retain readable surfaces', async () => {
    await page.evaluate(() => window.moshuPreview.theme.getState().setTheme('dark'))
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
    await page.screenshot({ path: resolve(output, 'dark.png'), animations: 'disabled' })
    await page.evaluate(() => window.moshuPreview.theme.getState().setTheme('paper'))
  })
  await check('1024×640 layout and settings fit the viewport', async () => {
    await page.setViewportSize({ width: 1024, height: 640 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    assert.equal(overflow, false)
    const settingButton = page.locator('.writer-left-rail').getByRole('button', { name: '设置', exact: true })
    const box = await settingButton.boundingBox(); assert.ok(box.y + box.height <= 612)
    await page.screenshot({ path: resolve(output, 'compact.png'), animations: 'disabled' })
    await settingButton.click(); await page.getByRole('dialog').waitFor()
    await page.getByRole('dialog').evaluate(el => Promise.allSettled(el.getAnimations().map(animation => animation.finished)))
    const dialog = await page.getByRole('dialog').boundingBox()
    assert.ok(dialog.x >= 0 && dialog.y >= 0 && dialog.x + dialog.width <= 1024 && dialog.y + dialog.height <= 640)
    await close()
  })
  await check('no automatic model calls or unhandled renderer errors', async () => {
    assert.deepEqual(modelRequests, [])
    assert.deepEqual(errors, [])
  })
  writeFileSync(resolve(output, 'result.json'), JSON.stringify({ status: 'passed', checks, unhandledErrors: errors, modelRequests }, null, 2) + '\n')
} finally { await browser.close() }
