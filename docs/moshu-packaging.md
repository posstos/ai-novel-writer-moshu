# 墨墅 Windows 手动打包指南（内部）

面向维护者：如何在源码项目里重新产出墨墅安装版与便携版。用户侧说明见 `docs/moshu-windows-release.md`（会随包附带为 README-墨墅.md）。

## 前置条件

- Windows 10 / 11 x64 构建机（本流程不支持在 Linux/macOS 交叉打包 Windows NSIS）。
- 已安装项目依赖（现有 `一键启动.bat` 流程或 `pnpm install`），Node 22.13.1、pnpm 11.11.0 已验证可用。
- 无需 Python、Visual Studio 或全局安装 electron-builder。
- 需要网络下载两类**项目本地**构建工具（均落在 `.runtime/moshu-package/`，不安装到系统）：electron-builder 的 NSIS 工具链（`ELECTRON_BUILDER_CACHE` 指向项目内目录）、微软 VC 运行库官方包（`scripts/prepare-moshu-vendor.mjs` 处理，见下）。

## 打包命令

```
node scripts/prepare-managed-engines.mjs --allow-runtime-downloads
node scripts/build-moshu.mjs --allow-tool-downloads
node scripts/package-moshu.mjs --release-suffix=20260928 --allow-tool-downloads
```

两个脚本都必须在仓库根目录运行，失败即中止且不做部分交付。`--allow-tool-downloads` 是工具下载的显式开关；不给该参数时，已缓存的工具仍可离线使用，但不会发起新下载。

`build-moshu.mjs`：tsc 全量类型检查 → 修改文件 ESLint（0 warning）→ `vitest.moshu.config.ts` 与 `vitest.local-model.config.ts` 回归 → i18n 覆盖检查 → VC 运行库准备 → `vite build`（同时把 Monaco 本地化复制进 `dist/monaco/vs`，消除默认 CDN 依赖）→ 汇总第三方许可清单。

`package-moshu.mjs`：electron-builder（配置 `electron-builder.moshu.cjs`，`npmRebuild: false`，复用已安装的 Electron 发行目录）→ 结构审计 → 隔离验证 → 便携/源码 ZIP → 校验和与 `BUILD-REPORT.json`。

产物目录：`release/moshu-<version>-win-x64-<release-suffix>/`；省略后缀时保持旧目录命名。目标目录非空会拒绝覆盖，重打包请使用新的唯一后缀，原有发行包保持原位。后缀仅允许 1-64 位字母、数字、连字符和下划线。

## 内置引擎（1.2.0）

固定版本、官方 HTTPS 地址和 SHA-256 保存在 `packaging/embedded-runtime-pins.json`。构建准备脚本仅下载运行库，不下载模型、不执行系统安装；网络授权开关为 `--allow-runtime-downloads`。缓存与分发载荷分别放在 `.runtime/managed-engines/downloads/` 和 `.runtime/managed-engines/payload/`。

包含 Ollama CLI 0.34.4，以及 llama.cpp 稳定版 0.5.0 对应的 b11146 CPU / Vulkan 二进制。保留归档中的上游许可，并补入 MIT 许可与经过签名检查的应用本地微软运行库。不捆绑原版 LM Studio。

`model-download.json` 作为可编辑的发行侧配置放在 EXE 同目录，资源目录另有后备副本。仓库源配置已填写夸克分享页，提取码留空。便携版可直接更新 EXE 同目录的配置文件而无需重新编译；向新用户分发安装器时需重新打包，使其载荷包含最新配置。

内置运行库显著增加包体和临时磁盘需求；不把模型文件放进 payload。重新构建使用新的发行后缀，保留旧包。生产门禁包含 `vitest.managed-local.config.ts`；真实模型验收必须单独获得模型后进行。

## 关键配置决策

- **显卡兼容**：Windows 默认通过 `app.disableHardwareAcceleration()` 使用软件渲染，不关闭 GPU 或 renderer 沙箱；保留安全模式启动入口。
- **身份兼容**：`package.json` 的 `name` 保持 `ai-novel-writer`；`extraMetadata.productName` 强制回小写原名，防止 productName=墨墅 改变 Electron userData 与单实例身份。显示名、EXE 名、快捷方式通过 `productName: '墨墅'`（builder 层）+ `executableName: 'Moshu'` + `shortcutName` 实现。`appId` 不变。
- **更新策略**：`src/shared/distribution.ts` 的 `MANUAL_DISTRIBUTION_UPDATES` 关闭上游自动更新；UI 文案说明手动更新。不要恢复 `publish` 配置，否则定制机会被上游版本覆盖。
- **原生模块**：不重新编译（ABI 已就绪），只做加载验证；`vcruntime140.dll` 从微软官方 `vc_redist.x64.exe`（SHA-256 固定、Authenticode 校验）中**仅解压**提取，随包放置，绝不执行安装器或写入系统目录。
- **内容边界**：asar 仅含 `dist`、`dist-electron`、`build/moshu.ico` 与生产依赖；排除源码、测试、预览夹具与 `.env*`。结构审计会强制这些约束。

## 内置验证（package 阶段）

1. **结构审计**：必需文件存在；EXE 与三个原生 DLL 均为 x64 PE；asar 列表包含入口与本地 Monaco；不包含开发内容；包内 `package.json` 身份字段符合预期。
2. **Node require 验证**：`ELECTRON_RUN_AS_NODE` 下从 `app.asar` 加载 better-sqlite3 并执行内存查询、加载 @lancedb/lancedb。
3. **隐藏窗口验证**：随机 48-hex 令牌 + 一次性临时目录 + 独立 `AI_NOVEL_VELA_HOME` 与 `--user-data-dir`；隐藏 BrowserWindow 加载真实 `file://` 渲染层，验证墨墅首页、内置指南打开、更新状态为 disabled、无已配置模型、已配置的夸克分享入口按钮可用、渲染层无 Node 全局、窗口保持不可见；隐藏模式会拦截所有 http(s) 请求。便携目录（win-unpacked 的重定位副本）重复全部验证。

## 明确不做的事

- 不静默运行安装器（`/S`）或执行卸载；安装向导需人工确认。
- 不读取用户真实 `.vela`、作品或模型配置；不在验证中调用真实模型。
- 不签名（无证书）；SmartScreen 提示的应对写进了用户说明。
- 不替代上游 `build:win` 正式发行门禁；上游流程保持原样。

## 版本升级

改 `package.json` 的 `version` 后重跑两个脚本；目录名、安装器名、报告中的版本号会自动跟随。产物移交前核对 `SHA256SUMS.txt` 与 `BUILD-REPORT.json`。
